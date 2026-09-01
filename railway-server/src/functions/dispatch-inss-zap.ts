import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import { dentroDaJanela, JANELA_FIM_HORA, JANELA_INICIO_HORA } from '../lib/inss-mensagem-cliente';
import {
  descreverErro,
  enviarDocumentoAoGrupo,
  enviarTextoAoGrupo,
  resolverGrupoDoLead,
} from '../lib/inss-zap';
import { exigeProcuracao, extrairPontosPendentes } from '../lib/inss-despacho';
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
                  caption:
                    'Segue a procuração para assinar. É só imprimir, assinar à caneta (a ' +
                    'assinatura precisa ficar parecida com a do seu documento), tirar foto e ' +
                    'mandar aqui.',
                  instance_name: sent.instancia || destino.grupo.instance_name,
                });
                if (!doc.ok) {
                  console.warn(
                    `[dispatch-inss-zap] procuração não foi ao grupo: ${descreverErro(doc)}`,
                  );
                }
              }
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
