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
  let d = (raw || '').replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55') && d[4] === '9') {
    d = d.slice(0, 4) + d.slice(5);
  }
  return d;
}

interface NormalizedMessage {
  phone: string;
  contact_name: string | null;
  message_text: string;
  message_type: string;
  external_message_id: string;
  ctwa_clid?: string | null;
  referral_source_url?: string | null;
  media?: {
    id: string;
    mime_type?: string | null;
    sha256?: string | null;
    filename?: string | null;
    voice?: boolean | null;
  } | null;
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

        // Captura media id (Cloud API) — necessário pra baixar via Graph API depois.
        let media: NormalizedMessage['media'] = null;
        const mediaTypes = ['audio', 'image', 'video', 'document', 'sticker', 'voice'] as const;
        for (const mt of mediaTypes) {
          const node = (m as any)[mt];
          if (node && typeof node === 'object' && node.id) {
            media = {
              id: String(node.id),
              mime_type: node.mime_type || null,
              sha256: node.sha256 || null,
              filename: node.filename || null,
              voice: typeof node.voice === 'boolean' ? node.voice : null,
            };
            if (typeof node.caption === 'string' && node.caption && text.startsWith('(')) {
              text = node.caption;
            }
            break;
          }
        }

        out.push({
          phone: normalizePhone(m.from),
          contact_name: nameByWaId[m.from] || null,
          message_text: text,
          message_type: type,
          external_message_id: m.id,
          ctwa_clid: m.referral?.ctwa_clid || null,
          referral_source_url: m.referral?.source_url || null,
          media,
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

  // Round-robin atômico: a RPC seleciona e atualiza dentro de uma transação com
  // SELECT ... FOR UPDATE, evitando a corrida do antigo read-modify-write em JS.
  // O pool é lido da própria regra dentro da função (fonte única de verdade).
  const { data: nextUser, error: pickErr } = await supabase.rpc('pick_cloud_assignee', {
    p_rule_id: matched.id,
  });
  if (pickErr) {
    console.error('[wa-cloud] pick_cloud_assignee falhou', pickErr);
    return { ruleId: matched.id, userId: null, matchedValue: matched.match_value };
  }

  return { ruleId: matched.id, userId: (nextUser as string) || null, matchedValue: matched.match_value };
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
  const rawBody = (req as any).rawBody
    ? (req as any).rawBody.toString('utf8')
    : JSON.stringify(req.body || {});
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

      // Discadora automática: se há permissão pendente pra esse telefone,
      // qualquer resposta inbound conta como aceite (granted) e a fila avança.
      try {
        const { data: pendingPerm } = await supabase
          .from('whatsapp_call_permissions')
          .select('id, phone_number_id, status')
          .eq('phone', msg.phone)
          .eq('status', 'pending')
          .maybeSingle();

        if (pendingPerm) {
          const nowIso = new Date().toISOString();
          const lower = (msg.message_text || '').toLowerCase().trim();
          const isDeny = /\b(n[aã]o|nao|stop|sair|cancelar|recusar)\b/.test(lower);
          const newStatus = isDeny ? 'denied' : 'granted';
          await supabase
            .from('whatsapp_call_permissions')
            .update({ status: newStatus, responded_at: nowIso, updated_at: nowIso } as any)
            .eq('id', (pendingPerm as any).id);

          // Move itens da fila desse telefone+pnid pra próximo passo
          await supabase
            .from('whatsapp_call_queue')
            .update({
              status: newStatus === 'granted' ? 'ready_to_call' : 'failed',
              last_result: newStatus === 'granted' ? 'permission_granted_by_reply' : 'permission_denied_by_reply',
              scheduled_at: nowIso,
              updated_at: nowIso,
            } as any)
            .eq('phone', msg.phone)
            .eq('phone_number_id_used', (pendingPerm as any).phone_number_id)
            .eq('status', 'awaiting_permission');
        }
      } catch (e) {
        console.warn('[wa-cloud] permission update skipped:', e);
      }

      // Lookup lead PRIMEIRO — usamos board_id pra escolher o pool do round-robin.
      let leadId: string | null = null;
      let leadBoardId: string | null = null;
      let leadAssignedTo: string | null = null;
      try {
        const { data: leadRow } = await supabase
          .from('leads')
          .select('id, board_id, assigned_to')
          .eq('lead_phone', msg.phone)
          .is('deleted_at', null)
          .limit(1)
          .maybeSingle();
        leadId = (leadRow as any)?.id || null;
        leadBoardId = (leadRow as any)?.board_id || null;
        leadAssignedTo = (leadRow as any)?.assigned_to || null;
      } catch (e) {
        console.warn('[wa-cloud] lead lookup falhou', e);
      }

      // Sticky: se a conversa já tem dono (em assignees OU no próprio lead), mantém.
      const { data: existingAssignee } = await supabase
        .from('whatsapp_cloud_assignees')
        .select('assigned_user_id')
        .eq('phone', msg.phone)
        .eq('instance_name', INSTANCE_NAME)
        .maybeSingle();

      let userId: string | null =
        (existingAssignee as any)?.assigned_user_id ?? leadAssignedTo ?? null;
      let ruleId: string | null = null;
      let matchedValue: string | null = null;
      let assignmentSource: string | null = null;

      if (!userId) {
        // 1) Round-robin do funil (membros configurados no board do lead).
        if (leadBoardId) {
          const { data: funnelUser, error: funnelErr } = await supabase.rpc(
            'pick_funnel_assignee',
            { p_board_id: leadBoardId },
          );
          if (funnelErr) {
            console.warn('[wa-cloud] pick_funnel_assignee falhou', funnelErr);
          } else if (funnelUser) {
            userId = funnelUser as string;
            assignmentSource = 'round_robin';
            matchedValue = `board:${leadBoardId}`;
          }
        }
        // 2) Fallback: regras antigas (CTWA / default) — para conversas sem lead/board.
        if (!userId) {
          ({ ruleId, userId, matchedValue } = await pickAssignee(
            msg.phone,
            msg.ctwa_clid || null,
            msg.referral_source_url || null,
          ));
          if (userId) assignmentSource = ruleId ? 'ad_rule' : 'round_robin';
        }
        // 3) Sem dono — fica no pool "Sem dono" pra admin distribuir.
        if (!userId) assignmentSource = 'orphan';

        // Persiste o dono nas duas fontes (assignees pra inbox; lead pra filtragem por dono).
        if (userId) {
          await supabase.from('whatsapp_cloud_assignees').upsert({
            phone: msg.phone,
            instance_name: INSTANCE_NAME,
            assigned_user_id: userId,
            updated_at: new Date().toISOString(),
          } as any, { onConflict: 'phone,instance_name' });
        }
        if (leadId && userId && !leadAssignedTo) {
          await supabase
            .from('leads')
            .update({
              assigned_to: userId,
              assignment_source: assignmentSource,
              updated_at: new Date().toISOString(),
            } as any)
            .eq('id', leadId);
        }
      }

      await supabase.from('whatsapp_cloud_routing_log').insert({
        phone: msg.phone,
        lead_id: leadId,
        rule_id: ruleId,
        assigned_user_id: userId,
        matched_value: matchedValue,
      } as any);

      console.log(`[wa-cloud] msg=${msg.external_message_id} from=${msg.phone} → user=${userId || 'none'} board=${leadBoardId || 'none'} src=${assignmentSource || 'sticky'}`);
    }
  } catch (err) {
    console.error('[wa-cloud] erro processando webhook:', err);
  }
}
