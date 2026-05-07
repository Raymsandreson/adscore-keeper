// Executa um checkpoint de onboarding pós-ZapSign após confirmação manual.
// Bloqueia avanço: só executa se o checkpoint anterior estiver `done`.
// Retorna SEMPRE 200 com { success, error? } por convenção do projeto.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const STEP_ORDER = [
  'create_group',
  'send_initial_message',
  'import_docs',
  'create_case_process',
  'create_onboarding_activity',
];

const EXT_URL = Deno.env.get('EXTERNAL_SUPABASE_URL')!;
const EXT_KEY = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY')!;
const CLOUD_URL = Deno.env.get('SUPABASE_URL')!;
const CLOUD_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function ok(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

async function callCloudFn(name: string, body: unknown) {
  const r = await fetch(`${CLOUD_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CLOUD_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok && (data?.success !== false), data };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const { checkpoint_id, user_id, extra } = await req.json();
    if (!checkpoint_id) return ok({ success: false, error: 'checkpoint_id required' });

    const ext = createClient(EXT_URL, EXT_KEY);

    const { data: ckpt, error: ckptErr } = await ext
      .from('onboarding_checkpoints')
      .select('*')
      .eq('id', checkpoint_id)
      .maybeSingle();
    if (ckptErr || !ckpt) return ok({ success: false, error: 'checkpoint not found' });
    if (ckpt.status === 'done') return ok({ success: true, already_done: true });

    // Bloqueio: passo anterior precisa estar 'done'
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
        case 'create_group': {
          // Idempotente: se lead já tem whatsapp_group_id, marca done
          const { data: lead } = await ext
            .from('leads')
            .select('whatsapp_group_id')
            .eq('id', ckpt.lead_id)
            .maybeSingle();
          if (lead?.whatsapp_group_id) {
            result = { group_jid: lead.whatsapp_group_id, reused: true };
            success = true;
            break;
          }
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
          });
          if (r.ok && r.data?.group_id) {
            await ext.from('leads').update({ whatsapp_group_id: r.data.group_id }).eq('id', ckpt.lead_id);
            result = { group_jid: r.data.group_id };
            success = true;
          } else {
            errMsg = r.data?.error || 'create-whatsapp-group falhou';
          }
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
          // Reaproveita import-group-docs-to-lead apenas se aprovado.
          // `extra.documents` vem da UI já com lista classificada/escolhida.
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
          // SEM defaults silenciosos: process_type e fee_percentage vêm do `extra`.
          const process_type = extra?.process_type as string;
          const fee_percentage = Number(extra?.fee_percentage);
          if (!process_type || !Number.isFinite(fee_percentage)) {
            errMsg = 'process_type e fee_percentage obrigatórios';
            break;
          }
          // Cria caso
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
});
