// get-whatsapp-avatars
// ============================================================
// Foto de perfil do WhatsApp do cliente, em lote, para exibir no app.
//
// A UazAPI entrega a foto em /chat/details (`imagePreview` com preview:true,
// `image` sem). O que ela NÃO entrega é uma URL estável: o link aponta para
// pps.whatsapp.net com expiração assinada (`oe=<epoch hex>`). Medido em
// 26/08/2026 sobre whatsapp_chat_details_cache: 9 das 25 fotos mais recentes já
// davam 403, inclusive linhas gravadas naquele mesmo dia — a UazAPI guarda a
// URL dela e devolve vencida. Colocar esse link direto num <img> = foto que
// quebra em dias, sem erro visível.
//
// Por isso aqui a imagem é BAIXADA, convertida (sharp → webp 256px, ~8 KB) e
// guardada no bucket privado `wa-avatars` do Externo. O front recebe signed URL
// de 7 dias — nada público, nada adivinhável (foto de cliente é dado pessoal).
//
// POST { instance_name, phones: string[], refresh?: boolean }
// Resp: { success, avatars: { [phone]: string | null }, stats: {...} }
//
// `phones` aceita telefone ou grupo, em dígitos ou JID. A chave da resposta é
// sempre o valor em dígitos puros — o mesmo formato que o webhook grava em
// whatsapp_messages.phone (grupo = ID de 18 dígitos, sem `@g.us`), para o front
// casar sem adivinhar formato.
// ============================================================
import type { RequestHandler } from 'express';
import sharp from 'sharp';
import { supabase as ext } from '../lib/supabase';

const DEFAULT_BASE = 'https://abraci.uazapi.com';
const BUCKET = 'wa-avatars';
const AVATAR_PX = 256;
const SIGNED_TTL_S = 7 * 24 * 60 * 60;
// Tem foto → só reconsulta em 7 dias. Cliente troca de foto de perfil devagar, e
// cada checagem é uma chamada à UazAPI por conversa aberta.
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
// Não tem foto → 3 dias. Aqui o que muda não é a foto, é a configuração de
// privacidade; TTL menor evita o contato ficar "sem foto" por uma semana depois
// de liberar.
const MISS_MS = 3 * 24 * 60 * 60 * 1000;
// Teto por requisição. A lista do inbox pede em lotes conforme rola a tela.
const MAX_PHONES = 80;
const CONCURRENCY = 6;
const UAZ_TIMEOUT_MS = 8000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
// Mesmo critério de isWhatsAppGroupId() no front: telefone vai até 15 dígitos,
// ID de grupo tem 18 (`1203...`).
const GROUP_ID_MIN_DIGITS = 17;

interface AvatarRow {
  instance_name: string;
  phone: string;
  storage_path: string | null;
  has_photo: boolean;
  source_key: string | null;
  checked_at: string;
}

/** Só pro log: telefone nunca inteiro (dado pessoal em log é vazamento). */
function maskPhone(v: string): string {
  const s = String(v || '');
  return s.length <= 4 ? '****' : `***${s.slice(-4)}`;
}

/**
 * Chave = dígitos puros, igual ao que o webhook grava em whatsapp_messages.phone
 * e ao que normalizeWhatsAppConversationPhone() devolve no front — inclusive
 * para grupo, que chega como o ID de 18 dígitos SEM `@g.us`. Se a chave aqui
 * fosse o JID, o front pediria uma coisa e receberia outra.
 */
function normalizeTarget(value: unknown): string {
  const d = String(value || '').trim().replace(/@.*$/, '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length >= GROUP_ID_MIN_DIGITS) return d;        // grupo
  return d.length >= 8 && d.length <= 15 ? d : '';      // contato
}

/** A UazAPI só reconhece grupo pelo JID completo; contato vai como número. */
function uazNumber(target: string): string {
  return target.length >= GROUP_ID_MIN_DIGITS ? `${target}@g.us` : target;
}

function slug(v: string): string {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'sem-instancia';
}

function storagePath(instanceName: string, target: string): string {
  return `${slug(instanceName)}/${target}.webp`;
}

/**
 * Identidade da foto, sem a query string assinada: o nome do arquivo muda quando
 * o cliente troca a foto. Serve para não reprocessar imagem igual a cada TTL.
 */
function sourceKeyOf(url: string): string | null {
  try {
    const path = new URL(url).pathname;
    const file = path.split('/').filter(Boolean).pop() || '';
    return file.replace(/\.[a-z0-9]+$/i, '') || null;
  } catch {
    return null;
  }
}

/**
 * `ok:false` = não deu pra perguntar (instância caída, timeout). Diferente de
 * perguntar e o contato não ter foto — medido em 26/08/2026, a instância
 * "WHATSJUD IA" respondia 503, e tratar isso como "sem foto" esconderia por
 * três dias a foto de quem tem.
 */
async function fetchChatDetails(
  baseUrl: string,
  token: string,
  number: string,
): Promise<{ ok: boolean; data: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UAZ_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/details`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      // preview:true devolve a versão de listagem (96px) — é o que vamos exibir,
      // e é a que a UazAPI tem em cache com mais frequência.
      body: JSON.stringify({ number, preview: true }),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, data: null };
    return { ok: true, data: await res.json().catch(() => null) };
  } catch {
    return { ok: false, data: null };
  } finally {
    clearTimeout(timer);
  }
}

function pickImageUrl(d: any): string | null {
  const url = d?.imagePreview || d?.image || d?.profilePicUrl || null;
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
}

async function downloadImage(url: string): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UAZ_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    // 403 aqui é o caso comum: a URL que a UazAPI devolveu já nasceu vencida.
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_IMAGE_BYTES) return null;
    return buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      try { out[idx] = await fn(items[idx]); } catch { out[idx] = null as any; }
    }
  });
  await Promise.all(workers);
  return out;
}

export const handler: RequestHandler = async (req, res) => {
  try {
    const { instance_name, phones, refresh } = (req.body || {}) as {
      instance_name?: string;
      phones?: unknown[];
      refresh?: boolean;
    };

    const targets = Array.from(
      new Set((Array.isArray(phones) ? phones : []).map(normalizeTarget).filter(Boolean)),
    ).slice(0, MAX_PHONES);

    if (targets.length === 0) {
      return res.status(200).json({ success: true, avatars: {}, stats: { requested: 0 } });
    }

    // --- instância: a da conversa é quem tem o contato salvo e enxerga a foto.
    // Se ela não estiver cadastrada, cai na primeira ativa em vez de devolver
    // vazio (o inbox mostra conversa de instância antiga, ver fóssil de
    // instance_name em whatsapp_messages).
    const { data: allInst } = await ext
      .from('whatsapp_instances')
      .select('instance_name, instance_token, base_url, is_active')
      .not('instance_token', 'is', null);

    const instances = ((allInst as any[]) || []).filter((i) => i?.instance_token);
    const wanted = String(instance_name || '').trim().toLowerCase();
    const inst =
      instances.find((i) => String(i.instance_name || '').trim().toLowerCase() === wanted) ||
      instances.find((i) => i.is_active !== false) ||
      null;

    if (!inst) {
      return res.status(200).json({ success: false, error: 'nenhuma instância com token disponível', avatars: {} });
    }
    const instanceKey: string = inst.instance_name;

    // --- cache
    const { data: cachedRows } = await ext
      .from('whatsapp_avatars')
      .select('instance_name, phone, storage_path, has_photo, source_key, checked_at')
      .eq('instance_name', instanceKey)
      .in('phone', targets);

    const cache = new Map<string, AvatarRow>();
    for (const r of ((cachedRows as any[]) || [])) cache.set(r.phone, r as AvatarRow);

    const now = Date.now();
    const isFresh = (row: AvatarRow | undefined) => {
      if (!row) return false;
      const age = now - new Date(row.checked_at).getTime();
      return row.has_photo ? age < FRESH_MS : age < MISS_MS;
    };

    const toFetch = refresh ? targets : targets.filter((t) => !isFresh(cache.get(t)));

    // --- busca o que está velho/ausente
    let fetched = 0;
    let failed = 0;
    let unreachable = 0;
    await mapWithConcurrency(toFetch, CONCURRENCY, async (target) => {
      const details = await fetchChatDetails(inst.base_url || DEFAULT_BASE, inst.instance_token, uazNumber(target));
      const prev = cache.get(target);

      // Instância fora do ar: não grava nada. Marcar has_photo=false aqui
      // apagaria da tela, por dias, a foto de quem tem.
      if (!details.ok) {
        unreachable++;
        return;
      }

      const imageUrl = pickImageUrl(details.data);

      // Sem foto: registra a checagem para não repetir a chamada por MISS_MS.
      if (!imageUrl) {
        const row = {
          instance_name: instanceKey,
          phone: target,
          storage_path: prev?.storage_path ?? null,
          has_photo: false,
          source_key: null,
          checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        await ext.from('whatsapp_avatars').upsert(row, { onConflict: 'instance_name,phone' });
        cache.set(target, row as AvatarRow);
        return;
      }

      const key = sourceKeyOf(imageUrl);
      // Mesma foto de antes e o arquivo já está no bucket → só renova a data.
      if (key && prev?.source_key === key && prev?.storage_path) {
        const row = { ...prev, checked_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        await ext.from('whatsapp_avatars').upsert(row, { onConflict: 'instance_name,phone' });
        cache.set(target, row as AvatarRow);
        return;
      }

      const bin = await downloadImage(imageUrl);
      if (!bin) {
        // URL vencida na origem. Mantém a foto anterior (melhor foto velha que
        // avatar vazio) e marca a checagem para tentar de novo no próximo TTL.
        failed++;
        const row = {
          instance_name: instanceKey,
          phone: target,
          storage_path: prev?.storage_path ?? null,
          has_photo: !!prev?.storage_path,
          source_key: prev?.source_key ?? null,
          checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        await ext.from('whatsapp_avatars').upsert(row, { onConflict: 'instance_name,phone' });
        cache.set(target, row as AvatarRow);
        return;
      }

      let webp: Buffer;
      try {
        webp = await sharp(bin).resize(AVATAR_PX, AVATAR_PX, { fit: 'cover' }).webp({ quality: 80 }).toBuffer();
      } catch {
        failed++;
        return;
      }

      const path = storagePath(instanceKey, target);
      const { error: upErr } = await ext.storage
        .from(BUCKET)
        .upload(path, webp, { contentType: 'image/webp', upsert: true });
      if (upErr) {
        console.warn(`[get-whatsapp-avatars] upload falhou ${maskPhone(target)}: ${upErr.message}`);
        failed++;
        return;
      }

      const row = {
        instance_name: instanceKey,
        phone: target,
        storage_path: path,
        has_photo: true,
        source_key: key,
        checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await ext.from('whatsapp_avatars').upsert(row, { onConflict: 'instance_name,phone' });
      cache.set(target, row as AvatarRow);
      fetched++;
    });

    // --- signed URLs em lote (bucket privado; nada de link público adivinhável)
    const paths = targets
      .map((t) => cache.get(t)?.storage_path)
      .filter((p): p is string => !!p);

    const signedByPath = new Map<string, string>();
    if (paths.length > 0) {
      const { data: signed, error: signErr } = await ext.storage
        .from(BUCKET)
        .createSignedUrls(Array.from(new Set(paths)), SIGNED_TTL_S);
      if (signErr) console.warn('[get-whatsapp-avatars] createSignedUrls falhou:', signErr.message);
      for (const s of (signed as any[]) || []) {
        if (s?.path && s?.signedUrl) signedByPath.set(s.path, s.signedUrl);
      }
    }

    const avatars: Record<string, string | null> = {};
    for (const t of targets) {
      const p = cache.get(t)?.storage_path;
      avatars[t] = (p && signedByPath.get(p)) || null;
    }

    console.log(
      `[get-whatsapp-avatars] ${instanceKey}: pedidos=${targets.length} baixados=${fetched} ` +
      `cache=${targets.length - toFetch.length} falhas=${failed} instancia_fora=${unreachable} ` +
      `com_foto=${Object.values(avatars).filter(Boolean).length}`,
    );

    return res.status(200).json({
      success: true,
      instance_name: instanceKey,
      avatars,
      stats: {
        requested: targets.length,
        from_cache: targets.length - toFetch.length,
        fetched,
        failed,
        unreachable,
      },
    });
  } catch (err) {
    console.error('[get-whatsapp-avatars] erro:', err);
    return res.status(200).json({
      success: false,
      error: err instanceof Error ? err.message : 'erro desconhecido',
      avatars: {},
    });
  }
};

export default handler;
