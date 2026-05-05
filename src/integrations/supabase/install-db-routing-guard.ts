/**
 * Runtime guard que envolve `supabase.from(...)` (Cloud client) para detectar
 * uso indevido em tabelas de negócio. NÃO edita o client.ts (auto-gerado);
 * monkey-patch idempotente aplicado uma vez no boot.
 *
 * Ver db-routing.ts para a lista de tabelas e modos.
 */
import { supabase } from './client';
import {
  BUSINESS_TABLES_SET,
  reportBusinessTableOnCloud,
  getDbRoutingMode,
} from './db-routing';

let installed = false;

export function installDbRoutingGuard(): void {
  if (installed) return;
  if (getDbRoutingMode() === 'off') return;

  const client = supabase as any;
  const originalFrom = client.from?.bind(client);
  if (typeof originalFrom !== 'function') return;

  client.from = (relation: string, ...rest: unknown[]) => {
    if (typeof relation === 'string' && BUSINESS_TABLES_SET.has(relation)) {
      reportBusinessTableOnCloud(relation);
    }
    return originalFrom(relation, ...rest);
  };

  installed = true;
}
