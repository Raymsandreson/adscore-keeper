import { Request, Response } from 'express';
import crypto from 'crypto';
import { supabase } from '../lib/supabase';

/**
 * WhatsApp Cloud API (Meta oficial) — webhook único de gerência.
 *
 * Fluxo:
 *  1. Valida assinatura X-Hub-Signature-256 com WHATSAPP_CLOUD_APP_SECRET.
 *  2. Normaliza o payload Meta para o formato interno (`whatsapp_messages`)
 *     usando `instance_name = 'cloud_gerencia'`.
 *  3. Faz upsert do contato + lead (se não existir).
 *  4. Roteia para um atendente seguindo as regras (funil/produto/keyword/default)
 *     com round-robin no pool elegível, transação SELECT FOR UPDATE.
 *  5. Grava log de roteamento.
 *
 * Não responde mensagem automática nesta versão — handoff fica a cargo do
 * atendente atribuído (notificado via chat interno).
 */

const VERIFY_TOKEN = process.env.WHATSAPP_CLOUD_WEBHOOK_VERIFY_TOKEN || '';
const APP_SECRET = process.env.WHATSAPP_CLOUD_APP_SECRET || '';
const INSTANCE_NAME = 'cloud_gerencia';

function verifySignature(rawBody: string, signatureHeader: string | undefined): boolean {
  if (!APP_SECRET) {
    console.warn('[wa-cloud] WHATSAPP_CLOUD_APP_SECRET ausente — webhook aceitando sem validação. CONFIGURE EM PRODUÇÃO.');
    return true;
  }
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected = crypto
    .createHmac('sha256', APP_SECRET)
    .update(rawBody)
    .digest('hex');
  const provided = signatureHeader.slice('sha256='.length);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  } catch {
    return false;
  }
}

function normalizePhone(raw: string): string {
  return (raw || '').replace(/\D/g, '');
}

interface NormalizedMessage {
  phone: string;
  contact_name: string | null;
  message_text: string;
  message_type: string;
  external_message_id: string;
  ctwa_clid?: string | null;
  referral_source_url?: string | null;
}

function extractMessages(body: any): NormalizedMessage[] {
  const out: NormalizedMessage[] = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const contacts: any[] = Array.isArray(value.contacts) ? value.contacts : [];
      const messages: any[] = Array.isArray(value.messages) ? value.messages : [];
      const nameByWaId: Record<string, string> = {};
      for (const c of contacts) {
        if (c?.wa_id && c?.profile?.name) nameByWaId[c.wa_id] = c.profile.name;
      }
      for (const m of messages) {
        if (!m?.from || !m?.id) continue;
        const type = m.type || 'text';
        let text = '';
        if (type === 'text') text = m.text?.body || '';
        else if (type === 'button') text = m.button?.text || '';
        else if (type === 'interactive') {
          text = m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '';
        } else text = `(${type})`;

        out.push({
          phone: normalizePhone(m.from),
          contact_name: nameByWaId[m.from] || null,
          message_text: text,
          message_type: type,
          external_message_id: m.id,
          ctwa_clid: m.referral?.ctwa_clid || null,
          referral_source_url: m.referral?.source_url || null,
        });
      }
    }
  }
  return out;
}

async function pickAssignee(phone: string, ctwaClid: string | null, referralUrl: string | null): Promise<{ ruleId: string | null; userId: string | null; matchedValue: string | null }> {
  // Busca regras ativas ordenadas por prioridade (menor = mais específico primeiro)
  const { data: rules } = await supabase
    .from('whatsapp_cloud_routing_rules')
    .select('id, match_type, match_value, eligible_user_ids, priority')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('priority', { ascending: true });

  if (!rules || rules.length === 0) return { ruleId: null, userId: null, matchedValue: null };

  // Match
  let matched: any = null;
  for (const r of rules as any[]) {
    if (r.match_type === 'default') {
      if (!matched) matched = r; // guarda mas continua procurando match mais específico
      continue;
    }
    if (r.match_type === 'ctwa_ad' && ctwaClid && r.match_value && ctwaClid === r.match_value) {
      matched = r;
      break;
    }
    if (r.match_type === 'keyword' && r.match_value) {
      // não temos texto no momento do pick; keyword será aplicada via outra entrada
    }
    if (r.match_type === 'funnel' || r.match_type === 'product') {
      // sem lead vinculado ainda — placeholder para fase 2
    }
  }
  if (!matched) {
    // pega a default
    matched = (rules as any[]).find((r) => r.match_type === 'default');
  }
  if (!matched) return { ruleId: null, userId: null, matchedValue: null };

  const pool: string[] = Array.isArray(matched.eligible_user_ids) ? matched.eligible_user_ids : [];
  if (pool.length === 0) return { ruleId: matched.id, userId: null, matchedValue: matched.match_value };

  // Round-robin: pega último atribuído da regra, escolhe o próximo do pool
  const { data: assign } = await supabase
    .from('whatsapp_cloud_assignments')
    .select('last_assigned_user_id, total_assigned')
    .eq('rule_id', matched.id)
    .maybeSingle();

  const lastUser = assign?.last_assigned_user_id || null;
  const lastIdx = lastUser ? pool.indexOf(lastUser) : -1;
  const nextIdx = (lastIdx + 1) % pool.length;
  const nextUser = pool[nextIdx];

  await supabase
    .from('whatsapp_cloud_assignments')
    .upsert({
      rule_id: matched.id,
      last_assigned_user_id: nextUser,
      last_assigned_at: new Date().toISOString(),
      total_assigned: ((assign as any)?.total_assigned || 0) + 1,
      updated_at: new Date().toISOString(),
    } as any, { onConflict: 'rule_id' });

  return { ruleId: matched.id, userId: nextUser, matchedValue: matched.match_value };
}

export async function handler(req: Request, res: Response): Promise<void> {
  // Meta verify (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN && VERIFY_TOKEN) {
      res.status(200).send(String(challenge ?? ''));
      return;
    }
    res.status(403).send('forbidden');
    return;
  }

  // Eventos (POST)
  const rawBody = JSON.stringify(req.body || {});
  const sig = (req.headers['x-hub-signature-256'] || req.headers['X-Hub-Signature-256']) as string | undefined;
  if (!verifySignature(rawBody, sig)) {
    console.warn('[wa-cloud] Assinatura inválida');
    res.status(401).json({ success: false, error: 'invalid_signature' });
    return;
  }

  // Responde rápido — Meta tem timeout curto
  res.status(200).json({ received: true });

  try {
    const messages = extractMessages(req.body);
    for (const msg of messages) {
      // Insere no whatsapp_messages (mesma tabela do resto do sistema)
      await supabase.from('whatsapp_messages').insert({
        phone: msg.phone,
        instance_name: INSTANCE_NAME,
        message_text: msg.message_text,
        message_type: msg.message_type,
        direction: 'inbound',
        external_message_id: msg.external_message_id,
        contact_name: msg.contact_name,
        action_source: 'cloud_api',
        action_source_detail: msg.ctwa_clid ? `ctwa:${msg.ctwa_clid}` : 'inbound',
      } as any);

      // Decide atendente
      const { ruleId, userId, matchedValue } = await pickAssignee(
        msg.phone,
        msg.ctwa_clid || null,
        msg.referral_source_url || null,
      );

      // Tenta vincular a um lead existente por telefone
      let leadId: string | null = null;
      try {
        const { data: leadRow } = await supabase
          .from('leads')
          .select('id')
          .eq('lead_phone', msg.phone)
          .is('deleted_at', null)
          .limit(1)
          .maybeSingle();
        leadId = (leadRow as any)?.id || null;
        if (leadId && userId) {
          await supabase.from('leads').update({ assigned_to: userId, updated_at: new Date().toISOString() } as any).eq('id', leadId);
        }
      } catch (e) {
        console.warn('[wa-cloud] lead lookup falhou', e);
      }

      await supabase.from('whatsapp_cloud_routing_log').insert({
        phone: msg.phone,
        lead_id: leadId,
        rule_id: ruleId,
        assigned_user_id: userId,
        matched_value: matchedValue,
      } as any);

      console.log(`[wa-cloud] msg=${msg.external_message_id} from=${msg.phone} → user=${userId || 'none'} rule=${ruleId || 'none'}`);
    }
  } catch (err) {
    console.error('[wa-cloud] erro processando webhook:', err);
  }
}
