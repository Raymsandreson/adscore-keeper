// Verifica a criação de process_movements no Supabase EXTERNO (só leitura).
// Uso:  SUPABASE_PAT=sbp_... node _verify_process_movements.mjs
import process from 'node:process';

const REF = 'kmedldlepwiityjsdahz';
const PAT = process.env.SUPABASE_PAT;
if (!PAT) { console.error('Faltou SUPABASE_PAT.'); process.exit(1); }

const run = async (label, query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const txt = await r.text();
  console.log(`\n=== ${label} (status ${r.status}) ===`);
  console.log(txt.slice(0, 1200));
};

await run('Colunas da tabela', `
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='process_movements'
  ORDER BY ordinal_position;`);

await run('Índices', `
  SELECT indexname FROM pg_indexes
  WHERE schemaname='public' AND tablename='process_movements' ORDER BY indexname;`);

await run('RLS habilitado + policies', `
  SELECT c.relrowsecurity AS rls_on,
         (SELECT array_agg(polname) FROM pg_policy WHERE polrelid=c.oid) AS policies
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='process_movements';`);

await run('View de status atual existe', `
  SELECT table_name FROM information_schema.views
  WHERE table_schema='public' AND table_name='lead_process_current_status';`);
