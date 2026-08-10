/**
 * Foto de perfil do usuário logado.
 *
 * Lê direto de profiles no Externo pelo ext_uuid, e não do `profile` do
 * AuthContext: aquele objeto vem da edge sync-user-to-external, que busca a
 * linha pelo uuid do Cloud — e profiles.user_id é o uuid do Externo, que
 * diverge em 26 dos 52 membros. Pelo ext_uuid funciona pra todo mundo.
 *
 * O estado é um cache de módulo com assinantes, pra que trocar a foto na tela
 * de perfil atualize na hora o avatar da sidebar e do menu do usuário, sem
 * refetch e sem prop drilling.
 */
import { useEffect, useState } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';

type Listener = (url: string | null) => void;

const listeners = new Set<Listener>();
let cachedUserId: string | null = null;
let cachedUrl: string | null = null;
let loadPromise: Promise<void> | null = null;

// Cache por usuário: computador da firma é compartilhado, e chave única já
// causou perfil de uma pessoa aparecendo na conta de outra (incidente 13/07/2026).
const storageKey = (userId: string) => `my_avatar_url:${userId}`;

function readStored(userId: string): string | null {
  try {
    return localStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}

function writeStored(userId: string, url: string | null) {
  try {
    if (url) localStorage.setItem(storageKey(userId), url);
    else localStorage.removeItem(storageKey(userId));
  } catch {
    /* localStorage cheio ou bloqueado — o avatar só perde o paint instantâneo */
  }
}

function publish(url: string | null) {
  cachedUrl = url;
  listeners.forEach((fn) => fn(url));
}

/** Chamado depois de trocar/remover a foto — evita esperar o próximo fetch. */
export function setMyAvatarUrl(url: string | null) {
  if (cachedUserId) writeStored(cachedUserId, url);
  publish(url);
}

async function load(userId: string): Promise<void> {
  const extUserId = await remapToExternal(userId);
  if (!extUserId) return;
  // A leitura de profiles exige role authenticated no Externo; sem a sessão
  // anônima pronta o select volta vazio (RLS), sem erro nenhum.
  await ensureExternalSession().catch(() => {});
  const { data } = await (db as any)
    .from('profiles')
    .select('avatar_url')
    .eq('user_id', extUserId)
    .maybeSingle();
  const url = (data?.avatar_url as string | null) ?? null;
  if (cachedUserId !== userId) return; // trocou de usuário no meio do caminho
  writeStored(userId, url);
  publish(url);
}

export function useMyAvatar(userId: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() =>
    userId ? (cachedUserId === userId ? cachedUrl : readStored(userId)) : null,
  );

  useEffect(() => {
    if (!userId) {
      setUrl(null);
      return;
    }

    if (cachedUserId !== userId) {
      cachedUserId = userId;
      cachedUrl = readStored(userId);
      loadPromise = null;
    }
    setUrl(cachedUrl);

    const listener: Listener = (next) => setUrl(next);
    listeners.add(listener);

    if (!loadPromise) {
      loadPromise = load(userId).catch((err) => {
        console.warn('[useMyAvatar] falha ao carregar foto:', err?.message || err);
        loadPromise = null;
      });
    }

    return () => {
      listeners.delete(listener);
    };
  }, [userId]);

  return url;
}
