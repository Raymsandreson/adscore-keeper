// Deploy do _external_send-whatsapp → função "send-whatsapp" no Supabase EXTERNO.
// Uso:  SUPABASE_PAT=seu_token node _deploy_send_whatsapp.mjs
// PAT: https://supabase.com/dashboard/account/tokens  (Personal Access Token)
// Arquivo temporário — pode apagar depois do deploy.
import { readFileSync } from 'node:fs';

const REF = 'kmedldlepwiityjsdahz';          // Supabase Externo
const SLUG = 'send-whatsapp';                 // nome da função no Externo
const PAT = process.env.SUPABASE_PAT;
if (!PAT) { console.error('Faltou SUPABASE_PAT. Ex: SUPABASE_PAT=sbp_... node _deploy_send_whatsapp.mjs'); process.exit(1); }

const code = readFileSync('supabase/functions/_external_send-whatsapp/index.ts', 'utf8');
const base = `https://api.supabase.com/v1/projects/${REF}/functions`;
const headers = { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' };

// Tenta criar; se já existe (409/400), faz PATCH (update) — mesma lógica da deploy-to-external.
let r = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ slug: SLUG, name: SLUG, verify_jwt: false, body: code }) });
let txt = await r.text();
if (r.status === 409 || r.status === 400) {
  r = await fetch(`${base}/${SLUG}`, { method: 'PATCH', headers, body: JSON.stringify({ body: code, verify_jwt: false }) });
  txt = await r.text();
}
console.log(r.ok ? `✅ deploy OK (slug=${SLUG}, ref=${REF})` : `❌ falhou status=${r.status}`);
console.log(txt.slice(0, 600));
