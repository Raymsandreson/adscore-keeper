import type { SyntheticEvent } from 'react';

/**
 * Helpers para servir mídias do bucket whatsapp-media (público).
 *
 * jul/2026: o image transform do Storage (/render/image/) foi substituído por
 * thumbnail gerado na ingestão (sharp no Railway), porque o transform cobra
 * por imagem de origem distinta/mês (100 inclusas no Pro; uso bateu 400).
 * Convenção: thumb webp (~640px) em `${path}.thumb.webp` ao lado do original.
 * Imagens antigas (sem thumb) voltam pro original via handleMediaThumbError.
 *
 * NÃO aplique em downloads, lightbox em tamanho real ou em vídeos/áudios/docs.
 */

const STORAGE_OBJECT_MARKER = '/storage/v1/object/public/';
export const THUMB_SUFFIX = '.thumb.webp';

function thumbConventionUrl(url: string | null | undefined): string {
  if (!url) return '';
  // Já aponta pro thumb
  if (url.includes(THUMB_SUFFIX)) return url;
  // Não é Supabase Storage público
  if (!url.includes(STORAGE_OBJECT_MARKER)) return url;
  // Só jpeg/png ganham thumb na ingestão (GIF/webp servem o original)
  const [base, query] = url.split('?');
  if (!/\.(jpg|jpeg|png)$/.test(base.toLowerCase())) return url;
  return query ? `${base}${THUMB_SUFFIX}?${query}` : `${base}${THUMB_SUFFIX}`;
}

/** Thumbnails pequenos (lista de mídias, drag-handles). */
export const mediaThumb = (url: string | null | undefined) => thumbConventionUrl(url);

/** Imagens dentro do balão de chat. */
export const mediaPreview = (url: string | null | undefined) => thumbConventionUrl(url);

/**
 * onError obrigatório em todo <img> que usa mediaThumb/mediaPreview:
 * imagens anteriores ao deploy do thumb não têm `.thumb.webp` — cai no original.
 */
export function handleMediaThumbError(e: SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  if (img.src.includes(THUMB_SUFFIX)) {
    img.src = img.src.replace(THUMB_SUFFIX, '');
  }
}
