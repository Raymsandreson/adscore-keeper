// Aplica a migration de soft-delete (casos/processos) no Supabase EXTERNO via Management API.
// Uso:  SUPABASE_PAT=sbp_... node _apply_softdelete_migration.mjs
// PAT: https://supabase.com/dashboard/account/tokens
// A migration é idempotente (IF NOT EXISTS / DROP ... IF EXISTS) — seguro rodar 2x.
// Arquivo temporário — pode apagar depois.
import { readFileSync } from 'node:fs';

const REF = 'kmedldlepwiityjsdahz'; // Supabase Externo
const FILE = 'supabase/migrations-external/20260715000000_soft_delete_cases_processes.sql';
const PAT = process.env.SUPABASE_PAT;
if (!PAT) { console.error('Faltou SUPABASE_PAT. Ex: SUPABASE_PAT=sbp_... node _apply_softdelete_migration.mjs'); process.exit(1); }

const query = readFileSync(FILE, 'utf8');
const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
});
const txt = await r.text();
console.log(r.ok ? `✅ migration aplicada (ref=${REF})` : `❌ falhou status=${r.status}`);
console.log(txt.slice(0, 800));
