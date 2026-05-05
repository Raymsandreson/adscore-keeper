/**
 * Barrel oficial dos clients Supabase.
 *
 * REGRA DE OURO:
 *   - `db`         → dados de negócio (Supabase EXTERNO)
 *   - `authClient` → autenticação / metadados (Supabase CLOUD)
 *
 * Importe SEMPRE deste barrel:
 *   import { db } from '@/integrations/supabase';
 *   import { authClient } from '@/integrations/supabase';
 *
 * Os nomes antigos (`supabase`, `externalSupabase`) continuam exportados
 * apenas para compatibilidade durante a migração dos arquivos legados.
 * Em código NOVO, use exclusivamente `db` e `authClient`.
 */

export { supabase as authClient, supabase } from './client';
export { externalSupabase as db, externalSupabase, ensureExternalSession } from './external-client';
