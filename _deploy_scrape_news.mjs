// Deploy da função scrape-news no Supabase EXTERNO (kmedldlepwiityjsdahz).
// Consolidação: o PAT do usuário não tem acesso ao Cloud (gliigkupoebmlbwyvijp, gerenciado
// pelo Lovable), então a função corrigida roda no externo e o functionRouter aponta pra lá
// (fallback automático → Cloud, onde fica a versão legada).
// Fix: detecção de página de bloqueio anti-bot (Cloudflare) + proxy 'auto' no Firecrawl.
// Uso:  SUPABASE_PAT=sbp_... node _deploy_scrape_news.mjs
// Arquivo temporário — pode apagar depois do deploy.
import { readFileSync, writeFileSync } from 'node:fs';

const REF = 'kmedldlepwiityjsdahz';          // Supabase Externo
const SLUG = 'scrape-news';
const PAT = process.env.SUPABASE_PAT;
if (!PAT) {
  console.error('Faltou SUPABASE_PAT. Ex: SUPABASE_PAT=sbp_... node _deploy_scrape_news.mjs');
  process.exit(1);
}

const code = readFileSync('supabase/functions/scrape-news/index.ts', 'utf8');
const base = `https://api.supabase.com/v1/projects/${REF}/functions`;
const headers = { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' };

// Backup do código atualmente deployado, se a função já existir (rollback: redeploy do backup).
const cur = await fetch(`${base}/${SLUG}/body`, { headers: { Authorization: `Bearer ${PAT}` } });
if (cur.ok) {
  writeFileSync(`_backup_${SLUG}_deployed.ts`, await cur.text());
  console.log(`backup salvo em _backup_${SLUG}_deployed.ts`);
} else {
  console.log(`função ${SLUG} ainda não existe no ${REF} (HTTP ${cur.status}) — deploy novo`);
}

// Tenta criar; se já existe (409/400), faz PATCH (update). verify_jwt: false = mesmo padrão
// das outras funções consolidadas no externo (gateway exige apikey; sem dados sensíveis).
let r = await fetch(base, {
  method: 'POST',
  headers,
  body: JSON.stringify({ slug: SLUG, name: SLUG, verify_jwt: false, body: code }),
});
let txt = await r.text();
if (r.status === 409 || r.status === 400) {
  r = await fetch(`${base}/${SLUG}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ body: code, verify_jwt: false }),
  });
  txt = await r.text();
}
console.log(r.ok ? `✅ deploy OK (slug=${SLUG}, ref=${REF})` : `❌ falhou status=${r.status}`);
console.log(txt.slice(0, 600));
