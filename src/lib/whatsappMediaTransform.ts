/**
 * Helpers para servir mídias do bucket whatsapp-media (público).
 *
 * DESATIVADO (jul/2026): o endpoint /render/image/ cobra por imagem de origem
 * distinta transformada no mês (100 inclusas no Pro) e estourou a quota
 * (400/100). Servir o original via CDN custa menos: originais sobem com
 * cacheControl de 1 ano e repetições caem no medidor de Cached Egress.
 * O fix definitivo é thumbnail gerado na ingestão (sharp no Railway).
 *
 * NÃO aplique em downloads, lightbox em tamanho real ou em vídeos/áudios/docs.
 */

// Desliga o uso do endpoint /render/image/ (quota de transformations).
const USE_STORAGE_TRANSFORM = false;

const STORAGE_OBJECT_MARKER = '/storage/v1/object/public/';
const STORAGE_RENDER_MARKER = '/storage/v1/render/image/public/';

export interface ThumbOptions {
  width?: number;
  height?: number;
  quality?: number; // 20-100
  resize?: 'cover' | 'contain' | 'fill';
}

/**
 * Converte URL pública do Storage em URL com image transform.
 * Aceita apenas imagens (extensão ou parâmetro). Para qualquer URL não-Storage
 * ou já transformada, devolve a URL original sem mudanças.
 */
export function transformMediaUrl(url: string | null | undefined, opts: ThumbOptions = {}): string {
  if (!url) return '';
  if (!USE_STORAGE_TRANSFORM) return url;
  // Já é transform endpoint
  if (url.includes(STORAGE_RENDER_MARKER)) return url;
  // Não é Supabase Storage público
  if (!url.includes(STORAGE_OBJECT_MARKER)) return url;
  // Só faz sentido em imagens
  const lower = url.split('?')[0].toLowerCase();
  if (!/\.(jpg|jpeg|png|webp|gif|bmp|heic)$/.test(lower)) return url;

  const transformed = url.replace(STORAGE_OBJECT_MARKER, STORAGE_RENDER_MARKER);
  const params = new URLSearchParams();
  if (opts.width) params.set('width', String(opts.width));
  if (opts.height) params.set('height', String(opts.height));
  params.set('quality', String(opts.quality ?? 70));
  if (opts.resize) params.set('resize', opts.resize);

  const sep = transformed.includes('?') ? '&' : '?';
  return `${transformed}${sep}${params.toString()}`;
}

/** Atalho para thumbnails pequenos (lista de mídias, drag-handles). */
export const mediaThumb = (url: string | null | undefined, width = 160) =>
  transformMediaUrl(url, { width, quality: 65, resize: 'cover' });

/** Atalho para imagens dentro do balão de chat. */
export const mediaPreview = (url: string | null | undefined, width = 600) =>
  transformMediaUrl(url, { width, quality: 75 });
