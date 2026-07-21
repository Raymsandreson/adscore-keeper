import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import { geminiChat } from '../lib/gemini';

/**
 * Quando chega um update do INSS para processo já vinculado:
 *  1) cria atividade no caso (Dar andamento)
 *  2) envia zap humanizado no grupo do lead via UazAPI
 *
 * Body: { process_id: string, force_history_id?: string }
 */

async function humanizeStatusChange(input: {
  from?: string | null;
  to: string;
  nome?: string | null;
  beneficio?: string | null;
}): Promise<string> {
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key) {
    return `Olá! 👋 Temos uma atualização do seu pedido junto ao INSS.\n\nO status mudou para *${input.to}*.\n\nVamos verificar o que isso significa e te retornar em seguida. 🙏`;
  }
  try {
    const prompt = `Você é uma atendente jurídica gentil. Escreva uma mensagem de WhatsApp CURTA (máx 4 linhas), em português brasileiro simples — entendível por alguém com baixa escolaridade — informando que o pedido do INSS teve uma atualização.\n\nDe: ${input.from || 'sem status anterior'}\nPara: ${input.to}\nNome do cliente (se houver): ${input.nome || ''}\nBenefício (se houver): ${input.beneficio || ''}\n\nRegras:\n- Sem termos técnicos jurídicos.\n- Sem citar "requerimento", use "pedido".\n- Explique em 1 linha o que esse status significa na prática.\n- Termine com algo tipo "vamos te orientar" ou "te avisaremos os próximos passos".\n- Use 1 ou 2 emojis no total, no máximo.\n- Não use saudações como "Bom dia" (não sabemos a hora).`;
    const j = await geminiChat({
      model: 'google/gemini-3.6-flash',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
    });
    const txt = j?.choices?.[0]?.message?.content?.trim();
    if (txt) return txt;
  } catch (e) {
    console.warn('[notify-inss-update] AI humanize failed, using fallback', e);
  }
  return `Olá! 👋 Atualização do seu pedido no INSS: agora ele está como *${input.to}*. Vamos verificar e te dizer o próximo passo.`;
}


async function sendUazapiText(args: {
  group_jid: string;
  text: string;
  instance_name?: string | null;
}): Promise<{ ok: boolean; status: number; body?: any }> {
  // Pega 1ª instância ativa (preferindo a do grupo se vier)
  let instanceQuery = supabase
    .from('whatsapp_instances')
    .select('id, instance_name, instance_token, base_url')
    .eq('is_active', true);
  if (args.instance_name) instanceQuery = instanceQuery.eq('instance_name', args.instance_name);
  const { data: instances } = await instanceQuery.limit(1);
  const inst = instances?.[0];
  if (!inst) return { ok: false, status: 0, body: 'no active instance' };
  const base = (inst.base_url || 'https://abraci.uazapi.com').replace(/\/$/, '');
  const resp = await fetch(`${base}/send/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: inst.instance_token },
    body: JSON.stringify({ number: args.group_jid, text: args.text }),
  });
  let body: any = null;
  try { body = await resp.json(); } catch { body = await resp.text().catch(() => null); }
  return { ok: resp.ok, status: resp.status, body };
}

export const handler: RequestHandler = async (req, res) => {
  const processId: string | undefined = req.body?.process_id;
  if (!processId) {
    return res.status(200).json({ success: false, error: 'process_id required' });
  }

  try {
    // Carrega processo + ultimos updates não notificados
    const { data: proc, error: procErr } = await supabase
      .from('inss_admin_processes')
      .select('*, legal_cases:case_id(id, case_number, title, lead_id)')
      .eq('id', processId)
      .maybeSingle();
    if (procErr || !proc) {
      return res.status(200).json({ success: false, error: procErr?.message || 'process not found' });
    }
    if (!proc.case_id) {
      return res.status(200).json({ success: false, error: 'process not linked to a case' });
    }

    const caseInfo: any = proc.legal_cases;
    const leadId: string | null = proc.lead_id || caseInfo?.lead_id || null;

    // Pega updates não notificados (último primeiro), até 5
    const { data: pending } = await supabase
      .from('inss_status_history')
      .select('id, from_status, to_status, email_subject, email_received_at')
      .eq('process_id', processId)
      .eq('notified', false)
      .order('email_received_at', { ascending: false })
      .limit(5);

    if (!pending || pending.length === 0) {
      return res.status(200).json({ success: true, message: 'nothing to notify' });
    }

    const latest = pending[0];

    // 1) Cria atividade no Externo
    const activityTitle = `INSS atualizou ${proc.requerimento_number}: ${latest.to_status}`;
    const activityDesc = `Status mudou de "${latest.from_status || 'sem status anterior'}" → "${latest.to_status}".\n\nAssunto do email: ${latest.email_subject}\nRecebido em: ${latest.email_received_at}\n\nCaso: ${caseInfo?.case_number || ''} — ${caseInfo?.title || ''}`;
    let assignedTo: string | null = null;
    if (leadId) {
      const { data: lead } = await supabase
        .from('leads')
        .select('assigned_to')
        .eq('id', leadId)
        .maybeSingle();
      assignedTo = lead?.assigned_to || null;
    }
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      title: activityTitle,
      description: activityDesc,
      activity_type: 'notificacao',
      status: 'pendente',
      priority: 'normal',
      assigned_to: assignedTo,
      deadline: new Date().toISOString().slice(0, 10),
    } as any);

    // 2) Acha o grupo do lead e manda zap humanizado
    let sentToGroup = false;
    let humanText: string | null = null;
    if (leadId) {
      const { data: groups } = await supabase
        .from('lead_whatsapp_groups')
        .select('group_jid, instance_name')
        .eq('lead_id', leadId)
        .limit(1);
      const group = groups?.[0];
      if (group) {
        humanText = await humanizeStatusChange({
          from: latest.from_status,
          to: latest.to_status,
          nome: proc.nome_segurado,
          beneficio: proc.benefit_type,
        });
        const sent = await sendUazapiText({
          group_jid: group.group_jid,
          text: humanText,
          instance_name: group.instance_name,
        });
        sentToGroup = sent.ok;
      }
    }

    // 3) Marca como notificado
    const ids = pending.map((p) => p.id);
    await supabase
      .from('inss_status_history')
      .update({ notified: true, notified_at: new Date().toISOString() })
      .in('id', ids);

    return res.status(200).json({
      success: true,
      activity_created: true,
      group_message_sent: sentToGroup,
      humanized_preview: humanText?.slice(0, 200),
      notified_count: ids.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[notify-inss-update] error:', msg);
    return res.status(200).json({ success: false, error: msg });
  }
};
