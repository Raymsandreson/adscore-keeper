#!/usr/bin/env node
// Deploy de edge function no Supabase EXTERNO (kmedldlepwiityjsdahz), pela
// Management API. Substitui os `_deploy_*.mjs` avulsos da raiz, que eram um
// arquivo por função e por isso ficavam desatualizados.
//
// Uso:
//   SUPABASE_PAT=sbp_... node scripts/deploy-edge-externo.mjs dom-rascunho [outra ...]
//   SUPABASE_PAT=sbp_... node scripts/deploy-edge-externo.mjs --mudadas-desde origin/main
//
// PAT: https://supabase.com/dashboard/account/tokens
//
// Antes de subir, salva o código que está no ar em
// `.deploy-backup/<slug>.ts` — rollback é redeployar esse arquivo.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const REF = process.env.EXTERNAL_SUPABASE_REF || 'kmedldlepwiityjsdahz';
const RAIZ = 'supabase/functions/_external';
const PAT = process.env.SUPABASE_PAT;

if (!PAT) {
  console.error('Faltou SUPABASE_PAT.  Ex: SUPABASE_PAT=sbp_... node scripts/deploy-edge-externo.mjs dom-rascunho');
  process.exit(1);
}

let slugs = process.argv.slice(2);

// `--mudadas-desde <ref>`: descobre sozinho quais funções o diff tocou. É o que
// o workflow usa — subir as 5 funções toda vez que uma muda seria pedir para um
// bug adormecido em outra acordar num deploy que não era dela.
const i = slugs.indexOf('--mudadas-desde');
if (i !== -1) {
  const base = slugs[i + 1];
  if (!base) { console.error('--mudadas-desde precisa de um ref (ex: origin/main)'); process.exit(1); }
  const diff = execSync(`git diff --name-only ${base}...HEAD -- ${RAIZ}`, { encoding: 'utf8' });
  slugs = [...new Set(
    diff.split('\n').filter(Boolean)
      .map((f) => f.replace(`${RAIZ}/`, '').split('/')[0])
      .filter(Boolean),
  )];
}

if (slugs.length === 0) {
  console.log('nenhuma edge function do Externo mudou — nada a fazer');
  process.exit(0);
}

const headers = { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' };
const base = `https://api.supabase.com/v1/projects/${REF}/functions`;
let falhou = false;

for (const slug of slugs) {
  const arquivo = `${RAIZ}/${slug}/index.ts`;
  if (!existsSync(arquivo)) { console.error(`  ${slug}: ${arquivo} não existe`); falhou = true; continue; }

  const codigo = readFileSync(arquivo, 'utf8');

  const atual = await fetch(`${base}/${slug}/body`, { headers: { Authorization: `Bearer ${PAT}` } });
  if (atual.ok) {
    mkdirSync('.deploy-backup', { recursive: true });
    writeFileSync(`.deploy-backup/${slug}.ts`, await atual.text());
    console.log(`  ${slug}: backup do que está no ar em .deploy-backup/${slug}.ts`);
  } else {
    console.log(`  ${slug}: sem backup (função ainda não existe no projeto)`);
  }

  // `verify_jwt: false` é a config atual dessas funções: quem chama é o pg_cron
  // do Externo com a anon key. Mudar isso aqui derrubaria o cron em silêncio.
  let r = await fetch(base, {
    method: 'POST', headers,
    body: JSON.stringify({ slug, name: slug, verify_jwt: false, body: codigo }),
  });
  if (r.status === 409 || r.status === 400) {
    r = await fetch(`${base}/${slug}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ verify_jwt: false, body: codigo }),
    });
  }
  if (!r.ok) { console.error(`  ${slug}: FALHOU ${r.status} ${await r.text()}`); falhou = true; }
  else console.log(`  ${slug}: deployado`);
}

process.exit(falhou ? 1 : 0);
