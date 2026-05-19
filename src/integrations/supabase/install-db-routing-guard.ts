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
    const isBiz = typeof relation === 'string' && BUSINESS_TABLES_SET.has(relation);
    if (isBiz) reportBusinessTableOnCloud(relation);

    const builder = originalFrom(relation, ...rest);
    if (!isBiz || !builder) return builder;

    // Bloqueio de ESCRITA em tabelas de negócio no Cloud.
    // Leitura (.select) e Realtime (.channel) ficam intactos — sem custo extra.
    const WRITE_METHODS = ['insert', 'update', 'upsert', 'delete'] as const;
    for (const m of WRITE_METHODS) {
      const original = builder[m]?.bind(builder);
      if (typeof original !== 'function') continue;
      builder[m] = (..._args: unknown[]) => {
        const errMsg =
          `[db-routing] Bloqueado: tentativa de ${m.toUpperCase()} em "${relation}" no client Cloud. ` +
          `Use externalSupabase (banco de negócio).`;
        // eslint-disable-next-line no-console
        console.error(errMsg);
        // Builder "fake" thenable: qualquer .eq/.select/.single/etc. retorna ele mesmo,
        // e await resolve com { data: null, error } — sem rede, sem travar a UI.
        const fake: any = new Proxy(
          {
            then: (resolve: any) => resolve({ data: null, error: { message: errMsg, code: 'CLOUD_WRITE_BLOCKED' } }),
            catch: () => fake,
            finally: (cb: any) => { try { cb?.(); } catch {} return fake; },
          },
          {
            get(target, prop) {
              if (prop in target) return (target as any)[prop];
              return () => fake;
            },
          },
        );
        return fake;
      };
    }
    return builder;
  };

  installed = true;
}
