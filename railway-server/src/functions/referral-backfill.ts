// Backfill das indicações — recupera os cartões que já chegaram e ninguém viu.
//
// Os cartões dos últimos meses estão todos gravados (em `metadata`), só nunca
// foram lidos. Sem este passo a tela de Indicações nasce vazia e a equipe
// acha que a função não funciona.
//
// Como varre sem derrubar o banco: `whatsapp_messages` tem 1,7 milhão de
// linhas e NÃO tem índice em metadata (jsonb) — um `where metadata->...` na
// tabela inteira é varredura completa, e foi exatamente isso que estourou o
// timeout quando medimos (60s, duas vezes). A varredura aqui é DIA A DIA: cada
// consulta filtra primeiro por `created_at` (que tem índice), reduzindo a ~7
// mil linhas, e só então olha o jsonb. Cada dia responde em instantes e o banco
// nunca fica preso numa consulta longa.
//
// É seguro repetir: a gravação é idempotente pelo índice único
// (source_message_id, indicated_phone).
import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import { capturarIndicacao } from '../lib/referral-capture';

interface CorpoDaChamada {
  /** Quantos dias para trás. Padrão 90. */
  days?: number;
  /** Só conta o que encontraria, sem gravar nada. */
  dry_run?: boolean;
  /** Teto de mensagens processadas por chamada, para a requisição não expirar. */
  limit?: number;
}

const DIAS_PADRAO = 90;
const TETO_PADRAO = 5000;

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const { days = DIAS_PADRAO, dry_run = false, limit = TETO_PADRAO } = (req.body || {}) as CorpoDaChamada;

    const inicio = Date.now();
    let mensagensComCartao = 0;
    let capturadas = 0;
    let ignoradas = 0;
    let diasVarridos = 0;
    let interrompidoEm: string | null = null;

    // Do mais recente para o mais antigo: se o teto cortar, o que ficou de fora
    // é o histórico velho, não a semana passada.
    for (let d = 0; d < days; d++) {
      const fim = new Date(Date.now() - d * 86_400_000);
      const comeco = new Date(fim.getTime() - 86_400_000);

      const { data, error } = await supabase
        .from('whatsapp_messages')
        .select('id, phone, contact_name, instance_name, direction, external_message_id, created_at, msg:metadata->message')
        .gte('created_at', comeco.toISOString())
        .lt('created_at', fim.toISOString())
        .eq('metadata->message->>mediaType', 'vcard')
        .eq('direction', 'inbound');

      if (error) {
        console.error('[indicacoes/backfill] erro no dia', comeco.toISOString().slice(0, 10), error.message);
        continue;
      }

      diasVarridos++;
      const linhas = data || [];
      mensagensComCartao += linhas.length;

      for (const linha of linhas) {
        const l = linha as any;
        if (dry_run) continue;

        const r = await capturarIndicacao(supabase, {
          message: l.msg,
          chatPhone: l.phone,
          chatName: l.contact_name,
          externalMessageId: l.external_message_id,
          messageRowId: l.id,
          instanceName: l.instance_name,
          direction: 'inbound',
          isGroup: String(l.phone || '').startsWith('120363'),
          senderPhone: l.msg?.sender_pn || l.msg?.sender || null,
          sharedAt: l.created_at,
        });
        capturadas += r.capturadas;
        ignoradas += r.ignoradas;
      }

      if (mensagensComCartao >= limit) {
        interrompidoEm = comeco.toISOString().slice(0, 10);
        break;
      }
    }

    const resumo = {
      success: true,
      dry_run,
      dias_varridos: diasVarridos,
      mensagens_com_cartao: mensagensComCartao,
      indicacoes_gravadas: capturadas,
      cartoes_ignorados: ignoradas,
      interrompido_em: interrompidoEm,
      segundos: Math.round((Date.now() - inicio) / 1000),
    };
    console.log('[indicacoes/backfill]', resumo);
    return ok(resumo);
  } catch (err) {
    console.error('[indicacoes/backfill] erro:', err);
    return ok({ success: false, error: err instanceof Error ? err.message : 'erro desconhecido' });
  }
};
