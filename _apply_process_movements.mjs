// Aplica a migration process_movements no Supabase EXTERNO via Management API.
// Uso:  SUPABASE_PAT=sbp_... node _apply_process_movements.mjs
// PAT: https://supabase.com/dashboard/account/tokens
// A migration é idempotente (IF NOT EXISTS / DROP POLICY IF EXISTS) — seguro rodar 2x.
// Arquivo temporário — pode apagar depois.
import { readFileSync } from 'node:fs';

const REF = 'kmedldlepwiityjsdahz'; // Supabase Externo (onde vive lead_processes)
const FILE = 'supabase/migrations/20260701124949_25152c99-611f-4c95-8f55-90081166beca.sql';
const PAT = process.env.SUPABASE_PAT;
if (!PAT) { console.error('Faltou SUPABASE_PAT. Ex: SUPABASE_PAT=sbp_... node _apply_process_movements.mjs'); process.exit(1); }

const query = readFileSync(FILE, 'utf8');
const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
});
const txt = await r.text();
console.log(r.ok ? `✅ migration process_movements aplicada (ref=${REF})` : `❌ falhou status=${r.status}`);
console.log(txt.slice(0, 800));
