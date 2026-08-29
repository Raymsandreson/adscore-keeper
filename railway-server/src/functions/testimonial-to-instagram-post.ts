// Testemunho de cliente (áudio transcrito/texto do WhatsApp) vira RASCUNHO de
// post pro Instagram: a IA extrai a citação forte e propõe a legenda, o card
// 1080×1350 é renderizado com sharp e sobe no bucket público, e tudo fica em
// `instagram_testimonial_posts` como 'rascunho'. NADA é publicado aqui — a
// publicação é outra função (publish-instagram-testimonial) e só roda com
// clique humano depois da revisão.
//
// Body: {
//   testimonial_text?: string,     // texto do testemunho; se ausente, busca por message_id
//   message_id?: string,           // id em whatsapp_messages (Externo)
//   client_name?: string,          // nome completo (fica interno, não sai no card)
//   phone?: string,
//   instance_name?: string,
//   lead_id?: string,
//   contact_id?: string,
//   created_by?: string,
//   brand_name?: string,           // rodapé do card (padrão: env INSTAGRAM_CARD_BRAND)
//   handle?: string,               // @conta no rodapé (padrão: env INSTAGRAM_CARD_HANDLE)
//   // Regeneração com ajuste manual (revisor editou a citação):
//   regenerate_post_id?: string,   // atualiza o rascunho em vez de criar outro
//   quote_text?: string,           // usa esta citação e NÃO chama a IA
//   caption?: string,              // idem pra legenda
//   display_name?: string,         // nome como sai no card
//   context_label?: string,        // "mãe de assistido", "cliente BPC"...
// }
// Retorna: { success, post }
import type { RequestHandler } from 'express';
import { randomUUID } from 'crypto';
import { geminiChat } from '../lib/gemini';
import { supabase } from '../lib/supabase';
import { renderTestimonialCard } from '../lib/testimonial-card';

const MODEL = process.env.EXTRACT_AI_MODEL || 'google/gemini-3.6-flash';
const BUCKET = 'whatsapp-media';
const FOLDER = 'instagram-posts';
const MAX_QUOTE = 300;

interface AiPost {
  quote: string;
  caption: string;
  display_name: string;
  context_label: string;
}

// Publicidade de advocacia tem regra (Provimento 205/2021 OAB) e o cliente tem
// LGPD: o prompt força sobriedade, proíbe promessa de resultado/valores e
// limita a identificação ao primeiro nome.
const SYSTEM = `Você prepara posts de Instagram para um escritório de advocacia previdenciária a partir de depoimentos espontâneos de clientes recebidos por WhatsApp.

REGRAS INEGOCIÁVEIS (Provimento 205/2021 da OAB + LGPD):
- NUNCA prometa resultado, não use "garantimos", "sempre ganhamos", cifras ou prazos.
- NUNCA exponha sobrenome, número de processo, CPF, doença ou dado sensível do cliente.
- Identifique o cliente APENAS pelo primeiro nome.
- Tom sóbrio e caloroso: gratidão e cuidado, sem mercantilizar.

TAREFAS:
1. quote: escolha o trecho mais forte e emocionante do depoimento, com as palavras do próprio cliente, limpando vícios de fala ("né", "ééé", repetições). Máximo ${MAX_QUOTE} caracteres. Sem aspas nas pontas.
2. caption: legenda pronta pro Instagram em português: 1º parágrafo emocional sobre o que esse tipo de mensagem significa, 2º parágrafo curto sobre o compromisso do escritório (sem promessa de resultado), e 3 a 6 hashtags coerentes (ex.: #advocaciaprevidenciaria #bpc #inss #direitoprevidenciario). Sem emojis em excesso (máx. 3).
3. display_name: primeiro nome do cliente (ex.: "Ângela"). Se não der pra saber, string vazia.
4. context_label: rótulo curto de contexto sem dado sensível (ex.: "mãe de assistido", "cliente do escritório"). Se não der pra saber, "Cliente".`;

export const handler: RequestHandler = async (req, res) => {
  try {
    const body = req.body || {};
    let testimonialText: string = (body.testimonial_text || '').trim();
    const messageId: string | undefined = body.message_id || undefined;

    if (!testimonialText && messageId) {
      const { data: msg, error } = await supabase
        .from('whatsapp_messages')
        .select('message_text')
        .eq('id', messageId)
        .maybeSingle();
      if (error) throw new Error(`Erro lendo mensagem: ${error.message}`);
      testimonialText = (msg?.message_text || '').trim();
    }

    if (!testimonialText) {
      return res.status(400).json({ error: 'testimonial_text ou message_id com texto é obrigatório' });
    }

    const brandName: string =
      (body.brand_name || process.env.INSTAGRAM_CARD_BRAND || 'R. Prudêncio Advocacia').trim();
    const handle: string = (body.handle || process.env.INSTAGRAM_CARD_HANDLE || '').trim();

    let quote: string = (body.quote_text || '').trim();
    let caption: string = (body.caption || '').trim();
    let displayName: string = (body.display_name || '').trim();
    let contextLabel: string = (body.context_label || '').trim();

    // Só chama a IA se o revisor não mandou o conteúdo pronto.
    if (!quote || !caption) {
      const result = await geminiChat({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content:
              `DEPOIMENTO (transcrição literal):\n${testimonialText}` +
              (body.client_name ? `\n\nNome do cliente (uso interno): ${body.client_name}` : ''),
          },
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'montar_post_de_testemunho',
            description: 'Devolve citação, legenda e identificação anonimizada pro post.',
            parameters: {
              type: 'object',
              properties: {
                quote: { type: 'string', description: `Trecho forte do depoimento, limpo, máx. ${MAX_QUOTE} caracteres.` },
                caption: { type: 'string', description: 'Legenda completa do post com hashtags.' },
                display_name: { type: 'string', description: 'Primeiro nome do cliente, ou vazio.' },
                context_label: { type: 'string', description: 'Contexto curto sem dado sensível. Ex.: "mãe de assistido".' },
              },
              required: ['quote', 'caption'],
            },
          },
        }],
        tool_choice: { type: 'function', function: { name: 'montar_post_de_testemunho' } },
      });

      const toolCall = result?.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall?.function?.arguments) {
        throw new Error('IA não devolveu o post estruturado');
      }
      const ai: AiPost = typeof toolCall.function.arguments === 'string'
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;

      quote = quote || (ai.quote || '').trim();
      caption = caption || (ai.caption || '').trim();
      displayName = displayName || (ai.display_name || '').trim();
      contextLabel = contextLabel || (ai.context_label || '').trim();
    }

    if (!quote) throw new Error('Não foi possível extrair a citação do depoimento');
    if (quote.length > MAX_QUOTE + 60) quote = `${quote.slice(0, MAX_QUOTE).trim()}…`;
    if (!displayName) {
      // LGPD: só o primeiro nome, mesmo quando o nome completo veio no body.
      displayName = (body.client_name || 'Cliente').trim().split(/\s+/)[0];
    }
    if (!contextLabel) contextLabel = 'Cliente';

    const image = await renderTestimonialCard({
      quote,
      displayName,
      contextLabel,
      brandName,
      handle,
    });

    const postId: string = body.regenerate_post_id || randomUUID();
    const imagePath = `${FOLDER}/${postId}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(imagePath, image, { contentType: 'image/jpeg', upsert: true });
    if (uploadError) throw new Error(`Upload do card falhou: ${uploadError.message}`);

    // Cache-buster: o upsert mantém o mesmo path e o CDN seguraria a arte velha
    // na regeneração — o preview e a Graph API precisam ver a nova.
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(imagePath);
    const imageUrl = `${pub.publicUrl}?v=${Date.now()}`;

    const row = {
      source_message_id: messageId || null,
      phone: body.phone || null,
      instance_name: body.instance_name || null,
      lead_id: body.lead_id || null,
      contact_id: body.contact_id || null,
      client_name: body.client_name || null,
      display_name: displayName,
      testimonial_text: testimonialText,
      quote_text: quote,
      caption,
      image_path: imagePath,
      image_url: imageUrl,
      created_by: body.created_by || null,
    };

    let post: any = null;
    if (body.regenerate_post_id) {
      const { data, error } = await supabase
        .from('instagram_testimonial_posts')
        .update({ ...row, status: 'rascunho', publish_error: null })
        .eq('id', body.regenerate_post_id)
        .select()
        .maybeSingle();
      if (error) throw new Error(`Erro atualizando rascunho: ${error.message}`);
      post = data;
    }
    if (!post) {
      const { data, error } = await supabase
        .from('instagram_testimonial_posts')
        .insert({ id: postId, ...row })
        .select()
        .single();
      if (error) throw new Error(`Erro gravando rascunho: ${error.message}`);
      post = data;
    }

    return res.status(200).json({ success: true, post });
  } catch (err: any) {
    console.error('[testimonial-to-instagram-post]', err);
    return res.status(500).json({ error: err?.message || 'Erro inesperado' });
  }
};
