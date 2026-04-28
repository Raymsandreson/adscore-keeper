/**
 * Helper para remapear UUIDs do Cloud auth para UUIDs do auth Externo.
 *
 * Contexto:
 * - Frontend autentica no Cloud (auth.uid() = cloud_uuid)
 * - Tabelas de negócio vivem no Externo, com FKs para auth.users do Externo
 * - Tabela `auth_uuid_mapping` existe nos DOIS bancos (cloud_uuid → ext_uuid)
 *
 * Uso: ANTES de qualquer insert/update no Externo que grave colunas de
 * usuário (created_by, assigned_to, completed_by, updated_by, user_id),
 * passar o valor por `remapToExternal()`.
 */
import { externalSupabase } from './external-client';

let cache: Map<string, string> | null = null;
let cachePromise: Promise<Map<string, string>> | null = null;

async function loadCache(): Promise<Map<string, string>> {
  if (cache) return cache;
  if (cachePromise) return cachePromise;

  cachePromise = (async () => {
    const { data, error } = await (externalSupabase as any)
      .from('auth_uuid_mapping')
      .select('cloud_uuid, ext_uuid');

    if (error) {
      console.warn('[uuid-remap] failed to load mapping:', error.message);
      cachePromise = null;
      return new Map();
    }

    const map = new Map<string, string>();
    for (const row of ((data as Array<{ cloud_uuid: string; ext_uuid: string }>) || [])) {
      map.set(row.cloud_uuid, row.ext_uuid);
    }
    cache = map;
    return map;
  })();

  return cachePromise;
}

/**
 * Converte um UUID do Cloud auth para o UUID correspondente no Externo.
 * Se o mapping não for encontrado, retorna o próprio uuid (fallback seguro
 * para usuários que já têm o mesmo UUID nos dois bancos).
 */
export async function remapToExternal(cloudUuid: string | null | undefined): Promise<string | null> {
  if (!cloudUuid) return null;
  const map = await loadCache();
  return map.get(cloudUuid) ?? cloudUuid;
}

/**
 * Variante síncrona (assume cache já carregado). Use apenas dentro de
 * funções que já garantiram o load (ex: chamando ensureRemapCache antes).
 */
export function remapToExternalSync(cloudUuid: string | null | undefined): string | null {
  if (!cloudUuid) return null;
  if (!cache) return cloudUuid;
  return cache.get(cloudUuid) ?? cloudUuid;
}

export async function ensureRemapCache(): Promise<void> {
  await loadCache();
}

/** Força reload do cache (após signup de novo usuário, por exemplo). */
export function invalidateRemapCache(): void {
  cache = null;
  cachePromise = null;
}
