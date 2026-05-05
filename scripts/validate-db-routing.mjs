#!/usr/bin/env node
/**
 * CI guard: detecta `supabase.from('<tabela_de_negocio>')` no código fonte.
 * Tabela de negócio mora no Supabase Externo — use `externalSupabase`.
 *
 * Modo padrão: lista violações e sai 0 (apenas reporta).
 * Com STRICT_DB_ROUTING=1 ou flag --strict, sai 1 se houver violações.
 *
 * Uso:
 *   node scripts/validate-db-routing.mjs
 *   node scripts/validate-db-routing.mjs --strict
 *   STRICT_DB_ROUTING=1 npm run test:db-routing
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

const BUSINESS_TABLES = [
  "leads",
  "lead_activities",
  "lead_processes",
  "lead_followups",
  "lead_custom_fields",
  "lead_stage_history",
  "lead_sources",
  "lead_whatsapp_groups",
  "legal_cases",
  "case_process_tracking",
  "contacts",
  "contact_leads",
  "contact_bridges",
  "contact_classifications",
  "contact_professions",
  "contact_relationships",
  "zapsign_documents",
  "kanban_boards",
  "whatsapp_messages",
  "whatsapp_instances",
  "whatsapp_conversation_agents",
  "lead_processes_movements",
  "process_parties",
  "activity_chat_messages",
  "beneficiaries",
  "checklists",
  "checklist_items",
];

const SKIP_FILES = new Set([
  "integrations/supabase/client.ts",
  "integrations/supabase/external-client.ts",
  "integrations/supabase/db-routing.ts",
  "integrations/supabase/install-db-routing-guard.ts",
  "integrations/supabase/types.ts",
]);

const pattern = new RegExp(
  `(^|[^a-zA-Z0-9_])supabase\\.from\\(\\s*['"\`](${BUSINESS_TABLES.join("|")})['"\`]`,
  "g",
);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) yield full;
  }
}

const strict =
  process.argv.includes("--strict") || process.env.STRICT_DB_ROUTING === "1";
const violations = [];

for (const file of walk(SRC)) {
  const rel = relative(SRC, file).replaceAll("\\", "/");
  if (SKIP_FILES.has(rel)) continue;
  const content = readFileSync(file, "utf8");
  let m;
  pattern.lastIndex = 0;
  while ((m = pattern.exec(content)) !== null) {
    const upTo = content.slice(0, m.index);
    const line = upTo.split("\n").length;
    violations.push({ file: rel, line, table: m[2] });
  }
}

if (violations.length === 0) {
  console.log("✓ Nenhuma violação de roteamento de DB encontrada.");
  process.exit(0);
}

console.log(
  `\n[db-routing] ${violations.length} ocorrência(s) de \`supabase.from('<tabela_de_negocio>')\` no client Cloud:\n`,
);
for (const v of violations) {
  console.log(`  src/${v.file}:${v.line}  →  ${v.table}`);
}
console.log(
  `\nUse \`externalSupabase\` para essas tabelas. Lista em src/integrations/supabase/db-routing.ts.`,
);

if (strict) {
  console.log("\nSTRICT mode: falhando build.");
  process.exit(1);
}
console.log("\n(modo report — passe --strict ou STRICT_DB_ROUTING=1 para falhar.)");
process.exit(0);
