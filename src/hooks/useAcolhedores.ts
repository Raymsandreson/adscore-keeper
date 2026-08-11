import { useCallback } from 'react';
import { useSharedFetch } from '@/lib/sharedFetch';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { getAcolhedorPhoto } from '@/lib/acolhedorPhotos';
import { useProfileAvatars } from '@/hooks/useProfileAvatars';

export interface Acolhedor {
  id: string;
  nome_canonico: string;
  foto_url: string | null;
  aliases: string[];
  ativo: boolean;
}

export interface AcolhedorAvatar {
  /** Registro da tabela acolhedores, se o nome casou por nome_canonico/alias. */
  acolhedor: Acolhedor | null;
  /**
   * Nesta ordem: foto de perfil que a própria pessoa subiu em "Meu Perfil"
   * (profiles.avatar_url), foto_url curada em `acolhedores`, foto local legada
   * (acolhedorPhotos.ts). A do perfil vem primeiro por ser sempre a mais nova.
   */
  fotoUrl: string | null;
  initials: string;
  /** Cor de fundo determinística (hash do nome) para avatar de iniciais. */
  bgColor: string;
}

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Paleta com contraste suficiente para texto branco.
const AVATAR_COLORS = [
  '#0f766e', '#b45309', '#7c3aed', '#be185d', '#1d4ed8',
  '#15803d', '#b91c1c', '#4338ca', '#a16207', '#0e7490',
];

export function acolhedorAvatarColor(name: string): string {
  const n = normalize(name);
  let hash = 0;
  for (let i = 0; i < n.length; i++) {
    hash = (hash * 31 + n.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map(p => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';
}

async function fetchAcolhedores(): Promise<Acolhedor[]> {
  try {
    await ensureExternalSession();
  } catch {
    /* sessão anônima é best-effort; RLS de leitura é aberta */
  }
  const { data, error } = await (db as any)
    .from('acolhedores')
    .select('id, nome_canonico, foto_url, aliases, ativo')
    .order('nome_canonico');
  if (error) throw error;
  return (data || []) as Acolhedor[];
}

/**
 * Monta o avatar de uma pessoa a partir das três fontes de foto.
 * Exportada pura para teste; `resolveProfileFoto` casa nome → profiles.avatar_url.
 */
export function buildPersonAvatar(
  name: string | null | undefined,
  acolhedores: Acolhedor[],
  resolveProfileFoto: (name: string | null | undefined) => string | null,
): AcolhedorAvatar | null {
  if (!name || !name.trim()) return null;
  const n = normalize(name);
  const record =
    acolhedores.find(a => normalize(a.nome_canonico) === n) ||
    acolhedores.find(a => (a.aliases || []).some(al => normalize(al) === n)) ||
    null;
  // Tenta o nome recebido e o canônico: o responsável da atividade vem com o
  // full_name do profile, mas o acolhedor do lead pode vir por alias.
  const profileFoto =
    resolveProfileFoto(name) || (record ? resolveProfileFoto(record.nome_canonico) : null);
  return {
    acolhedor: record,
    fotoUrl: profileFoto || record?.foto_url || getAcolhedorPhoto(name),
    initials: initialsOf(record?.nome_canonico || name),
    bgColor: acolhedorAvatarColor(record?.nome_canonico || name),
  };
}

export function useAcolhedores() {
  const { data: acolhedores, loading, refetch } = useSharedFetch<Acolhedor[]>(
    'acolhedores',
    fetchAcolhedores,
    [],
  );

  const ativos = acolhedores.filter(a => a.ativo);
  const { resolve: resolveProfileAvatar } = useProfileAvatars();

  const resolve = useCallback(
    (name: string | null | undefined): AcolhedorAvatar | null =>
      buildPersonAvatar(name, acolhedores, resolveProfileAvatar),
    [acolhedores, resolveProfileAvatar],
  );

  return { acolhedores, ativos, loading, refetch, resolve };
}
