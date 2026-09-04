import { useEffect, useRef, useState } from 'react';
import { db } from '@/integrations/supabase';

/**
 * Quem da equipe mandou cada mensagem enviada.
 *
 * O nome sai de `whatsapp_message_authors` (Supabase Externo), gravada pela
 * edge `send-whatsapp` v28 a partir do JWT de quem clicou em enviar. É a única
 * fonte de autoria que cobre ÁUDIO e MÍDIA: a assinatura `*Nome:*` só existe
 * dentro do texto, e mídia sai sem ela.
 *
 * Vale para o que foi enviado a partir do sistema, de v28 em diante. Mensagem
 * antiga, ou mandada direto do aparelho, não tem linha aqui — e aí a bolha cai
 * no fallback da assinatura no texto, ou fica sem autor mesmo. Nunca chuta.
 *
 * Consulta em lote por `external_message_id` (chave primária da tabela) e
 * guarda o que já perguntou: reabrir a conversa ou paginar pra trás não
 * repergunta o que já está em memória.
 */
export function useAutoriaDasMensagens(
  messages: Array<{ external_message_id?: string | null; direction?: string | null }> | undefined
): Record<string, string> {
  const [autorPorMensagem, setAutorPorMensagem] = useState<Record<string, string>>({});
  /** Ids já consultados — inclusive os que voltaram sem autor, pra não reperguntar. */
  const consultados = useRef<Set<string>>(new Set());

  const idsOutbound = (messages || [])
    .filter((m) => m?.direction === 'outbound' && m?.external_message_id)
    .map((m) => String(m.external_message_id));
  // A chave do efeito é a lista de ids: só refaz query quando entra id novo.
  const chave = idsOutbound.join('|');

  useEffect(() => {
    const novos = Array.from(new Set(idsOutbound)).filter((id) => !consultados.current.has(id));
    if (novos.length === 0) return;

    let cancelado = false;
    (async () => {
      // Lotes: o `in` vira querystring e uma conversa longa passa fácil de 300 ids.
      const LOTE = 200;
      for (let i = 0; i < novos.length; i += LOTE) {
        const fatia = novos.slice(i, i + LOTE);
        const { data, error } = await (db as any)
          .from('whatsapp_message_authors')
          .select('external_message_id, sent_by_name')
          .in('external_message_id', fatia);

        if (cancelado) return;
        if (error) {
          // Tabela ainda não migrada ou RLS negando: a bolha simplesmente cai no
          // fallback da assinatura. Não é erro de tela.
          console.warn('[useAutoriaDasMensagens] autoria indisponível:', error.message);
          return;
        }

        fatia.forEach((id) => consultados.current.add(id));
        const achados: Record<string, string> = {};
        for (const row of data || []) {
          if (row?.external_message_id && row?.sent_by_name) {
            achados[row.external_message_id] = row.sent_by_name;
          }
        }
        if (Object.keys(achados).length > 0) {
          setAutorPorMensagem((prev) => ({ ...prev, ...achados }));
        }
      }
    })();

    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  return autorPorMensagem;
}
