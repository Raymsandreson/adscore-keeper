// Publica no Instagram um rascunho APROVADO de `instagram_testimonial_posts`.
// Só roda por clique humano na revisão (TestimonialPostSheet) — não existe
// caminho automático até aqui.
//
// Fluxo Graph API (Content Publishing):
//   1. POST /{ig-user-id}/media          → container com image_url + caption
//   2. GET  /{container-id}?fields=status_code até FINISHED
//   3. POST /{ig-user-id}/media_publish  → media publicada
//   4. GET  /{media-id}?fields=permalink → link salvo na linha
//
// Requisitos de ambiente (Railway):
//   META_ACCESS_TOKEN — token com instagram_basic + instagram_content_publish
//     (o mesmo já usado nas edge functions do Cloud; copiar pro Railway).
//   META_API_VERSION  — opcional, padrão v21.0.
//
// Body: { post_id: string, ig_user_id: string, caption?: string }
// Retorna: { success, post } ou { error }
import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';

const GRAPH = 'https://graph.facebook.com';
const API_VERSION = process.env.META_API_VERSION || 'v21.0';
const TOKEN = process.env.META_ACCESS_TOKEN || '';

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_TRIES = 15;
// Vídeo demora mais no processamento da Meta (transcode do Reel).
const POLL_MAX_TRIES_VIDEO = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function graphJson(url: string, init?: RequestInit): Promise<any> {
  const resp = await fetch(url, init);
  const data: any = await resp.json().catch(() => ({}));
  if (data?.error) {
    const e = data.error;
    // Erros conhecidos com mensagem acionável em vez do genérico da Meta.
    if (e.code === 190) throw new Error('META_ACCESS_TOKEN expirado ou inválido — gere um novo token e atualize o env no Railway.');
    if (e.code === 10 || e.code === 200) throw new Error('Token sem permissão instagram_content_publish pra esta conta.');
    throw new Error(e.error_user_msg || e.message || 'Erro da Graph API');
  }
  if (!resp.ok) throw new Error(`Graph API HTTP ${resp.status}`);
  return data;
}

export const handler: RequestHandler = async (req, res) => {
  const { post_id: postId, ig_user_id: igUserId, caption: captionOverride } = req.body || {};

  if (!postId || !igUserId) {
    return res.status(400).json({ error: 'post_id e ig_user_id são obrigatórios' });
  }
  if (!TOKEN) {
    return res.status(500).json({
      error: 'META_ACCESS_TOKEN ausente no Railway — copie o token das edge functions (precisa de instagram_content_publish).',
    });
  }

  const { data: post, error: loadError } = await supabase
    .from('instagram_testimonial_posts')
    .select('*')
    .eq('id', postId)
    .maybeSingle();
  if (loadError) return res.status(500).json({ error: `Erro lendo rascunho: ${loadError.message}` });
  if (!post) return res.status(404).json({ error: 'Rascunho não encontrado' });
  if (post.status === 'publicado') {
    return res.status(409).json({ error: 'Este post já foi publicado', post });
  }
  if (!post.image_url) return res.status(400).json({ error: 'Rascunho sem imagem gerada' });

  const caption = (captionOverride ?? post.caption ?? '').trim();

  // Reel (voz do cliente): vídeo já muxado pelo gerador; a Graph API só
  // publica vídeo como media_type=REELS. share_to_feed mantém o post visível
  // também no grid do perfil.
  const isReel = post.post_type === 'reel' && !!post.video_url;

  try {
    // 1. Container
    const containerBody = isReel
      ? { media_type: 'REELS', video_url: post.video_url, caption, share_to_feed: true, access_token: TOKEN }
      : { image_url: post.image_url, caption, access_token: TOKEN };
    const container = await graphJson(`${GRAPH}/${API_VERSION}/${igUserId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(containerBody),
    });
    const creationId = container.id;
    if (!creationId) throw new Error('Graph API não devolveu o id do container');

    // 2. Espera a Meta baixar e processar a mídia
    const maxTries = isReel ? POLL_MAX_TRIES_VIDEO : POLL_MAX_TRIES;
    let status = 'IN_PROGRESS';
    for (let i = 0; i < maxTries && status !== 'FINISHED'; i++) {
      await sleep(POLL_INTERVAL_MS);
      const check = await graphJson(
        `${GRAPH}/${API_VERSION}/${creationId}?fields=status_code&access_token=${TOKEN}`,
      );
      status = check.status_code;
      if (status === 'ERROR') throw new Error(`A Meta recusou ${isReel ? 'o vídeo' : 'a imagem'} (container em ERROR) — confira se a URL é pública.`);
    }
    if (status !== 'FINISHED') throw new Error(`Tempo esgotado esperando a Meta processar ${isReel ? 'o vídeo' : 'a imagem'} — tente de novo.`);

    // 3. Publica
    const published = await graphJson(`${GRAPH}/${API_VERSION}/${igUserId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: creationId, access_token: TOKEN }),
    });
    const mediaId = published.id;

    // 4. Permalink (falha aqui não desfaz a publicação — segue sem link)
    let permalink: string | null = null;
    try {
      const media = await graphJson(`${GRAPH}/${API_VERSION}/${mediaId}?fields=permalink&access_token=${TOKEN}`);
      permalink = media.permalink || null;
    } catch (permErr) {
      console.warn('[publish-instagram-testimonial] permalink indisponível:', permErr);
    }

    const { data: updated, error: updateError } = await supabase
      .from('instagram_testimonial_posts')
      .update({
        status: 'publicado',
        caption,
        ig_user_id: String(igUserId),
        ig_media_id: String(mediaId),
        permalink,
        published_at: new Date().toISOString(),
        publish_error: null,
      })
      .eq('id', postId)
      .select()
      .single();
    if (updateError) {
      // Publicou mas não gravou — loga alto: sem isso o revisor publicaria de novo.
      console.error('[publish-instagram-testimonial] publicado mas falhou ao gravar:', updateError);
    }

    return res.status(200).json({ success: true, post: updated || { ...post, status: 'publicado', ig_media_id: mediaId, permalink } });
  } catch (err: any) {
    const message = err?.message || 'Erro inesperado na publicação';
    console.error('[publish-instagram-testimonial]', err);
    await supabase
      .from('instagram_testimonial_posts')
      .update({ publish_error: message })
      .eq('id', postId);
    return res.status(500).json({ error: message });
  }
};
