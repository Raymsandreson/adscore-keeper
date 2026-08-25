import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import { geminiChat } from '../lib/gemini';
import { classifyResultado, extrairPontosPendentes } from '../lib/inss-despacho';
import { donoDaAtualizacaoInss } from '../lib/inss-roteamento';

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


/**
 * Rótulo canônico de caso/processo em atividade: "<número> - <título>".
 * Mesmo formato do `formatProcessLabel` do front (`src/lib/processLabel.ts`),
 * reescrito aqui porque o railway-server não compartilha o bundle do app.
 */
function formatLabel(numero?: string | null, titulo?: string | null): string {
  const trim = (v?: string | null) => (v || '').replace(/^[\s\-–—]+/, '').replace(/[\s\-–—]+$/, '');
  return [numero, titulo].map(trim).filter(Boolean).join(' - ');
}

const onlyDigits = (v?: string | null) => (v || '').replace(/\D/g, '');

/**
 * Acha em `lead_processes` o processo do requerimento do INSS.
 *
 * `inss_admin_processes` e `lead_processes` são tabelas distintas e o elo entre
 * elas é o número do requerimento gravado em `process_number` — que ali não tem
 * formato garantido (pode vir com ponto/traço), daí a comparação por dígitos.
 * Procura primeiro no caso e só depois no lead inteiro, para não pegar processo
 * de outro caso do mesmo cliente.
 */
async function findLeadProcess(
  caseId: string | null,
  leadId: string | null,
  requerimento?: string | null,
): Promise<{ id: string; title: string | null; process_number: string | null } | null> {
  const alvo = onlyDigits(requerimento);
  if (!alvo) return null;
  // Duas colunas guardam o requerimento: `process_number` (cadastro antigo, que
  // mistura CNJ e requerimento) e `protocolo_administrativo` (a coluna própria,
  // preenchida em 275 processos no backfill de 25/08/2026). Conferir só a
  // primeira deixava 106 das 399 atividades sem processo vinculado.
  const cols = 'id, title, process_number, protocolo_administrativo';
  const casa = (p: any) =>
    onlyDigits(p.process_number) === alvo || onlyDigits(p.protocolo_administrativo) === alvo;

  if (caseId) {
    const { data: doCaso } = await supabase.from('lead_processes').select(cols).eq('case_id', caseId);
    const noCaso = (doCaso || []).find(casa);
    if (noCaso) return noCaso as any;
  }
  if (!leadId) return null;
  const { data: doLead } = await supabase.from('lead_processes').select(cols).eq('lead_id', leadId);
  return ((doLead || []).find(casa) as any) || null;
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
    const caseInfo: any = proc.legal_cases;
    const leadId: string | null = proc.lead_id || caseInfo?.lead_id || null;

    // Até 25/08/2026 requerimento sem caso saía daqui sem atividade nenhuma —
    // 546 dos 986 estão nesse estado, ou seja, mais da metade dos e-mails do
    // INSS não virava tarefa de ninguém. Agora basta ter LEAD: a atividade
    // nasce ligada a ele e o caso entra depois, quando o vínculo for feito.
    // Sem lead e sem caso não há onde pendurar, e a fila de vínculo
    // (match-inss-orphans) é quem resolve.
    if (!proc.case_id && !leadId) {
      return res.status(200).json({ success: false, error: 'process without case and without lead' });
    }

    // Pega updates não notificados (último primeiro), até 5
    const { data: pending } = await supabase
      .from('inss_status_history')
      .select('id, from_status, to_status, email_subject, email_received_at, despacho')
      .eq('process_id', processId)
      .eq('notified', false)
      .order('email_received_at', { ascending: false })
      .limit(5);

    if (!pending || pending.length === 0) {
      return res.status(200).json({ success: true, message: 'nothing to notify' });
    }

    const latest = pending[0];

    // 1) Cria atividade no Externo
    // "Concluída" sozinho não diz o desfecho: o INSS só manda o veredito no
    // Despacho do corpo, que o sync já classificou em proc.resultado.
    // O veredito não vem do INSS pronto: "Concluída" é tudo que o assunto diz, e
    // deferido/indeferido está no texto do Despacho. `proc.resultado` guarda o
    // que o sync classificou, mas ficou nulo em 21 das 111 conclusões — daí a
    // segunda tentativa, classificando o despacho deste evento na hora.
    const RESULTADO_LABELS: Record<string, string> = {
      deferido: 'DEFERIDO',
      indeferido: 'INDEFERIDO',
      arquivado_decurso: 'arquivado por exigência não cumprida',
    };
    const ehConclusao = /conclu[íi]d/i.test(latest.to_status || '');
    const resultado = ehConclusao
      ? (proc.resultado || classifyResultado(latest.despacho) || null)
      : null;
    const statusLabel = ehConclusao
      ? `Conclusão — ${resultado ? RESULTADO_LABELS[resultado] : 'sem veredito no despacho'}`
      : latest.to_status;
    const activityTitle = `INSS atualizou ${proc.requerimento_number}: ${statusLabel}`;
    // O nome do lead é o que diz a matéria ("Família 400" e "CASO 146" são
    // trabalhistas; "PREV 1800" é previdenciário) — ver lib/inss-roteamento.
    let leadName: string | null = null;
    if (leadId) {
      const { data: lead } = await supabase
        .from('leads').select('lead_name').eq('id', leadId).maybeSingle();
      leadName = lead?.lead_name || null;
    }
    const dono = donoDaAtualizacaoInss({ status: latest.to_status, leadName });

    // Exigência sem o texto vira "vá ver no Meu INSS". Os pontos pendentes saem
    // do próprio despacho (preenchido em 552 das 592 exigências).
    const pontosPendentes = /exig[êe]nc/i.test(latest.to_status || '')
      ? extrairPontosPendentes(latest.despacho)
      : null;

    const activityDesc = [
      `Status mudou de "${latest.from_status || 'sem status anterior'}" → "${statusLabel}".`,
      pontosPendentes ? `\n📋 PENDÊNCIAS APONTADAS PELO INSS:\n${pontosPendentes}` : '',
      `\nAssunto do email: ${latest.email_subject}\nRecebido em: ${latest.email_received_at}`,
      caseInfo ? `\nCaso: ${caseInfo.case_number || ''} — ${caseInfo.title || ''}` : '',
    ].filter(Boolean).join('\n');

    // Vínculo com caso e processo: até 17/08/2026 o insert levava só `lead_id`,
    // e 205 das 252 atividades nasceram órfãs — todas com caso disponível (o
    // guard lá em cima já barra processo sem `case_id`). O caso ia como texto na
    // descrição, então a atividade caía na lista sem caso nem nº de processo.
    // O processo casa pelo número do requerimento, que já está no título.
    const process = await findLeadProcess(proc.case_id, leadId, proc.requerimento_number);

    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      title: activityTitle,
      description: activityDesc,
      activity_type: 'notificacao',
      status: 'pendente',
      priority: 'normal',
      assigned_to: dono.id,
      assigned_to_name: dono.name,
      deadline: new Date().toISOString().slice(0, 10),
      case_id: proc.case_id,
      case_title: formatLabel(caseInfo?.case_number, caseInfo?.title) || null,
      process_id: process?.id || null,
      process_title: process ? formatLabel(process.process_number, process.title) || null : null,
    } as any);

    // 2) Acha o grupo do lead e manda zap humanizado
    let sentToGroup = false;
    let humanText: string | null = null;
    // O zap vai para o CLIENTE. Ele só existia para requerimento com caso, e
    // ampliar isso junto com a atividade seria estender uma mensagem externa
    // sem ninguém ter pedido — o caminho novo (só lead) cria a tarefa e cala.
    if (leadId && proc.case_id) {
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
