import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import { dentroDaJanela, JANELA_FIM_HORA, JANELA_INICIO_HORA } from '../lib/inss-mensagem-cliente';
import {
  descreverErro,
  enviarDocumentoAoGrupo,
  enviarTextoAoGrupo,
  LEGENDA_PROCURACAO,
  resolverGrupoDoLead,
} from '../lib/inss-zap';
import { exigeProcuracao, extrairPontosPendentes, separarPendencias } from '../lib/inss-despacho';
import { mandarAudioDaMensagem } from '../lib/inss-audio';
import { avisoDeFalhaNoEnvio } from '../lib/inss-falha-envio';
import { ASSESSOR_INSS } from '../lib/inss-roteamento';
import { buscarProcuracaoDoCliente } from '../lib/inss-procuracao';

/**
 * Despacha a fila de mensagens do INSS que ficou esperando a janela de 8h–20h.
 *
 * Quem enche a fila é o `notify-inss-update`: e-mail que chega de madrugada tem
 * o texto redigido na hora e gravado como `zap_status = 'agendado'`. Este
 * handler roda de 10 em 10 minutos e entrega o que está pronto assim que o
 * horário permite. 28% dos e-mails do INSS chegam fora da janela.
 *
 * Body opcional: { force: true } ignora a janela (uso manual/diagnóstico).
 */

const LOTE = 30;
const PAUSA_ENTRE_ENVIOS_MS = 400;
/** Mensagem parada há mais de uma semana virou notícia velha: não vai. */
const VALIDADE_DIAS = 7;


/**
 * Leva o aviso de falha até a atividade que nasceu deste mesmo evento.
 *
 * A fila não guarda o id da atividade — ela roda horas depois, num processo
 * separado. O elo é o par (lead, momento): o `notify-inss-update` cria a
 * atividade ao processar o e-mail e só então agenda a mensagem, então a
 * primeira atividade do robô naquele lead a partir de `email_received_at` é a
 * deste evento. Não achando, o aviso vira atividade própria em vez de sumir —
 * é o desfecho que a falha silenciosa não tinha.
 */
async function avisarFalhaNaFila(args: {
  leadId: string | null;
  emailRecebidoEm?: string | null;
  zapErro?: string | null;
  tipo?: string | null;
}): Promise<void> {
  if (!args.leadId) return;
  const aviso = avisoDeFalhaNoEnvio({ zapErro: args.zapErro, tipo: args.tipo });

  let q = supabase
    .from('lead_activities')
    .select('id, description, title, case_id, case_title, process_id, process_title')
    .eq('lead_id', args.leadId)
    .eq('action_source_detail', 'Robô do INSS')
    .order('created_at', { ascending: true })
    .limit(1);
  if (args.emailRecebidoEm) q = q.gte('created_at', args.emailRecebidoEm);
  const { data: achadas } = await q;
  const alvo = achadas?.[0] as any;

  if (alvo?.id) {
    await supabase
      .from('lead_activities')
      .update({ description: `${alvo.description || ''}${aviso}` })
      .eq('id', alvo.id);
    return;
  }

  const { error } = await supabase.from('lead_activities').insert({
    lead_id: args.leadId,
    title: 'Aviso do INSS não chegou ao cliente',
    description: `O robô não conseguiu entregar a atualização do INSS neste grupo.${aviso}`,
    activity_type: 'notificacao',
    status: 'pendente',
    priority: 'normal',
    assigned_to: ASSESSOR_INSS.id,
    assigned_to_name: ASSESSOR_INSS.name,
    deadline: new Date().toISOString().slice(0, 10),
    action_source: 'system',
    action_source_detail: 'Robô do INSS',
  } as any);
  if (error) {
    console.warn(`[dispatch-inss-zap] aviso de falha não virou atividade: ${error.message}`);
  }
}

export const handler: RequestHandler = async (req, res) => {
  const forcar = req.body?.force === true;
  if (!forcar && !dentroDaJanela(new Date())) {
    return res.status(200).json({
      success: true,
      skipped: `fora da janela ${JANELA_INICIO_HORA}h–${JANELA_FIM_HORA}h`,
    });
  }

  try {
    const { data: fila, error } = await supabase
      .from('inss_status_history')
      .select('id, process_id, zap_texto, zap_tipo, email_received_at, despacho')
      .eq('zap_status', 'agendado')
      .order('email_received_at', { ascending: true })
      .limit(LOTE);
    if (error) return res.status(200).json({ success: false, error: error.message });
    if (!fila || fila.length === 0) {
      return res.status(200).json({ success: true, sent: 0, message: 'fila vazia' });
    }

    // Uma query para todos os processos do lote — não uma por linha.
    const processIds = [...new Set(fila.map((f: any) => f.process_id).filter(Boolean))];
    const { data: procs } = await supabase
      .from('inss_admin_processes')
      .select('id, lead_id, case_id, nome_segurado, cpf_segurado, legal_cases:case_id(lead_id)')
      .in('id', processIds);
    const leadPorProcesso = new Map<string, string | null>(
      (procs || []).map((p: any) => [p.id, p.lead_id || p.legal_cases?.lead_id || null]),
    );
    // O nome do segurado é uma das provas de que o grupo é mesmo desse cliente
    // quando o vínculo vem do campo legado — ver lib/inss-grupo-certeza.
    const cpfPorProcesso = new Map<string, string | null>(
      (procs || []).map((p: any) => [p.id, p.cpf_segurado || null]),
    );
    const seguradoPorProcesso = new Map<string, string | null>(
      (procs || []).map((p: any) => [p.id, p.nome_segurado || null]),
    );

    const limite = Date.now() - VALIDADE_DIAS * 24 * 60 * 60 * 1000;
    let enviados = 0;
    let falhas = 0;
    let expirados = 0;

    for (const item of fila as any[]) {
      const patch: Record<string, any> = {};
      const recebido = Date.parse(item.email_received_at || '');
      if (!item.zap_texto) {
        patch.zap_status = 'erro';
        patch.zap_erro = 'agendado sem texto';
      } else if (!Number.isNaN(recebido) && recebido < limite) {
        patch.zap_status = 'expirado';
        patch.zap_erro = `parado mais de ${VALIDADE_DIAS} dias na fila`;
        expirados++;
      } else {
        const destino = await resolverGrupoDoLead(leadPorProcesso.get(item.process_id) || null, {
          nomeSegurado: seguradoPorProcesso.get(item.process_id) || null,
        });
        if (destino.erro) {
          patch.zap_status = 'sem_grupo';
          patch.zap_erro = destino.erro;
        } else {
          const sent = await enviarTextoAoGrupo({
            group_jid: destino.grupo.group_jid,
            text: item.zap_texto,
            instance_name: destino.grupo.instance_name,
          });
          if (sent.ok) {
            patch.zap_status = 'enviado';
            patch.zap_enviado_at = new Date().toISOString();
            enviados++;
            // A procuração é recalculada aqui, e não guardada junto do texto:
            // assim a fila não depende de coluna nova e o PDF que vai é sempre
            // o mais recente do cliente. Ver lib/inss-procuracao.
            const pontos = extrairPontosPendentes(item.despacho);
            if (exigeProcuracao(pontos)) {
              const procuracao = await buscarProcuracaoDoCliente({
                leadId: leadPorProcesso.get(item.process_id) || null,
                cpfSegurado: cpfPorProcesso.get(item.process_id) || null,
                nomeSegurado: seguradoPorProcesso.get(item.process_id) || null,
              });
              if (procuracao) {
                const doc = await enviarDocumentoAoGrupo({
                  group_jid: destino.grupo.group_jid,
                  file_url: procuracao.url,
                  doc_name: 'procuracao-para-assinar.pdf',
                  caption: LEGENDA_PROCURACAO,
                  instance_name: sent.instancia || destino.grupo.instance_name,
                });
                if (!doc.ok) {
                  console.warn(
                    `[dispatch-inss-zap] procuração não foi ao grupo: ${descreverErro(doc)}`,
                  );
                }
              }
            }
            // Áudio pelo mesmo caminho do envio na hora. A fonte do assunto é a
            // pendência do CLIENTE, igual ao notify — o que é pendência nossa
            // ficou na atividade e não pode escolher o áudio dele.
            if (item.zap_tipo) {
              Object.assign(
                patch,
                await mandarAudioDaMensagem({
                  tipo: item.zap_tipo,
                  fonte: separarPendencias(pontos).cliente || item.despacho,
                  texto: item.zap_texto,
                  group_jid: destino.grupo.group_jid,
                  instancia: sent.instancia || destino.grupo.instance_name,
                }),
              );
            }
          } else {
            patch.zap_status = 'erro';
            patch.zap_erro = descreverErro(sent);
            falhas++;
          }
          await new Promise((r) => setTimeout(r, PAUSA_ENTRE_ENVIOS_MS));
        }
      }
      await supabase.from('inss_status_history').update(patch).eq('id', item.id);
      if (patch.zap_status === 'erro') {
        await avisarFalhaNaFila({
          leadId: leadPorProcesso.get(item.process_id) || null,
          emailRecebidoEm: item.email_received_at,
          zapErro: patch.zap_erro,
          tipo: item.zap_tipo,
        });
      }
    }

    console.log(
      `[dispatch-inss-zap] fila=${fila.length} enviados=${enviados} falhas=${falhas} expirados=${expirados}`,
    );
    return res.status(200).json({
      success: true,
      queued: fila.length,
      sent: enviados,
      failed: falhas,
      expired: expirados,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[dispatch-inss-zap] error:', msg);
    return res.status(200).json({ success: false, error: msg });
  }
};
