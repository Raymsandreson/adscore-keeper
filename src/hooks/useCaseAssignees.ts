// =============================================================================
// Resolve os responsáveis de caso (legal_cases.assigned_to e
// assigned_to_judicial) de UUID do Externo para nome/iniciais/cor, pra lista de
// casos poder mostrar de quem é cada caso sem abrir nada.
//
// Por que não sai direto de um join: as colunas não têm FK e apontam para o
// auth do EXTERNO, enquanto o front autentica no Cloud. Os 7 assessores do PREV
// já estão em INSS_PREV_OPTIONS (UUID do Cloud), então o caminho barato é
// remapear e casar na lista; só quem sobra vira uma consulta ao profiles.
// =============================================================================
import { useEffect, useMemo, useState } from 'react';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { ensureRemapCache, remapToCloudSync } from '@/integrations/supabase/uuid-remap';
import { INSS_PREV_OPTIONS } from '@/lib/processAssignment';

export interface AssigneeInfo {
  /** UUID do Externo, como está gravado em legal_cases. */
  extUuid: string;
  /** Nome completo, para o tooltip. */
  name: string;
  /** Nome curto ("Maria Lydia"), para rótulos apertados. */
  shortName: string;
  initials: string;
  /** Cor de fundo determinística — a mesma pessoa tem sempre a mesma cor. */
  color: string;
}

function initialsOf(name: string): string {
  const partes = name.trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  const primeira = partes[0][0] || '';
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] || '' : '';
  return (primeira + ultima).toUpperCase();
}

/** Hash estável do nome → matiz. Evita o avatar trocar de cor a cada render. */
function colorOf(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(h) % 360} 55% 42%)`;
}

function build(extUuid: string, name: string, shortName?: string): AssigneeInfo {
  return {
    extUuid,
    name,
    shortName: shortName || name.trim().split(/\s+/).slice(0, 2).join(' '),
    initials: initialsOf(name),
    color: colorOf(name),
  };
}

/**
 * Recebe os UUIDs do Externo que aparecem na tela e devolve o mapa resolvido.
 * Reconsulta só quando entra um uuid novo.
 */
export function useCaseAssignees(extUuids: Array<string | null | undefined>): Map<string, AssigneeInfo> {
  const chave = useMemo(() => {
    const unicos = Array.from(new Set(extUuids.filter(Boolean) as string[]));
    unicos.sort();
    return unicos.join(',');
  }, [extUuids]);

  const [mapa, setMapa] = useState<Map<string, AssigneeInfo>>(new Map());

  useEffect(() => {
    const uuids = chave ? chave.split(',') : [];
    if (!uuids.length) {
      setMapa(new Map());
      return;
    }
    let cancelado = false;

    (async () => {
      await ensureRemapCache();
      const resolvido = new Map<string, AssigneeInfo>();
      const faltando: string[] = [];

      for (const ext of uuids) {
        const cloud = remapToCloudSync(ext);
        const conhecido = INSS_PREV_OPTIONS.find(o => o.userId === cloud);
        if (conhecido) resolvido.set(ext, build(ext, conhecido.userName, conhecido.shortName));
        else faltando.push(ext);
      }

      if (faltando.length) {
        try {
          // profiles casa por user_id; profiles.id dá null para quase todo mundo.
          const { data } = await externalSupabase
            .from('profiles')
            .select('user_id, full_name')
            .in('user_id', faltando);
          for (const p of ((data || []) as Array<{ user_id: string; full_name: string | null }>)) {
            if (p.full_name) resolvido.set(p.user_id, build(p.user_id, p.full_name));
          }
        } catch {
          // sem nome o avatar simplesmente não aparece; não vale derrubar a lista
        }
      }

      if (!cancelado) setMapa(resolvido);
    })();

    return () => { cancelado = true; };
  }, [chave]);

  return mapa;
}
