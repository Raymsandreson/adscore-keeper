/**
 * useWhatsAppAvatars — foto de perfil do WhatsApp do cliente, em lote.
 *
 * A foto vem da UazAPI (/chat/details), mas a URL que ela devolve é assinada e
 * expira (medido 26/08/2026: 9 de 25 fotos recém-gravadas já davam 403). Quem
 * resolve isso é a função `get-whatsapp-avatars` no Railway, que guarda a imagem
 * no bucket privado e devolve signed URL de 7 dias. Este hook só orquestra:
 *
 * - pede em LOTE (uma chamada para até 40 conversas) em vez de uma por avatar;
 * - aceita ficar sem instância (ficha do lead, contatos): aí quem descobre de
 *   qual instância perguntar é o servidor, pelo telefone;
 * - só pede o que está VISÍVEL na tela (o componente WhatsAppAvatar avisa),
 *   senão abrir o inbox com 400 conversas viraria 400 chamadas à UazAPI;
 * - cache em memória + sessionStorage, então trocar de aba não repete nada.
 *
 * O cache é module-level de propósito: os avatares aparecem em componentes
 * irmãos (lista e cabeçalho do chat) e precisam do mesmo estado.
 */
import { useCallback, useEffect, useReducer } from 'react';
import { cloudFunctions } from '@/lib/functionRouter';

// A signed URL vale 7 dias; renovamos em 6 para nunca exibir link vencido.
const CACHE_TTL_MS = 6 * 24 * 60 * 60 * 1000;
// Falha (rede, instância fora do ar) não vira "sem foto" permanente.
const RETRY_COOLDOWN_MS = 2 * 60 * 1000;
const STORAGE_KEY = 'wa_avatars_v1';
const BATCH_SIZE = 40;
const DEBOUNCE_MS = 180;

interface Entry { url: string | null; at: number }

const cache = new Map<string, Entry>();
const inFlight = new Set<string>();
const failedAt = new Map<string, number>();
const subscribers = new Set<() => void>();
const pending = new Map<string, Set<string>>(); // instância → telefones
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let hydrated = false;

export function avatarKey(phone: string, instanceName?: string | null): string {
  return `${(instanceName || '').trim().toLowerCase()}|${normalizeTarget(phone)}`;
}

/**
 * Dígitos puros, igual ao normalizador do servidor e ao `phone` que o webhook
 * grava: grupo é o ID de 18 dígitos, sem `@g.us`. Devolve '' para o que não dá
 * pra consultar (LID, número truncado), e aí o avatar fica no ícone.
 */
export function normalizeTarget(phone: string): string {
  const d = String(phone || '').trim().replace(/@.*$/, '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length >= 17) return d;                     // grupo
  return d.length >= 8 && d.length <= 15 ? d : ''; // contato
}

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, Entry>;
    const now = Date.now();
    for (const [k, v] of Object.entries(parsed)) {
      if (v && typeof v.at === 'number' && now - v.at < CACHE_TTL_MS) cache.set(k, v);
    }
  } catch {/* sessionStorage indisponível (aba privada) — segue sem cache */}
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(cache)));
    } catch {/* cota estourada — o cache em memória continua valendo */}
  }, 500);
}

function notify() {
  for (const fn of subscribers) fn();
}

function isUsable(entry: Entry | undefined): boolean {
  return !!entry && Date.now() - entry.at < CACHE_TTL_MS;
}

async function flush() {
  flushTimer = null;
  const batches: Array<{ instance: string; phones: string[] }> = [];
  for (const [instance, set] of pending) {
    const phones = Array.from(set);
    for (let i = 0; i < phones.length; i += BATCH_SIZE) {
      batches.push({ instance, phones: phones.slice(i, i + BATCH_SIZE) });
    }
  }
  pending.clear();
  if (batches.length === 0) return;

  // Serial de propósito: cada lote pode disparar até 40 chamadas à UazAPI no
  // servidor. Paralelizar aqui só transferiria a fila para lá.
  for (const batch of batches) {
    try {
      const { data, error } = await cloudFunctions.invoke<{ success: boolean; avatars?: Record<string, string | null> }>(
        'get-whatsapp-avatars',
        { body: { instance_name: batch.instance || undefined, phones: batch.phones } },
      );
      const now = Date.now();
      if (error || !data?.success) {
        for (const p of batch.phones) {
          inFlight.delete(`${batch.instance}|${p}`);
          failedAt.set(`${batch.instance}|${p}`, now);
        }
        console.warn('[useWhatsAppAvatars] lote falhou:', error?.message || 'resposta sem success');
        continue;
      }
      for (const p of batch.phones) {
        const key = `${batch.instance}|${p}`;
        inFlight.delete(key);
        failedAt.delete(key);
        cache.set(key, { url: data.avatars?.[p] ?? null, at: now });
      }
      persist();
      notify();
    } catch (e) {
      const now = Date.now();
      for (const p of batch.phones) {
        inFlight.delete(`${batch.instance}|${p}`);
        failedAt.set(`${batch.instance}|${p}`, now);
      }
      console.warn('[useWhatsAppAvatars] erro no lote:', (e as Error)?.message);
    }
  }
}

function enqueue(phone: string, instanceName?: string | null) {
  hydrate();
  const target = normalizeTarget(phone);
  if (!target) return;
  // Instância vazia é caso legítimo: a ficha do lead e a lista de contatos só
  // têm o telefone. Quem descobre de qual instância perguntar é o servidor.
  const instance = (instanceName || '').trim();
  const key = `${instance.toLowerCase()}|${target}`;
  if (isUsable(cache.get(key)) || inFlight.has(key)) return;
  const failed = failedAt.get(key);
  if (failed && Date.now() - failed < RETRY_COOLDOWN_MS) return;

  inFlight.add(key);
  const set = pending.get(instance) || new Set<string>();
  set.add(target);
  pending.set(instance, set);
  if (!flushTimer) flushTimer = setTimeout(flush, DEBOUNCE_MS);
}

export function useWhatsAppAvatars() {
  const [, force] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    hydrate();
    subscribers.add(force);
    return () => { subscribers.delete(force); };
  }, [force]);

  const getAvatar = useCallback((phone: string, instanceName?: string | null): string | null => {
    const entry = cache.get(avatarKey(phone, instanceName));
    return isUsable(entry) ? entry!.url : null;
  }, []);

  const requestAvatar = useCallback((phone: string, instanceName?: string | null) => {
    enqueue(phone, instanceName);
  }, []);

  return { getAvatar, requestAvatar };
}

/** Só para teste: zera o estado compartilhado entre casos. */
export function __resetAvatarCacheForTests() {
  cache.clear();
  inFlight.clear();
  failedAt.clear();
  pending.clear();
  hydrated = false;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
}
