import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Thumbnail gerado na ingestão de mídia — substitui o image transform do
 * Supabase Storage (/render/image/), que cobra por imagem de origem
 * distinta/mês e estourou a quota (400/100 em jul/2026).
 *
 * Convenção: o thumb vive em `${filePath}.thumb.webp` ao lado do original.
 * O frontend monta a URL por convenção e faz fallback pro original via
 * onError (cobre imagens antigas, sem backfill).
 */

export const THUMB_SUFFIX = '.thumb.webp';
const THUMB_MAX_WIDTH = 640;

// Só jpeg/png: são as fotos grandes do WhatsApp. GIF/webp animado perderiam
// animação no resize; stickers webp já são pequenos.
export function isThumbableImage(contentType: string | null | undefined): boolean {
  return !!contentType && /image\/(jpeg|jpg|png)/i.test(contentType);
}

/**
 * Gera e sobe o thumb. Nunca lança — falha de thumb não pode bloquear a
 * ingestão da mídia principal.
 */
export async function uploadImageThumb(
  supabase: SupabaseClient,
  bucket: string,
  filePath: string,
  bytes: Buffer,
  contentType: string | null | undefined,
): Promise<void> {
  if (!isThumbableImage(contentType)) return;
  try {
    const thumb = await sharp(bytes)
      .rotate()
      .resize({ width: THUMB_MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();
    const { error } = await supabase.storage
      .from(bucket)
      .upload(`${filePath}${THUMB_SUFFIX}`, thumb, {
        contentType: 'image/webp',
        upsert: true,
        cacheControl: '31536000',
      });
    if (error) console.error('Thumb upload error:', error.message);
  } catch (e) {
    console.error('Thumb generation error:', e instanceof Error ? e.message : e);
  }
}
