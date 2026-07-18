// SOMENTE LEITURA — checa o estado atual da FK legal_cases.lead_id no Supabase EXTERNO.
// Não altera nada. Uso:
//   SUPABASE_PAT=sbp_... node _verify_legal_cases_fk.mjs
// PAT: https://supabase.com/dashboard/account/tokens
const REF = 'kmedldlepwiityjsdahz';
const PAT = process.env.SUPABASE_PAT;
if (!PAT) { console.error('Faltou SUPABASE_PAT. Ex: SUPABASE_PAT=sbp_... node _verify_legal_cases_fk.mjs'); process.exit(1); }

// confdeltype: a=NO ACTION, r=RESTRICT, c=CASCADE, n=SET NULL, d=SET DEFAULT
const query = `
  SELECT con.conname,
         con.confdeltype,
         CASE con.confdeltype
           WHEN 'c' THEN 'CASCADE  (❌ ainda destrói o caso ao apagar o lead)'
           WHEN 'n' THEN 'SET NULL (✅ corrigido)'
           WHEN 'a' THEN 'NO ACTION'
           WHEN 'r' THEN 'RESTRICT'
           WHEN 'd' THEN 'SET DEFAULT'
         END AS delete_rule
  FROM pg_constraint con
  WHERE con.conrelid = 'public.legal_cases'::regclass
    AND con.contype = 'f'
    AND 'lead_id' = ANY (ARRAY(
      SELECT a.attname FROM pg_attribute a
      WHERE a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
    ));
`;

const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
});
const txt = await r.text();
if (!r.ok) { console.error(`❌ falhou status=${r.status}`); console.error(txt.slice(0, 500)); process.exit(1); }
console.log('Estado atual da FK legal_cases.lead_id:');
console.log(txt);
