/**
 * Runtime guard que sanitiza colunas `date` em qualquer escrita na tabela
 * `leads` do Supabase Externo. Monkey-patch idempotente aplicado no boot,
 * no mesmo espírito do install-db-routing-guard.ts.
 *
 * Motivo: há ~27 pontos de INSERT e dezenas de UPDATE em `leads` espalhados
 * pelo app; vários montam o payload direto com dados extraídos por IA
 * (ex.: accident_date: "2024"), sem passar por normalizeDateInput. Um valor
 * parcial derruba a requisição inteira com 22007. O guard fecha todas as
 * rotas de uma vez — inclusive as que forem criadas depois.
 *
 * Ver src/utils/sanitizeLeadDateFields.ts para a lista de colunas.
 */
import { externalSupabase } from './external-client';
import { sanitizeLeadDateFields } from '@/utils/sanitizeLeadDateFields';

type WriteFn = (values: unknown, ...rest: unknown[]) => unknown;
type QueryBuilder = Record<string, unknown>;
type PatchableClient = { from?: (relation: string, ...rest: unknown[]) => QueryBuilder };

const WRITE_METHODS = ['insert', 'update', 'upsert'] as const;

let installed = false;

export function installLeadDateGuard(): void {
  if (installed) return;

  const client = externalSupabase as unknown as PatchableClient;
  const originalFrom = client.from?.bind(client);
  if (typeof originalFrom !== 'function') return;

  client.from = (relation: string, ...rest: unknown[]) => {
    const builder = originalFrom(relation, ...rest);
    if (relation !== 'leads' || !builder) return builder;

    for (const method of WRITE_METHODS) {
      const original = builder[method];
      if (typeof original !== 'function') continue;
      const bound = (original as WriteFn).bind(builder);
      builder[method] = (values: unknown, ...args: unknown[]) =>
        bound(sanitizeLeadDateFields(values), ...args);
    }

    return builder;
  };

  installed = true;
}
