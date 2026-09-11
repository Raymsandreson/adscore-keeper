// Sugere de que assunto é a indicação, lendo o contexto da conversa.
//
// Por que a IA e não um campo em branco: o cartão chega sem rótulo. O que diz
// se aquele contato é consignado, BPC do filho autista, acidente de trabalho ou
// um parceiro que só quer conversar está nas mensagens ao redor do cartão —
// "esse aqui é o rapaz do INSS que te falei", "o pai do menino autista".
// Quem lê isso na mão para 24 cartões por dia não lê.
//
// A saída é SUGESTÃO e é gravada como sugestão (ai_suggested_product). O que
// entra em relatório é o que um humano confirmou (product_name), porque
// classificação errada em relatório de gestão é pior que classificação
// nenhuma: ninguém desconfia de um número que já está na tela.
import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import { geminiChat } from '../lib/gemini';

/** Quantas mensagens ao redor do cartão a IA lê. Mais que isso é caro e não
 *  melhora: o contexto da indicação está sempre coladinho no compartilhamento. */
const JANELA_DE_MENSAGENS = 20;

interface CorpoDaChamada {
  referral_id?: string;
  /** Produtos do Cloud (a tela já os carrega). Sem eles a IA responde texto livre. */
  products?: Array<{ id?: string; name?: string }>;
  /** Reclassificar mesmo já tendo sugestão. */
  force?: boolean;
}

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const { referral_id, products, force } = (req.body || {}) as CorpoDaChamada;
    if (!referral_id) return ok({ success: false, error: 'referral_id é obrigatório' });

    const { data: indicacao } = await supabase
      .from('referrals')
      .select('id, referrer_phone, referrer_name, indicated_name, indicated_company, instance_name, shared_at, ai_suggested_product')
      .eq('id', referral_id)
      .maybeSingle();

    if (!indicacao) return ok({ success: false, error: 'indicação não encontrada' });
    if ((indicacao as any).ai_suggested_product && !force) {
      return ok({ success: true, skipped: true, reason: 'já classificada', suggestion: (indicacao as any).ai_suggested_product });
    }

    const contexto = await contextoDaConversa(
      (indicacao as any).referrer_phone,
      (indicacao as any).instance_name,
      (indicacao as any).shared_at,
    );

    const catalogo = (products || [])
      .map(p => p?.name)
      .filter((n): n is string => !!n && n.trim().length > 0);

    const instrucoes = [
      'Você classifica INDICAÇÕES de um escritório de advocacia brasileiro.',
      'Alguém compartilhou o contato de outra pessoa numa conversa de WhatsApp.',
      'Sua tarefa: dizer de que assunto essa indicação provavelmente é, lendo o contexto.',
      '',
      catalogo.length
        ? `Serviços do escritório (prefira UM destes nomes, exatamente como escrito):\n- ${catalogo.join('\n- ')}`
        : 'Não há catálogo de serviços disponível; responda com um rótulo curto em português.',
      '',
      'Além dos serviços, estes rótulos são válidos quando couberem:',
      '- "Parceiro" (quem indica ou recebe indicação, não é cliente)',
      '- "Fornecedor"',
      '- "Não é indicação" (cartório, banco, entrega, número da própria casa, engano)',
      '- "Indefinido" (o contexto não deixa claro — é melhor que chutar)',
      '',
      'Responda SOMENTE um JSON, sem markdown, neste formato:',
      '{"produto":"<rótulo>","motivo":"<uma frase curta citando o que na conversa te levou a isso>","confianca":<0 a 1>}',
      'Se o contexto não sustentar o rótulo, use "Indefinido" com confianca baixa. Não invente doença, benefício nem parentesco que não esteja escrito.',
    ].join('\n');

    const entrada = [
      `Contato indicado: ${(indicacao as any).indicated_name}` +
        ((indicacao as any).indicated_company ? ` (empresa: ${(indicacao as any).indicated_company})` : ''),
      `Quem compartilhou: ${(indicacao as any).referrer_name || (indicacao as any).referrer_phone}`,
      '',
      contexto || '(sem mensagens de texto ao redor do compartilhamento)',
    ].join('\n');

    let bruto = '';
    try {
      const resposta = await geminiChat({
        model: 'google/gemini-3.6-flash',
        messages: [
          { role: 'system', content: instrucoes },
          { role: 'user', content: entrada },
        ],
        temperature: 0.2,
        max_tokens: 300,
      });
      bruto = String(resposta?.choices?.[0]?.message?.content || '').trim();
    } catch (e: any) {
      console.error('[indicacoes/classificar] IA falhou:', e?.message);
      return ok({ success: false, error: 'falha na IA' });
    }

    const lido = lerJson(bruto);
    if (!lido) return ok({ success: false, error: 'a IA não devolveu JSON legível', raw: bruto.slice(0, 200) });

    const { error } = await supabase
      .from('referrals')
      .update({
        ai_suggested_product: lido.produto,
        ai_reason: lido.motivo,
        ai_confidence: lido.confianca,
        ai_classified_at: new Date().toISOString(),
      })
      .eq('id', referral_id);

    if (error) return ok({ success: false, error: error.message });

    return ok({ success: true, suggestion: lido.produto, reason: lido.motivo, confidence: lido.confianca });
  } catch (err) {
    console.error('[indicacoes/classificar] erro:', err);
    return ok({ success: false, error: err instanceof Error ? err.message : 'erro desconhecido' });
  }
};

/**
 * Mensagens ao redor do compartilhamento — antes E depois.
 *
 * O pedido costuma vir ANTES ("me passa o contato do seu cunhado que tem o
 * caso do INSS") e a explicação DEPOIS ("é esse aí, o pai do menino autista").
 * Ler só para trás perde metade dos casos.
 */
async function contextoDaConversa(
  phone: string,
  instanceName: string | null,
  sharedAt: string,
): Promise<string> {
  try {
    const [antes, depois] = await Promise.all([
      supabase
        .from('whatsapp_messages')
        .select('created_at, direction, message_text, message_type')
        .eq('phone', phone)
        .lte('created_at', sharedAt)
        .order('created_at', { ascending: false })
        .limit(JANELA_DE_MENSAGENS),
      supabase
        .from('whatsapp_messages')
        .select('created_at, direction, message_text, message_type')
        .eq('phone', phone)
        .gt('created_at', sharedAt)
        .order('created_at', { ascending: true })
        .limit(JANELA_DE_MENSAGENS / 2),
    ]);

    const linhas = [...(antes.data || []).reverse(), ...(depois.data || [])]
      .map((m: any) => {
        const quem = m.direction === 'inbound' ? 'PESSOA' : 'ESCRITÓRIO';
        const texto = (m.message_text && String(m.message_text).trim())
          || (m.message_type && m.message_type !== 'text' ? `[${m.message_type}]` : '');
        return texto ? `${quem}: ${texto.replace(/\s+/g, ' ').slice(0, 300)}` : '';
      })
      .filter(Boolean);

    return linhas.length ? `--- CONVERSA AO REDOR DO COMPARTILHAMENTO ---\n${linhas.join('\n')}` : '';
  } catch (e: any) {
    console.warn('[indicacoes/classificar] sem contexto (segue):', e?.message);
    return '';
  }
}

/** A IA às vezes embrulha o JSON em ```json. Tira o embrulho antes de ler. */
function lerJson(bruto: string): { produto: string; motivo: string; confianca: number } | null {
  const limpo = bruto.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/,'').trim();
  const inicio = limpo.indexOf('{');
  const fim = limpo.lastIndexOf('}');
  if (inicio === -1 || fim <= inicio) return null;
  try {
    const obj = JSON.parse(limpo.slice(inicio, fim + 1));
    const produto = String(obj.produto || obj.product || '').trim();
    if (!produto) return null;
    const bruta = Number(obj.confianca ?? obj.confidence);
    return {
      produto,
      motivo: String(obj.motivo || obj.reason || '').trim().slice(0, 500),
      confianca: Number.isFinite(bruta) ? Math.min(1, Math.max(0, bruta)) : 0.5,
    };
  } catch {
    return null;
  }
}
