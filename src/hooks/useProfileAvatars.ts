/**
 * Fotos de perfil da equipe, indexadas por nome.
 *
 * Existe porque a foto que a pessoa troca em "Meu Perfil" grava em
 * profiles.avatar_url, mas os avatares espalhados pelo app (responsável da
 * atividade, acolhedor do lead) são resolvidos pelo NOME — e olhavam só a
 * tabela `acolhedores` e os assets locais de acolhedorPhotos.ts. Resultado:
 * o topo mostrava a foto nova e a atividade continuava nas iniciais.
 *
 * Só carrega quem tem foto (`avatar_url not null`), então a lista é curta
 * mesmo com os ~4,3 mil perfis do Externo (a maioria é cliente sem foto).
 */
import { useCallback } from 'react';
import { useSharedFetch, setSharedData } from '@/lib/sharedFetch';
import { db, ensureExternalSession } from '@/integrations/supabase';

export interface ProfileAvatar {
  user_id: string;
  full_name: string | null;
  avatar_url: string;
}

const CACHE_KEY = 'profile_avatars';

/** Última lista publicada, para o update otimista de setProfileAvatarInCache. */
let lastList: ProfileAvatar[] = [];

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchProfileAvatars(): Promise<ProfileAvatar[]> {
  // Sem a sessão anônima do Externo o select volta vazio por RLS, sem erro.
  await ensureExternalSession().catch(() => {});
  const { data, error } = await (db as any)
    .from('profiles')
    .select('user_id, full_name, avatar_url')
    .not('avatar_url', 'is', null)
    .not('full_name', 'is', null)
    .order('user_id')
    .limit(500);
  if (error) throw error;
  lastList = (data || []) as ProfileAvatar[];
  return lastList;
}

/**
 * Atualiza o cache na hora depois que alguém troca a própria foto, para o
 * avatar mudar nas outras telas sem esperar o TTL do sharedFetch.
 */
export function setProfileAvatarInCache(
  userId: string | null | undefined,
  fullName: string | null | undefined,
  url: string | null,
) {
  if (!userId && !fullName) return;
  // Dedupe também pelo nome: o userId que chega aqui é o do Cloud e a lista é
  // indexada pelo uuid do Externo — sem isso a entrada antiga sobreviveria e o
  // resolve (que casa por nome) continuaria devolvendo a foto velha.
  const n = fullName ? normalize(fullName) : null;
  const rest = lastList.filter(
    p => p.user_id !== userId && !(n && p.full_name && normalize(p.full_name) === n),
  );
  lastList = url && fullName
    ? [...rest, { user_id: userId || fullName, full_name: fullName, avatar_url: url }]
    : rest;
  setSharedData<ProfileAvatar[]>(CACHE_KEY, lastList);
}

/** Casa nome → avatar_url na lista de perfis. Exportada pura para teste. */
export function pickProfileAvatar(
  avatars: ProfileAvatar[],
  name: string | null | undefined,
): string | null {
  if (!name || !name.trim()) return null;
  const n = normalize(name);
  const hit = avatars.find(p => p.full_name && normalize(p.full_name) === n);
  return hit?.avatar_url ?? null;
}

export interface ProfileAvatarsResult {
  avatars: ProfileAvatar[];
  loading: boolean;
  /** Foto de perfil de uma pessoa pelo nome; null quando não tem. */
  resolve: (name: string | null | undefined) => string | null;
}

export function useProfileAvatars(): ProfileAvatarsResult {
  const { data, loading } = useSharedFetch<ProfileAvatar[]>(CACHE_KEY, fetchProfileAvatars, []);

  const resolve = useCallback(
    (name: string | null | undefined): string | null => pickProfileAvatar(data, name),
    [data],
  );

  return { avatars: data, loading, resolve };
}
