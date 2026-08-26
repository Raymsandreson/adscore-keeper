import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import { classifyResultado, extrairPontosPendentes } from '../lib/inss-despacho';
import { donoDaAtualizacaoInss } from '../lib/inss-roteamento';
import {
  classificarMensagemCliente,
  dentroDaJanela,
  eventoElegivelParaZap,
} from '../lib/inss-mensagem-cliente';
import {
  enviarTextoUazapi,
  jaAvisouEsseTipo,
  montarTextoMensagemCliente,
  resolverGrupoDoLead,
} from '../lib/inss-zap';

/**
 * Quando chega um update do INSS para processo já vinculado:
 *  1) cria atividade no caso (Dar andamento)
 *  2) envia zap humanizado no grupo do lead via UazAPI
 *
 * Body: { process_id: string, force_history_id?: string }
 */

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

    // 2) Mensagem para o grupo do cliente
    //
    // O grupo tem o cliente e a equipe. Nem todo evento vira mensagem, e o que
    // vira só sai entre 8h e 20h — ver lib/inss-mensagem-cliente. O que não pode
    // sair agora fica gravado como 'agendado' e o cron dispatch-inss-zap manda
    // quando a janela abrir; nada se perde e nada chega de madrugada.
    const entrada = {
      status: latest.to_status,
      resultado,
      despacho: latest.despacho,
      pontosPendentes,
      nome: proc.nome_segurado,
      beneficio: proc.benefit_type,
      requerimento: proc.requerimento_number,
    };
    const tipoMensagem = classificarMensagemCliente(entrada);
    let zapPatch: Record<string, any> = { zap_status: 'silencio' };
    let sentToGroup = false;
    let humanText: string | null = null;

    if (tipoMensagem) {
      if (!eventoElegivelParaZap(latest.email_received_at)) {
        // Ativação sem retroatividade (pedido do usuário, 26/08/2026): evento
        // anterior ao corte nunca vira mensagem, mesmo que só agora tenha sido
        // processado. São 1.480 eventos antigos nunca notificados no histórico.
        zapPatch = { zap_status: 'retroativo', zap_tipo: tipoMensagem };
      } else if (await jaAvisouEsseTipo(processId, tipoMensagem)) {
        zapPatch = { zap_status: 'repetido', zap_tipo: tipoMensagem };
      } else {
        const destino = await resolverGrupoDoLead(leadId);
        if (destino.erro) {
          zapPatch = { zap_status: 'sem_grupo', zap_tipo: tipoMensagem, zap_erro: destino.erro };
        } else {
          const { texto, via } = await montarTextoMensagemCliente(tipoMensagem, entrada);
          humanText = texto;
          if (!dentroDaJanela(new Date())) {
            zapPatch = { zap_status: 'agendado', zap_tipo: tipoMensagem, zap_texto: texto };
          } else {
            const sent = await enviarTextoUazapi({
              group_jid: destino.grupo.group_jid,
              text: texto,
              instance_name: destino.grupo.instance_name,
            });
            sentToGroup = sent.ok;
            zapPatch = sent.ok
              ? {
                  zap_status: 'enviado',
                  zap_tipo: tipoMensagem,
                  zap_texto: texto,
                  zap_enviado_at: new Date().toISOString(),
                }
              : {
                  zap_status: 'erro',
                  zap_tipo: tipoMensagem,
                  zap_texto: texto,
                  zap_erro: `uazapi ${sent.status}: ${String(sent.body).slice(0, 200)}`,
                };
          }
          console.log(
            `[notify-inss-update] zap tipo=${tipoMensagem} via=${via} status=${zapPatch.zap_status}`,
          );
        }
      }
    }

    // 3) Marca como notificado. Só o evento mais recente pode virar mensagem;
    // os outros do lote entram como 'suprimido' pra ninguém achar que sumiram.
    const agora = new Date().toISOString();
    await supabase
      .from('inss_status_history')
      .update({ notified: true, notified_at: agora, ...zapPatch })
      .eq('id', latest.id);
    const antigos = pending.slice(1).map((p) => p.id);
    if (antigos.length > 0) {
      await supabase
        .from('inss_status_history')
        .update({ notified: true, notified_at: agora, zap_status: 'suprimido' })
        .in('id', antigos);
    }
    const ids = pending.map((p) => p.id);

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
