// Aplica a migração legal_cases.lead_id -> ON DELETE SET NULL no Supabase EXTERNO.
// Uso:  SUPABASE_PAT=sbp_... node _apply_legal_cases_fk.mjs
// PAT: https://supabase.com/dashboard/account/tokens
// Idempotente. Arquivo temporário — pode apagar depois.
import { readFileSync } from 'node:fs';

const REF = 'kmedldlepwiityjsdahz';
const FILE = 'supabase/migrations-external/20260716000000_legal_cases_lead_fk_set_null.sql';
const PAT = process.env.SUPABASE_PAT;
if (!PAT) { console.error('Faltou SUPABASE_PAT. Ex: SUPABASE_PAT=sbp_... node _apply_legal_cases_fk.mjs'); process.exit(1); }

const query = readFileSync(FILE, 'utf8');
const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
});
const txt = await r.text();
console.log(r.ok ? `✅ migração aplicada (ref=${REF})` : `❌ falhou status=${r.status}`);
console.log(txt.slice(0, 800));
