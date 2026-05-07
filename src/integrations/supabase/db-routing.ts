/**
 * DB Routing Guard
 *
 * Tabelas de NEGÓCIO vivem no Supabase EXTERNO (kmedldlepwiityjsdahz).
 * O cliente `supabase` (Cloud / gliigkupoebmlbwyvijp) é exclusivamente para
 * Auth / metadados. Qualquer `.from('<tabela_de_negocio>')` no client Cloud
 * resulta em FK errors (Lovable-Cloud lookup falha) ou em leitura de dados
 * fantasmas duplicados.
 *
 * Esta lista é a fonte da verdade — usada por:
 *  - Proxy runtime (client.ts) para warn/throw
 *  - Regra ESLint customizada (eslint.config.js)
 *  - Script CI (scripts/validate-db-routing.mjs)
 */

export const BUSINESS_TABLES: readonly string[] = [
  'leads',
  'lead_activities',
  'lead_processes',
  'lead_followups',
  'lead_custom_fields',
  'lead_custom_field_values',
  'lead_field_layouts',
  'lead_stage_history',
  'lead_sources',
  'lead_whatsapp_groups',
  'legal_cases',
  'case_process_tracking',
  'contacts',
  'contact_leads',
  'contact_bridges',
  'contact_classifications',
  'contact_professions',
  'contact_relationships',
  'zapsign_documents',
  'kanban_boards',
  'whatsapp_messages',
  'whatsapp_instances',
  'whatsapp_conversation_agents',
  'lead_processes_movements',
  'process_parties',
  'activity_chat_messages',
  'beneficiaries',
  'checklists',
  'checklist_items',
];

export const BUSINESS_TABLES_SET = new Set(BUSINESS_TABLES);

/**
 * 'off'   = sem proteção
 * 'warn'  = console.warn ao usar Cloud para tabela de negócio (default)
 * 'strict'= lança Error imediatamente
 */
export type DbRoutingMode = 'off' | 'warn' | 'strict';

export function getDbRoutingMode(): DbRoutingMode {
  try {
    const v = (import.meta as any)?.env?.VITE_DB_ROUTING_MODE;
    if (v === 'off' || v === 'warn' || v === 'strict') return v;
  } catch {}
  return 'warn';
}

const warned = new Set<string>();

export function reportBusinessTableOnCloud(table: string): void {
  const mode = getDbRoutingMode();
  if (mode === 'off') return;

  const msg =
    `[db-routing] Tabela de negócio "${table}" foi consultada no client Cloud (supabase). ` +
    `Use externalSupabase. Lista em src/integrations/supabase/db-routing.ts.`;

  if (mode === 'strict') {
    throw new Error(msg);
  }

  // warn: 1 vez por tabela para não inundar o console
  if (!warned.has(table)) {
    warned.add(table);
    // eslint-disable-next-line no-console
    console.warn(msg);
  }
}
