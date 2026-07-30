import { useCallback } from 'react';
import { useSharedFetch } from '@/lib/sharedFetch';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { getAcolhedorPhoto } from '@/lib/acolhedorPhotos';

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
  /** foto_url do banco, senão foto local legada (acolhedorPhotos.ts). */
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

export function useAcolhedores() {
  const { data: acolhedores, loading, refetch } = useSharedFetch<Acolhedor[]>(
    'acolhedores',
    fetchAcolhedores,
    [],
  );

  const ativos = acolhedores.filter(a => a.ativo);

  const resolve = useCallback(
    (name: string | null | undefined): AcolhedorAvatar | null => {
      if (!name || !name.trim()) return null;
      const n = normalize(name);
      const record =
        acolhedores.find(a => normalize(a.nome_canonico) === n) ||
        acolhedores.find(a => (a.aliases || []).some(al => normalize(al) === n)) ||
        null;
      return {
        acolhedor: record,
        fotoUrl: record?.foto_url || getAcolhedorPhoto(name),
        initials: initialsOf(record?.nome_canonico || name),
        bgColor: acolhedorAvatarColor(record?.nome_canonico || name),
      };
    },
    [acolhedores],
  );

  return { acolhedores, ativos, loading, refetch, resolve };
}
