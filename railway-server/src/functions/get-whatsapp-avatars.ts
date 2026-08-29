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
// POST { instance_name?, phones: string[], refresh?: boolean }
// Resp: { success, avatars: { [phone]: string | null }, stats: {...} }
//
// `instance_name` é OPCIONAL: a aba do WhatsApp sabe de qual instância é a
// conversa, mas a ficha do lead e a lista de contatos não — ali existe só o
// telefone. Sem ela, a instância sai de quem já conversou com aquele número
// (whatsapp_messages), e o cache é lido por telefone em qualquer instância, o
// que reaproveita a foto que a aba do WhatsApp já baixou.
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
// Teto de instâncias sondadas por telefone. Cada tentativa é uma chamada à
// UazAPI; varrer as 26 sairia caro pelo caso (comum) de o contato simplesmente
// não ter foto.
const MAX_INSTANCE_TRIES = 3;
const UAZ_TIMEOUT_MS = 8000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
// Link vencido na origem: tenta de novo em uma hora, não no TTL cheio.
const RETRY_AFTER_FAIL_MS = 60 * 60 * 1000;
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


// --- quais instâncias estão realmente conectadas ---------------------------
// `whatsapp_instances.is_active` é `true` nas 26 cadastradas, inclusive nas que
// não estão ligadas: medido em 26/08/2026, só 8 respondiam `connected`, 14
// diziam `disconnected` e 4 devolviam 401. Perguntar a foto a uma instância
// desligada é chamada perdida e devolve "sem foto" para quem tem. O estado é
// sondado no máximo a cada 5 minutos e vale para o processo inteiro.
const STATUS_TTL_MS = 5 * 60 * 1000;
let statusCache: { at: number; connected: Set<string> } | null = null;
let statusInFlight: Promise<Set<string>> | null = null;

async function connectedInstanceNames(instances: any[]): Promise<Set<string>> {
  if (statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) return statusCache.connected;
  if (statusInFlight) return statusInFlight;
  statusInFlight = (async () => {
    const connected = new Set<string>();
    await Promise.all(
      instances.map(async (i) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), UAZ_TIMEOUT_MS);
        try {
          const r = await fetch(`${String(i.base_url || DEFAULT_BASE).replace(/\/$/, '')}/instance/status`, {
            headers: { token: i.instance_token },
            signal: controller.signal,
          });
          if (!r.ok) return;
          const b: any = await r.json().catch(() => null);
          const st = String(b?.instance?.status || b?.status || '').toLowerCase();
          if (st === 'connected') connected.add(String(i.instance_name || '').trim().toLowerCase());
        } catch {
          /* sem resposta = não conectada */
        } finally {
          clearTimeout(timer);
        }
      }),
    );
    statusCache = { at: Date.now(), connected };
    statusInFlight = null;
    return connected;
  })();
  return statusInFlight;
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

    // --- instâncias disponíveis
    const { data: allInst } = await ext
      .from('whatsapp_instances')
      .select('instance_name, instance_token, base_url, is_active')
      .not('instance_token', 'is', null);

    const instances = ((allInst as any[]) || []).filter((i) => i?.instance_token);
    if (instances.length === 0) {
      return res.status(200).json({ success: false, error: 'nenhuma instância com token disponível', avatars: {} });
    }
    const byName = new Map<string, any>(
      instances.map((i) => [String(i.instance_name || '').trim().toLowerCase(), i]),
    );

    // Se a sondagem toda falhar (UazAPI fora), não filtra nada — melhor tentar
    // com todas do que não tentar com nenhuma.
    const connected = await connectedInstanceNames(instances);
    const online = (i: any) =>
      connected.size === 0 || connected.has(String(i?.instance_name || '').trim().toLowerCase());

    const wanted = String(instance_name || '').trim().toLowerCase();
    // A instância da conversa é quem tem o contato salvo e enxerga a foto. Ela
    // pode não estar mais cadastrada (o `instance_name` das mensagens guarda
    // nome fóssil) ou estar desligada — daí a cascata abaixo.
    const candidateOf = (i: any) => (i && online(i) ? i : null);
    const preferred = wanted ? candidateOf(byName.get(wanted)) : null;
    const fallback = instances.find((i) => online(i)) || instances[0];

    // --- cache
    // Com instância pedida, o cache é dela. Sem instância, vale a linha de
    // qualquer uma: é a mesma pessoa, e a foto que a aba do WhatsApp já baixou
    // serve para a ficha do lead sem gastar chamada nova.
    let cacheQuery = ext
      .from('whatsapp_avatars')
      .select('instance_name, phone, storage_path, has_photo, source_key, checked_at')
      .in('phone', targets);
    if (preferred) cacheQuery = cacheQuery.eq('instance_name', preferred.instance_name);
    const { data: cachedRows } = await cacheQuery;

    const cache = new Map<string, AvatarRow>();
    for (const r of ((cachedRows as any[]) || []) as AvatarRow[]) {
      const prev = cache.get(r.phone);
      // Sem instância pedida podem vir várias linhas do mesmo telefone: fica a
      // que tem foto e, entre essas, a checada mais recentemente.
      if (!prev) { cache.set(r.phone, r); continue; }
      const melhor =
        (r.has_photo && !prev.has_photo) ||
        (r.has_photo === prev.has_photo && new Date(r.checked_at) > new Date(prev.checked_at));
      if (melhor) cache.set(r.phone, r);
    }

    /**
     * De quais instâncias perguntar pela foto deste número, em ordem: a pedida
     * → a que já tem linha no cache → as que já trocaram mensagem com ele →
     * uma ativa qualquer. É lista, não uma só, porque não existe coluna de
     * "conectada": as 26 estão `is_active = true` e algumas respondem 503 (a
     * WHATSJUD IA, na medição de 26/08/2026). Sem cascata, o telefone cuja dona
     * está fora ficaria sem foto. O `phone` de whatsapp_messages tem índice
     * btree, e o lookup só acontece para quem não está em cache.
     */
    const resolveCandidates = async (target: string): Promise<any[]> => {
      const out: any[] = [];
      const push = (i: any) => {
        const cand = candidateOf(i);
        if (cand && !out.some((x) => x.instance_name === cand.instance_name)) out.push(cand);
      };
      if (preferred) push(preferred);
      const cached = cache.get(target);
      if (cached) push(byName.get(String(cached.instance_name).trim().toLowerCase()));
      if (out.length < MAX_INSTANCE_TRIES) {
        const { data: msgs } = await ext
          .from('whatsapp_messages')
          .select('instance_name')
          .eq('phone', target)
          .not('instance_name', 'is', null)
          .limit(30);
        for (const m of ((msgs as any[]) || [])) {
          push(byName.get(String(m.instance_name || '').trim().toLowerCase()));
          if (out.length >= MAX_INSTANCE_TRIES) break;
        }
      }
      push(fallback);
      return out.slice(0, MAX_INSTANCE_TRIES);
    };

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
      const prev = cache.get(target);

      // Percorre as candidatas até uma trazer foto. Uma instância que não tem o
      // contato salvo responde 200 sem imagem, e parar aí devolveria "sem foto"
      // para quem tem — é o mesmo motivo de fetchDetailsAcrossInstances em
      // get-group-participants.
      let respondeu = false;
      let imageUrl: string | null = null;
      let instanceKey = '';
      for (const cand of await resolveCandidates(target)) {
        const details = await fetchChatDetails(
          cand.base_url || DEFAULT_BASE,
          cand.instance_token,
          uazNumber(target),
        );
        if (!details.ok) continue;
        respondeu = true;
        if (!instanceKey) instanceKey = cand.instance_name;
        const url = pickImageUrl(details.data);
        if (url) {
          imageUrl = url;
          instanceKey = cand.instance_name;
          break;
        }
      }

      // Nenhuma respondeu: não grava nada. Marcar has_photo=false aqui apagaria
      // da tela, por dias, a foto de quem tem.
      if (!respondeu) {
        unreachable++;
        return;
      }

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
      // `refresh` pula o atalho de propósito: é o único jeito de reenviar um
      // arquivo antigo (ex.: os que subiram sem `cacheControl`).
      if (!refresh && key && prev?.source_key === key && prev?.storage_path) {
        const row = { ...prev, checked_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        await ext.from('whatsapp_avatars').upsert(row, { onConflict: 'instance_name,phone' });
        cache.set(target, row as AvatarRow);
        return;
      }

      const bin = await downloadImage(imageUrl);
      if (!bin) {
        // A UazAPI devolveu link já vencido — acontece, ela guarda a URL dela.
        // Mantém a foto anterior (melhor foto velha que avatar vazio), mas
        // envelhece o `checked_at` de propósito para a linha vencer em uma
        // hora: gravar "agora" esconderia por dias uma foto que existe, e não
        // gravar nada faria cada abertura de tela repetir a chamada.
        failed++;
        const temFoto = !!prev?.storage_path;
        const retryAt = new Date(Date.now() - (temFoto ? FRESH_MS : MISS_MS) + RETRY_AFTER_FAIL_MS);
        const row = {
          instance_name: instanceKey,
          phone: target,
          storage_path: prev?.storage_path ?? null,
          has_photo: temFoto,
          source_key: prev?.source_key ?? null,
          checked_at: retryAt.toISOString(),
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
        // cacheControl: sem ele o Storage responde sem `Cache-Control` e o navegador
        // rebaixa a mesma foto a cada abertura. 7 dias casa com o TTL do cache.
        .upload(path, webp, { contentType: 'image/webp', upsert: true, cacheControl: '604800' });
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
      `[get-whatsapp-avatars] ${preferred?.instance_name || 'instância por telefone'}: ` +
      `conectadas=${connected.size}/${instances.length} ` +
      `pedidos=${targets.length} baixados=${fetched} ` +
      `cache=${targets.length - toFetch.length} falhas=${failed} instancia_fora=${unreachable} ` +
      `com_foto=${Object.values(avatars).filter(Boolean).length}`,
    );

    return res.status(200).json({
      success: true,
      instance_name: preferred?.instance_name || null,
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
