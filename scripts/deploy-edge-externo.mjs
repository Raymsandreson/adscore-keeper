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

const auth = { Authorization: `Bearer ${PAT}` };
const base = `https://api.supabase.com/v1/projects/${REF}/functions`;
let falhou = false;

for (const slug of slugs) {
  const arquivo = `${RAIZ}/${slug}/index.ts`;
  if (!existsSync(arquivo)) { console.error(`  ${slug}: ${arquivo} não existe`); falhou = true; continue; }

  const codigo = readFileSync(arquivo, 'utf8');

  const atual = await fetch(`${base}/${slug}/body`, { headers: auth });
  if (atual.ok) {
    mkdirSync('.deploy-backup', { recursive: true });
    writeFileSync(`.deploy-backup/${slug}.ts`, await atual.text());
    console.log(`  ${slug}: backup do que está no ar em .deploy-backup/${slug}.ts`);
  } else {
    console.log(`  ${slug}: sem backup (função ainda não existe no projeto)`);
  }

  // O deploy NÃO decide autenticação — ele preserva a que a função já tem.
  //
  // Aqui ficava `verify_jwt: false` fixo, com o comentário de que essa era "a
  // config atual dessas funções". Não é: medido em 08/09/2026, `dom-rascunho`
  // está no ar com `verify_jwt: true`. Um deploy de rotina — mudar uma linha de
  // texto do rascunho — derrubaria a exigência de JWT dela sem ninguém pedir e
  // sem aparecer em lugar nenhum, porque a função continua respondendo igual.
  // Ficar aberta é a falha que não dá sintoma.
  //
  // Função nova (o POST) nasce com JWT exigido. Quem precisa de função aberta
  // abre de propósito, uma vez, e o deploy respeita a partir dali.
  const meta = await fetch(`${base}/${slug}`, { headers: auth });
  const verifyJwt = meta.ok ? ((await meta.json()).verify_jwt !== false) : true;
  console.log(`  ${slug}: verify_jwt preservado = ${verifyJwt}`);

  // MULTIPART, NÃO JSON — e a diferença derrubou o Dom (09/09/2026, 02:56)
  //
  // Aqui ficava `POST/PATCH` com `{ body: codigo }` em JSON. Isso grava o FONTE
  // CRU, sem resolver dependência nenhuma. Toda função daqui começa com
  // `import "jsr:@supabase/functions-js/edge-runtime.d.ts"`, e o runtime sobe
  // com `--no-remote`: ele não busca o JSR na hora do boot. Resultado medido,
  // nas duas funções, dois minutos depois do primeiro deploy que este script
  // conseguiu fazer:
  //
  //   worker boot error: failed to bootstrap runtime: failed to create the
  //   graph: JSR package manifest for '@supabase/functions-js' failed to load.
  //   A remote specifier was requested (...) but --no-remote is specified.
  //
  // e todo POST /dom-rascunho respondendo 503. O script nunca tinha rodado até
  // então — os 12 runs anteriores morriam na falta do secret — então este
  // caminho subiu para produção sem nunca ter sido exercido uma vez.
  //
  // `POST /functions/deploy?slug=` recebe multipart e empacota no servidor
  // (eszip), que é o que a CLI faz. Não se põe Content-Type na mão: o fetch
  // escreve o boundary.
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({
    name: slug,
    entrypoint_path: 'index.ts',
    verify_jwt: verifyJwt,
  })], { type: 'application/json' }));
  form.append('file', new File([codigo], 'index.ts', { type: 'application/typescript' }));

  const r = await fetch(
    `https://api.supabase.com/v1/projects/${REF}/functions/deploy?slug=${encodeURIComponent(slug)}`,
    { method: 'POST', headers: { Authorization: `Bearer ${PAT}` }, body: form },
  );
  if (!r.ok) { console.error(`  ${slug}: FALHOU ${r.status} ${await r.text()}`); falhou = true; }
  else console.log(`  ${slug}: deployado (bundle no servidor)`);
}

process.exit(falhou ? 1 : 0);
