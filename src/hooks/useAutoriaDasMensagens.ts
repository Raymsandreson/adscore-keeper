import { useEffect, useRef, useState } from 'react';
import { db } from '@/integrations/supabase';

/**
 * O id da mensagem no WhatsApp, sem o dono.
 *
 * `external_message_id` da UazAPI vem como `<número do dono>:<id da mensagem>`,
 * e o prefixo é de QUEM REGISTROU a linha: num grupo, a mesma mensagem aparece
 * uma vez por instância que participa, cada uma com o seu prefixo. Casar
 * autoria pelo id inteiro acertava 5 de 11 casos em produção; pelo id da
 * mensagem, 9 de 11. Do lado do banco existe a coluna gerada `wa_message_id`,
 * que aplica exatamente esta regra.
 */
export function idDaMensagemNoWhatsApp(externalMessageId: string | null | undefined): string {
  const bruto = (externalMessageId || '').trim();
  if (!bruto) return '';
  const sep = bruto.indexOf(':');
  return sep >= 0 ? bruto.slice(sep + 1) : bruto;
}

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
 * Devolve um mapa indexado por `idDaMensagemNoWhatsApp`. Consulta em lote e
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
    .map((m) => idDaMensagemNoWhatsApp(m.external_message_id))
    .filter(Boolean);
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
          .select('wa_message_id, sent_by_name')
          .in('wa_message_id', fatia);

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
          if (row?.wa_message_id && row?.sent_by_name) {
            achados[row.wa_message_id] = row.sent_by_name;
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
