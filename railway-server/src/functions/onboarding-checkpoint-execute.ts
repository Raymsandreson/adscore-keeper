// Executa checkpoint de onboarding pós-ZapSign. Portado do Lovable Cloud para Railway.
// Regras:
// - Usa Externo via lib/supabase (EXTERNAL_*).
// - Bloqueia avanço: passo anterior precisa estar 'done'.
// - Retorna SEMPRE 200 com { success, error? } (convenção do projeto).
// - Chama handlers ainda residentes no Cloud (create-whatsapp-group, send-whatsapp-message,
//   import-group-docs-to-lead) via CLOUD_FUNCTIONS_URL+CLOUD_ANON_KEY (mesma convenção do
//   webhook ZapSign). Quando esses handlers migrarem, basta trocar a URL.
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';

const STEP_ORDER = [
  'setup_lead_close',
  'create_group',
  'send_initial_message',
  'import_docs',
  'create_case_process',
  'create_onboarding_activity',
] as const;

const CLOUD_FUNCTIONS_URL =
  process.env.CLOUD_FUNCTIONS_URL ||
  process.env.SUPABASE_URL ||
  'https://gliigkupoebmlbwyvijp.supabase.co';
const CLOUD_ANON_KEY = process.env.CLOUD_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

async function callCloudFn(name: string, body: unknown): Promise<{ ok: boolean; data: any }> {
  const r = await fetch(`${CLOUD_FUNCTIONS_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CLOUD_ANON_KEY}`,
      apikey: CLOUD_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data: any = await r.json().catch(() => ({}));
  return { ok: r.ok && (data?.success !== false), data };
}

type AuthResult =
  | { ok: true; userId: string; tokenSuffix: string }
  | { ok: false; reason: 'missing_header' | 'malformed_bearer' | 'empty_token' | 'anon_key_used' | 'user_endpoint_failed' | 'no_user_id' | 'fetch_exception'; status?: number; tokenSuffix?: string; detail?: string };

function logAuth(rid: string, phase: 'pre' | 'post', result: AuthResult, extra: Record<string, unknown> = {}) {
  const payload: Record<string, unknown> = {
    fn: 'onboarding-checkpoint-execute',
    event: `auth.${phase}`,
    rid,
    ok: result.ok,
    ...extra,
  };
  if (result.ok === true) {
    payload.user_id = result.userId;
    payload.token_suffix = result.tokenSuffix;
  } else {
    payload.reason = result.reason;
    payload.status = result.status;
    payload.token_suffix = result.tokenSuffix;
    payload.detail = result.detail;
  }
  console.log(JSON.stringify(payload));
}

/**
 * Valida o JWT do Lovable Cloud chamando /auth/v1/user.
 * Retorna detalhes estruturados para permitir logging do motivo da falha.
 */
async function verifyCloudJwt(authHeader: string | undefined): Promise<AuthResult> {
  if (!authHeader) return { ok: false, reason: 'missing_header' };
  if (!authHeader.toLowerCase().startsWith('bearer ')) return { ok: false, reason: 'malformed_bearer' };
  const token = authHeader.slice(7).trim();
  const tokenSuffix = token ? `…${token.slice(-6)}` : '';
  if (!token) return { ok: false, reason: 'empty_token' };
  if (token === CLOUD_ANON_KEY) return { ok: false, reason: 'anon_key_used', tokenSuffix };
  try {
    const r = await fetch(`${CLOUD_FUNCTIONS_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: CLOUD_ANON_KEY },
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return { ok: false, reason: 'user_endpoint_failed', status: r.status, tokenSuffix, detail: detail.slice(0, 200) };
    }
    const u: any = await r.json().catch(() => null);
    if (!u?.id) return { ok: false, reason: 'no_user_id', status: r.status, tokenSuffix };
    return { ok: true, userId: u.id, tokenSuffix };
  } catch (e) {
    return { ok: false, reason: 'fetch_exception', tokenSuffix, detail: e instanceof Error ? e.message : String(e) };
  }
}

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  const rid = (req.headers['x-request-id'] as string) || Math.random().toString(36).slice(2, 10);
  try {
    // 🔒 Bloqueia acesso anônimo: exige JWT válido do Lovable Cloud.
    const authHeader = req.headers['authorization'] as string | undefined;
    const auth = await verifyCloudJwt(authHeader);
    logAuth(rid, 'pre', auth, { path: req.path, ip: req.ip });
    if (auth.ok !== true) {
      logAuth(rid, 'post', auth, { blocked: true });
      return res.status(401).json({ success: false, error: 'unauthorized', reason: auth.reason, rid });
    }
    logAuth(rid, 'post', auth, { blocked: false });

    const { checkpoint_id, user_id, extra } = (req.body || {}) as {
      checkpoint_id?: string;
      user_id?: string;
      extra?: Record<string, any>;
    };
    if (!checkpoint_id) return ok({ success: false, error: 'checkpoint_id required' });

    const { data: ckpt, error: ckptErr } = await ext
      .from('onboarding_checkpoints')
      .select('*')
      .eq('id', checkpoint_id)
      .maybeSingle();
    if (ckptErr || !ckpt) return ok({ success: false, error: 'checkpoint not found' });
    if (ckpt.status === 'done') return ok({ success: true, already_done: true });

    const idx = STEP_ORDER.indexOf(ckpt.step);
    if (idx > 0) {
      const prev = STEP_ORDER[idx - 1];
      const { data: prevCk } = await ext
        .from('onboarding_checkpoints')
        .select('status')
        .eq('lead_id', ckpt.lead_id)
        .eq('step', prev)
        .maybeSingle();
      if (!prevCk || prevCk.status !== 'done') {
        return ok({ success: false, error: `passo anterior (${prev}) não concluído` });
      }
    }

    await ext
      .from('onboarding_checkpoints')
      .update({ status: 'running', updated_at: new Date().toISOString() })
      .eq('id', checkpoint_id);

    const p = ckpt.payload || {};
    let result: Record<string, unknown> = {};
    let success = false;
    let errMsg = '';

    try {
      switch (ckpt.step) {
        case 'setup_lead_close': {
          // 1) Garante lead existe (já existe — só atualiza para closed)
          const { data: leadRow, error: leadErr } = await ext
            .from('leads')
            .select('id, lead_name, lead_phone, lead_status')
            .eq('id', ckpt.lead_id)
            .maybeSingle();
          if (leadErr || !leadRow) { errMsg = leadErr?.message || 'lead não encontrado'; break; }

          // 2) Localiza contato existente — só cria se realmente não existir
          const signerName = (p.signer_name as string) || leadRow.lead_name || '';
          const phoneDigits = (leadRow.lead_phone || p.lead_phone || '').replace(/\D/g, '');
          let contactId: string | null = (p.contact_id as string) || null;
          let contactReused = false;

          // 2a) Por payload.contact_id (já vinculado no fluxo ZapSign)
          if (contactId) contactReused = true;

          // 2b) Por contact_leads (junção já existe pra esse lead)
          if (!contactId) {
            const { data: linked } = await ext
              .from('contact_leads')
              .select('contact_id')
              .eq('lead_id', ckpt.lead_id)
              .limit(1)
              .maybeSingle();
            if (linked?.contact_id) { contactId = linked.contact_id; contactReused = true; }
          }

          // 2c) Por contacts.lead_id direto
          if (!contactId) {
            const { data: direct } = await ext
              .from('contacts')
              .select('id')
              .eq('lead_id', ckpt.lead_id)
              .is('whatsapp_group_id', null)
              .is('deleted_at', null)
              .limit(1)
              .maybeSingle();
            if (direct?.id) { contactId = direct.id; contactReused = true; }
          }

          // 2d) Por telefone (qualquer contato, exceto contatos-de-grupo)
          if (!contactId && phoneDigits) {
            const { data: byPhone } = await ext
              .from('contacts')
              .select('id')
              .eq('phone', phoneDigits)
              .is('whatsapp_group_id', null)
              .is('deleted_at', null)
              .limit(1)
              .maybeSingle();
            if (byPhone?.id) { contactId = byPhone.id; contactReused = true; }
          }

          // 2e) Só cria se realmente não achou nada
          if (!contactId && signerName) {
            const { data: newC } = await ext
              .from('contacts')
              .insert({
                full_name: signerName,
                phone: phoneDigits || null,
                lead_id: ckpt.lead_id,
                action_source: 'zapsign_signed',
                action_source_detail: 'Contato criado automaticamente após assinatura ZapSign',
              })
              .select('id')
              .maybeSingle();
            contactId = newC?.id || null;
          } else if (contactId) {
            // Atualiza apenas o que vale a pena (não sobrescreve nome existente sem necessidade)
            const updates: Record<string, unknown> = {};
            const { data: existing } = await ext
              .from('contacts')
              .select('full_name, lead_id')
              .eq('id', contactId)
              .maybeSingle();
            if (signerName && (!existing?.full_name || existing.full_name.trim() === '')) {
              updates.full_name = signerName;
            }
            if (!existing?.lead_id) updates.lead_id = ckpt.lead_id;
            if (Object.keys(updates).length > 0) {
              await ext.from('contacts').update(updates).eq('id', contactId);
            }
          }

          // 3) Garante junction contact_leads
          if (contactId) {
            await ext
              .from('contact_leads')
              .insert({ contact_id: contactId, lead_id: ckpt.lead_id })
              .then(() => {}, () => {}); // ignore duplicate
          }

          // 4) Marca lead como closed
          await ext
            .from('leads')
            .update({
              lead_status: 'closed',
              became_client_date: new Date().toISOString().slice(0, 10),
              updated_at: new Date().toISOString(),
            })
            .eq('id', ckpt.lead_id);

          result = {
            lead_id: ckpt.lead_id,
            lead_name: leadRow.lead_name,
            contact_id: contactId,
            contact_reused: contactReused,
            signer_name: signerName,
            lead_status: 'closed',
          };
          success = true;
          break;
        }

        case 'create_group': {
          const { data: lead } = await ext
            .from('leads')
            .select('whatsapp_group_id')
            .eq('id', ckpt.lead_id)
            .maybeSingle();
          let groupJid = lead?.whatsapp_group_id || null;
          let reused = false;
          if (groupJid) {
            reused = true;
          } else {
            let creator_instance_id: string | null = null;
            if (p.instance_name) {
              const { data: inst } = await ext
                .from('whatsapp_instances')
                .select('id')
                .ilike('instance_name', p.instance_name)
                .maybeSingle();
              creator_instance_id = inst?.id || null;
            }
            const r = await callCloudFn('create-whatsapp-group', {
              lead_id: ckpt.lead_id,
              lead_name: p.lead_name,
              phone: p.lead_phone,
              contact_phone: p.lead_phone,
              board_id: p.board_id,
              creator_instance_id,
              creation_origin: 'onboarding_checkpoint',
              // Pós-assinatura: usa configuração de grupo "fechado" (closed_group_name_prefix
              // + closed_sequence) e sincroniza lead_name com o nome final do grupo (ex: MAT 0001).
              phase: 'closed',
            });
            if (r.ok && r.data?.group_id) {
              groupJid = r.data.group_id;
              await ext.from('leads').update({ whatsapp_group_id: groupJid }).eq('id', ckpt.lead_id);
            } else {
              errMsg = r.data?.error || 'create-whatsapp-group falhou';
              break;
            }
          }

          // Enriquece com nome do grupo + participantes vinculados
          const { data: lwg } = await ext
            .from('lead_whatsapp_groups')
            .select('group_name, group_link')
            .eq('lead_id', ckpt.lead_id)
            .eq('group_jid', groupJid)
            .maybeSingle();

          const { data: linkedContacts } = await ext
            .from('contact_leads')
            .select('contact_id, contacts:contacts(id, full_name, phone)')
            .eq('lead_id', ckpt.lead_id);

          const participants = (linkedContacts || [])
            .map((row: any) => row.contacts)
            .filter((c: any) => c && c.full_name)
            .map((c: any) => ({ id: c.id, name: c.full_name, phone: c.phone }));

          result = {
            group_jid: groupJid,
            group_name: lwg?.group_name || null,
            group_link: lwg?.group_link || null,
            participants,
            reused,
          };
          success = true;
          break;
        }


        case 'send_initial_message': {
          const text = (extra?.message_text as string) || '';
          if (!text.trim()) { errMsg = 'mensagem vazia'; break; }
          const { data: lead } = await ext
            .from('leads')
            .select('whatsapp_group_id')
            .eq('id', ckpt.lead_id)
            .maybeSingle();
          const target = lead?.whatsapp_group_id || p.lead_phone;
          const r = await callCloudFn('send-whatsapp-message', {
            phone: target,
            instance_name: p.instance_name,
            message: text,
          });
          if (r.ok) { result = { sent_to: target, preview: text.slice(0, 80) }; success = true; }
          else errMsg = r.data?.error || 'send falhou';
          break;
        }

        case 'import_docs': {
          const documents = (extra?.documents as any[]) || [];
          if (documents.length === 0) { result = { imported: 0 }; success = true; break; }
          const r = await callCloudFn('import-group-docs-to-lead', {
            lead_id: ckpt.lead_id,
            lead_name: p.lead_name,
            documents,
          });
          if (r.ok) { result = { imported: (r.data?.imported || []).length }; success = true; }
          else errMsg = r.data?.error || 'import falhou';
          break;
        }

        case 'create_case_process': {
          const process_type = extra?.process_type as string;
          const fee_percentage = Number(extra?.fee_percentage);
          if (!process_type || !Number.isFinite(fee_percentage)) {
            errMsg = 'process_type e fee_percentage obrigatórios';
            break;
          }
          const { data: lc, error: lcErr } = await ext
            .from('legal_cases')
            .insert({
              lead_id: ckpt.lead_id,
              client_name: p.lead_name,
              created_by: p.created_by,
              status: 'em_andamento',
            })
            .select('id, case_number')
            .maybeSingle();
          if (lcErr || !lc) { errMsg = lcErr?.message || 'falha ao criar caso'; break; }
          const { data: lp, error: lpErr } = await ext
            .from('lead_processes')
            .insert({
              lead_id: ckpt.lead_id,
              legal_case_id: lc.id,
              process_type,
              fee_percentage,
              created_by: p.created_by,
            })
            .select('id')
            .maybeSingle();
          if (lpErr) { errMsg = lpErr.message; break; }
          result = { legal_case_id: lc.id, case_number: lc.case_number, lead_process_id: lp?.id };
          success = true;
          break;
        }

        case 'create_onboarding_activity': {
          const assigned_to = (extra?.assigned_to as string) || p.created_by || null;
          const { data: act, error: actErr } = await ext
            .from('lead_activities')
            .insert({
              lead_id: ckpt.lead_id,
              lead_name: p.lead_name,
              title: 'ONBOARDING CLIENTE',
              description: 'Atividade de onboarding criada após assinatura.',
              activity_type: 'tarefa',
              status: 'pendente',
              priority: 'alta',
              assigned_to,
              created_by: p.created_by,
              deadline: new Date().toISOString().slice(0, 10),
            })
            .select('id')
            .maybeSingle();
          if (actErr) { errMsg = actErr.message; break; }
          result = { activity_id: act?.id };
          success = true;
          break;
        }

        default:
          errMsg = `step desconhecido: ${ckpt.step}`;
      }
    } catch (e) {
      errMsg = e instanceof Error ? e.message : String(e);
    }

    await ext
      .from('onboarding_checkpoints')
      .update({
        status: success ? 'done' : 'failed',
        result,
        error_message: success ? null : errMsg,
        confirmed_by: success ? user_id || null : null,
        confirmed_at: success ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', checkpoint_id);

    return ok({ success, result, error: success ? undefined : errMsg });
  } catch (e) {
    return ok({ success: false, error: e instanceof Error ? e.message : String(e) });
  }
};
