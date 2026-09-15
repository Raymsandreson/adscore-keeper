// Apresentação ao contato indicado — rascunho pela IA, envio pela pessoa.
//
// O problema que resolve: o contato chegava e ficava parado. Quem indicou já
// avisou o indicado que "o pessoal vai te chamar", e quando ninguém chama, a
// indicação esfria e queima o indicador junto.
//
// Duas ações separadas de propósito:
//   draft → escreve o texto (quem indicou, assunto, tom humano) e guarda
//   send  → manda pelo WhatsApp e registra
//
// O envio NUNCA acontece sozinho. Quem chega por cartão compartilhado não é
// lead que pediu contato: é uma terceira pessoa que ainda não falou com a
// gente. Disparo automático para todo cartão recebido abordaria despachante,
// cartório e colega de trabalho junto com a indicação de verdade — e um número
// que faz isso em escala é bloqueado pelo WhatsApp. Por isso `send` exige a
// intenção explícita de quem está na tela.
import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import { geminiChat } from '../lib/gemini';

interface CorpoDaChamada {
  referral_id?: string;
  action?: 'draft' | 'send';
  /** No send: o texto que a pessoa leu/editou na tela. */
  text?: string;
  /** Quem clicou (user_id do Cloud), para o histórico. */
  user_id?: string;
}

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const { referral_id, action = 'draft', text, user_id } = (req.body || {}) as CorpoDaChamada;
    if (!referral_id) return ok({ success: false, error: 'referral_id é obrigatório' });

    const { data: indicacao } = await supabase
      .from('referrals')
      .select('id, indicated_name, indicated_phone, indicated_company, referrer_name, referrer_phone, product_name, ai_suggested_product, ai_reason, instance_name, status, outreach_sent_at, outreach_draft')
      .eq('id', referral_id)
      .maybeSingle();

    if (!indicacao) return ok({ success: false, error: 'indicação não encontrada' });
    const ind = indicacao as any;

    if (action === 'draft') {
      const rascunho = await escreverApresentacao(ind);
      if (!rascunho) return ok({ success: false, error: 'não consegui gerar o texto' });
      await supabase.from('referrals').update({ outreach_draft: rascunho }).eq('id', referral_id);
      return ok({ success: true, draft: rascunho });
    }

    // ===== ENVIO =====
    // Idempotência: uma indicação só recebe apresentação uma vez. Sem isso, dois
    // cliques (ou duas abas) abordam a mesma pessoa duas vezes.
    if (ind.outreach_sent_at) {
      return ok({ success: false, error: 'apresentação já enviada', sent_at: ind.outreach_sent_at });
    }

    const texto = (text || ind.outreach_draft || '').trim();
    if (!texto) return ok({ success: false, error: 'sem texto para enviar' });
    if (!ind.instance_name) return ok({ success: false, error: 'indicação sem instância de origem' });

    const { data: inst } = await supabase
      .from('whatsapp_instances')
      .select('instance_token, base_url')
      .ilike('instance_name', ind.instance_name)
      .limit(1)
      .maybeSingle();

    const token = (inst as any)?.instance_token;
    const baseUrl = (inst as any)?.base_url || 'https://abraci.uazapi.com';
    if (!token) return ok({ success: false, error: 'instância sem token' });

    let externalId: string | null = null;
    try {
      const resposta = await fetch(`${String(baseUrl).replace(/\/$/, '')}/send/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', token },
        body: JSON.stringify({ number: ind.indicated_phone, text: texto }),
      });
      const json: any = await resposta.json().catch(() => null);
      externalId = json?.id || json?.messageId || json?.key?.id || null;
      if (!resposta.ok) {
        console.warn('[indicacoes/apresentar] UazAPI recusou', resposta.status, json);
        return ok({ success: false, error: 'o WhatsApp recusou o envio' });
      }
    } catch (e: any) {
      console.error('[indicacoes/apresentar] erro no envio:', e?.message);
      return ok({ success: false, error: 'falha ao enviar pelo WhatsApp' });
    }

    const agora = new Date().toISOString();

    // Registra a mensagem para ela aparecer na conversa como qualquer outra.
    try {
      await supabase.from('whatsapp_messages').insert({
        phone: ind.indicated_phone,
        instance_name: ind.instance_name,
        message_text: texto,
        message_type: 'text',
        direction: 'outbound',
        status: 'sent',
        external_message_id: externalId,
        action_source: 'referral_outreach',
        action_source_detail: String(referral_id),
      } as any);
    } catch (e: any) {
      console.warn('[indicacoes/apresentar] não registrei a mensagem (não-fatal):', e?.message);
    }

    const { error } = await supabase
      .from('referrals')
      .update({
        outreach_sent_at: agora,
        outreach_message_id: externalId,
        outreach_draft: texto,
        outreach_sent_by_user_id: user_id || null,
        status: 'contatado',
      })
      .eq('id', referral_id);

    if (error) return ok({ success: false, error: error.message });

    console.log('[indicacoes/apresentar] enviada', { referral_id, phone: mascarar(ind.indicated_phone) });
    return ok({ success: true, sent: true, text: texto, external_message_id: externalId });
  } catch (err) {
    console.error('[indicacoes/apresentar] erro:', err);
    return ok({ success: false, error: err instanceof Error ? err.message : 'erro desconhecido' });
  }
};

/** Telefone em log sai mascarado — número de terceiro não vira rastro em log. */
function mascarar(telefone: string): string {
  return telefone ? `${telefone.slice(0, 4)}****${telefone.slice(-2)}` : '';
}

/**
 * Escreve a apresentação.
 *
 * O que a torna diferente de spam é uma frase só: quem passou o contato. É a
 * carta de apresentação do carteiro — sem ela, é panfleto na porta; com ela, é
 * "o seu primo me pediu para te procurar".
 */
async function escreverApresentacao(ind: Record<string, any>): Promise<string | null> {
  const assunto = ind.product_name || ind.ai_suggested_product || null;
  const quemIndicou = ind.referrer_name || null;

  const instrucoes = [
    'Você escreve a PRIMEIRA mensagem de WhatsApp de um escritório de advocacia brasileiro para uma pessoa que foi INDICADA.',
    'A pessoa NÃO procurou o escritório: alguém compartilhou o contato dela.',
    '',
    'Regras:',
    '- Comece dizendo quem passou o contato. É o que diferencia indicação de abordagem fria.',
    '- No máximo 3 frases curtas. WhatsApp, não e-mail.',
    '- Português brasileiro, tom de pessoa, não de empresa. Nada de "prezado", "venho por meio desta", emoji em excesso.',
    '- Termine com UMA pergunta aberta e simples, que dê à pessoa a chance de dizer se faz sentido.',
    '- NÃO prometa resultado, valor, prazo nem direito. NÃO afirme que a pessoa tem um caso.',
    '- NÃO mencione doença, benefício ou situação familiar que não esteja explicitamente no contexto abaixo.',
    '- Se você não sabe o assunto, não invente: apresente-se e pergunte.',
    '',
    'Responda só com o texto da mensagem, sem aspas e sem comentários.',
  ].join('\n');

  const contexto = [
    `Nome de quem vai receber: ${ind.indicated_name}`,
    quemIndicou ? `Quem passou o contato: ${quemIndicou}` : 'Quem passou o contato: (nome não identificado — refira-se de forma genérica, ex: "uma pessoa que você conhece")',
    assunto ? `Assunto provável da indicação: ${assunto}` : 'Assunto: não identificado',
    ind.ai_reason ? `Contexto observado na conversa: ${ind.ai_reason}` : '',
  ].filter(Boolean).join('\n');

  try {
    const resposta = await geminiChat({
      model: 'google/gemini-3.6-flash',
      messages: [
        { role: 'system', content: instrucoes },
        { role: 'user', content: contexto },
      ],
      temperature: 0.6,
      max_tokens: 300,
    });
    const texto = String(resposta?.choices?.[0]?.message?.content || '').trim();
    return texto || null;
  } catch (e: any) {
    console.error('[indicacoes/apresentar] IA falhou:', e?.message);
    return null;
  }
}
