#!/usr/bin/env node
/**
 * CI guard: Edge Functions must not use Lovable Cloud DB for business data.
 *
 * Project rule:
 * - Lovable Cloud DB: Auth/metadata only.
 * - External Supabase / Railway: all business data and new functions.
 *
 * This guard blocks NEW unclassified Edge Functions from creating clients with
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY or importing the legacy shared client
 * that can fall back to Cloud DB.
 *
 * Existing legacy functions must stay explicitly listed until migrated/reviewed.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FUNCTIONS_DIR = join(ROOT, 'supabase', 'functions');

const CLOUD_DB_ALLOWED = new Set([
  'admin-whatsapp-instance',
  'bulk-create-users',
  'create-cloud-user',
  'db-drift-monitor',
  'sync-new-user-mapping',
  'zapsign-enrich-lead',
]);

const LEGACY_REVIEWED = new Set([
  'bridge-activity-to-external',
  'bridge-parity-check',
  'callface-register',
  'check-process-movements',
  'compute-monitor-snapshots',
  'create-whatsapp-group',
  'elevenlabs-sts',
  'elevenlabs-tts',
  'execute-agent-automations',
  'expense-form-reminders',
  'fetch-group-creation-date',
  'find-contact-groups',
  'generate-group-message-preview',
  'get-group-participants',
  'import-group-docs-to-lead',
  'instagram-comment-webhook',
  'lead-reprocess-procuracao',
  'migrate-cloud-to-external',
  'migrate-data-to-external',
  'migrate-finalize-pending',
  'migrate-resync-gap',
  'migration-orchestrator',
  'migration-validate',
  'monitor-campaign-status',
  // 'onboarding-checkpoint-execute' — REMOVIDA: portada para Railway.
  'permanent-delete-lead',
  'register-whatsapp-instance',
  'send-password-reset',
  'sync-all-whatsapp-groups',
  'sync-auth-cloud-to-external',
  'sync-group-contacts',
  'test-column-access',
  'update-agent-filters',
  'wjia-followup-processor',
  'zapsign-audit',
  'zapsign-backfill-from-2026',
  'zapsign-webhook',
]);

// Exceções permanentes: utilitárias de infra que NÃO tocam DB de negócio.
// `railway-redeploy` mora no Cloud por design — se vivesse no Railway, não conseguiria
// se redeployar quando o Railway estivesse fora. Não acessa nenhuma tabela.
const SAFE_INFRA_ONLY = new Set([
  'railway-redeploy',
]);

const VIOLATION_PATTERNS = [
  { name: 'Deno.env.get(SUPABASE_URL)', re: /Deno\.env\.get\(\s*['"]SUPABASE_URL['"]\s*\)/ },
  { name: 'Deno.env.get(SUPABASE_SERVICE_ROLE_KEY)', re: /Deno\.env\.get\(\s*['"]SUPABASE_SERVICE_ROLE_KEY['"]\s*\)/ },
  { name: 'legacy _shared/supabase-client', re: /['_"]\.\.\/_shared\/supabase-client(?:\.ts)?['_"]|['_"]\.\.\/_shared\/supabase-client\.ts['_"]/ },
  { name: 'getSupabaseConfig/createServiceClient', re: /\b(getSupabaseConfig|createServiceClient)\b/ },
];

function listFunctionEntries() {
  return readdirSync(FUNCTIONS_DIR)
    .filter((entry) => entry !== '_shared')
    .map((entry) => join(FUNCTIONS_DIR, entry))
    .filter((full) => statSync(full).isDirectory());
}

const violations = [];

for (const fullDir of listFunctionEntries()) {
  const name = fullDir.split('/').pop();
  if (SAFE_INFRA_ONLY.has(name)) continue;

  const indexFile = join(fullDir, 'index.ts');
  try {
    statSync(indexFile);
  } catch {
    continue;
  }

  const content = readFileSync(indexFile, 'utf8');
  const matched = VIOLATION_PATTERNS.filter((p) => p.re.test(content)).map((p) => p.name);
  if (matched.length === 0) continue;

  const isAllowed = CLOUD_DB_ALLOWED.has(name) || LEGACY_REVIEWED.has(name);
  if (!isAllowed) {
    violations.push({
      functionName: name,
      file: relative(ROOT, indexFile).replaceAll('\\', '/'),
      matched,
    });
  }
}

if (violations.length === 0) {
  console.log('✓ Edge DB routing guard OK: nenhuma função nova aponta para Lovable Cloud DB sem allowlist.');
  process.exit(0);
}

console.error('\n[edge-db-routing] Uso de Lovable Cloud DB detectado fora da allowlist:\n');
for (const v of violations) {
  console.error(`  ${v.file} (${v.functionName})`);
  console.error(`    padrões: ${v.matched.join(', ')}`);
}
console.error('\nRegra do projeto: funções novas vão para Railway primeiro; se precisarem de DB, usar EXTERNAL_SUPABASE_URL/EXTERNAL_DB_URL.');
console.error('Só adicione na allowlist se for Auth/Metadata e isso estiver documentado no código.\n');
process.exit(1);
