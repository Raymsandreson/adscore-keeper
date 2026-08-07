#!/usr/bin/env node
/**
 * CI guard: detecta escrita/leitura de tabela de negócio pelo client do Cloud.
 * Tabela de negócio mora no Supabase Externo — use `externalSupabase`/`db`.
 *
 * O guard resolve, arquivo a arquivo, QUAL identificador aponta para cada
 * client (lendo os imports), em vez de assumir que o nome `supabase` é sempre
 * o Cloud. Sem isso ele errava dos dois lados:
 *   - falso positivo em `import { externalSupabase as supabase }`
 *   - falso negativo em `import { supabase as cloudSupabase }`
 * E o `.from()` é procurado atravessando quebra de linha, porque
 * `await supabase\n  .from('leads')` passava batido no regex de uma linha só.
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
  "integrations/supabase/index.ts",
  "integrations/supabase/db-routing.ts",
  "integrations/supabase/install-db-routing-guard.ts",
  "integrations/supabase/types.ts",
]);

/** Nomes exportados pelo barrel `@/integrations/supabase` e a quem pertencem. */
const BARREL_CLOUD = new Set(["supabase", "authClient"]);
const BARREL_EXT = new Set(["externalSupabase", "db"]);

/**
 * Lê os imports do arquivo e devolve os identificadores locais de cada client.
 * Cobre `import { x }`, `import { x as y }` e caminhos relativos ou com alias @.
 */
function clientIdentifiers(content) {
  const cloud = new Set();
  const ext = new Set();
  const importRe = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(content)) !== null) {
    const spec = m[2];
    const isExtModule = spec.endsWith("/external-client");
    const isCloudModule = !isExtModule && spec.endsWith("/client");
    const isBarrel = spec === "@/integrations/supabase" || spec.endsWith("/integrations/supabase");
    if (!isExtModule && !isCloudModule && !isBarrel) continue;

    for (const raw of m[1].split(",")) {
      const parts = raw.trim().split(/\s+as\s+/);
      const original = parts[0]?.trim();
      const local = (parts[1] || parts[0])?.trim();
      if (!local) continue;
      if (isExtModule) ext.add(local);
      else if (isCloudModule) cloud.add(local);
      else if (BARREL_EXT.has(original)) ext.add(local);
      else if (BARREL_CLOUD.has(original)) cloud.add(local);
    }
  }
  return { cloud, ext };
}

const TABLES_ALT = BUSINESS_TABLES.join("|");

/**
 * `<ident>.from('tabela')`, tolerando espaço/quebra de linha antes do ponto e
 * um cast do tipo `(supabase as any).from(...)`.
 */
function usageRegex(ident) {
  const esc = ident.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(^|[^a-zA-Z0-9_$.])${esc}(?:\\s+as\\s+[^)\\n]{1,80}\\))?\\s*\\.\\s*from\\(\\s*['"\`](${TABLES_ALT})['"\`]`,
    "g",
  );
}

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
  const { cloud } = clientIdentifiers(content);
  if (cloud.size === 0) continue;

  for (const ident of cloud) {
    const re = usageRegex(ident);
    let m;
    while ((m = re.exec(content)) !== null) {
      const line = content.slice(0, m.index).split("\n").length;
      violations.push({ file: rel, line, table: m[2], ident });
    }
  }
}

violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

if (violations.length === 0) {
  console.log("✓ Nenhuma violação de roteamento de DB encontrada.");
  process.exit(0);
}

console.log(
  `\n[db-routing] ${violations.length} ocorrência(s) de tabela de negócio lida/escrita pelo client Cloud:\n`,
);
for (const v of violations) {
  console.log(`  src/${v.file}:${v.line}  →  ${v.table}  (via \`${v.ident}\`)`);
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
