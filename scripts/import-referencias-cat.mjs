#!/usr/bin/env node
/**
 * Carrega as tabelas de referencia que destruncam cat_inss_registros:
 *
 *   ref_cid10           CID-10 do DATASUS (categorias + subcategorias)
 *   ref_cnae            classes da CNAE 2.0 do IBGE
 *   ref_municipio_ibge  municipios do IBGE
 *
 * A origem da CAT trunca toda descricao em 20 caracteres — "Atividades de atendi",
 * "Tec. de Enfer", "Ferim de Dedos". A descricao integra sai do join pelo codigo.
 * Ver a migration 20260807140000 para as chaves de join e a cobertura medida.
 *
 * Idempotente: usa upsert por chave primaria, entao rodar de novo atualiza em vez
 * de duplicar. Diferente do import-cat-inss.mjs, que ignora duplicatas — aqui a
 * fonte pode ser corrigida pelo orgao e queremos a versao nova.
 *
 * uso:
 *   SUPABASE_SERVICE_ROLE_KEY=<service_role> node scripts/import-referencias-cat.mjs
 *   node scripts/import-referencias-cat.mjs --dry-run
 *   node scripts/import-referencias-cat.mjs --only=cnae,municipio
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUPABASE_URL = 'https://kmedldlepwiityjsdahz.supabase.co';
const PROJECT_REF = 'kmedldlepwiityjsdahz';
const BATCH = 500;

const FONTES = {
  cid10: 'http://www2.datasus.gov.br/cid10/V2008/downloads/CID10CSV.zip',
  cnae: 'https://servicodados.ibge.gov.br/api/v2/cnae/classes',
  municipio: 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios',
};

async function baixar(url, binario = false) {
  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok) throw new Error(`${url} respondeu HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  return binario ? buf : buf.toString('utf8');
}

/**
 * CSV do DATASUS: latin-1, delimitador ";", sem aspas, uma coluna vazia no fim.
 * O cabecalho define a ordem; leio por nome para nao depender de posicao.
 */
function lerCsvDatasus(buf) {
  const texto = new TextDecoder('latin1').decode(buf);
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== '');
  const cab = linhas[0].split(';').map((c) => c.trim().toUpperCase());
  return linhas.slice(1).map((l) => {
    const campos = l.split(';');
    return Object.fromEntries(cab.map((c, i) => [c, (campos[i] ?? '').trim()]));
  });
}

async function montarCid10() {
  const zip = await baixar(FONTES.cid10, true);
  const dir = mkdtempSync(join(tmpdir(), 'cid10-'));
  try {
    const caminho = join(dir, 'cid10.zip');
    writeFileSync(caminho, zip);
    const extrair = (nome) => {
      execFileSync('unzip', ['-o', '-q', caminho, nome, '-d', dir]);
      return lerCsvDatasus(readFileSync(join(dir, nome)));
    };

    const categorias = extrair('CID-10-CATEGORIAS.CSV');
    const subcategorias = extrair('CID-10-SUBCATEGORIAS.CSV');

    const porCodigo = new Map();
    for (const r of categorias) {
      const codigo = (r.CAT ?? '').toUpperCase();
      if (!codigo || !r.DESCRICAO) continue;
      porCodigo.set(codigo, {
        codigo,
        nivel: 'categoria',
        categoria: codigo,
        descricao: r.DESCRICAO,
        causa_obito: null,
        restr_sexo: null,
      });
    }

    // 263 das 12.451 "subcategorias" tem codigo de 3 chars: sao categorias sem
    // subdivisao (A09, A33, A34...), que o DATASUS repete nos dois arquivos com
    // descricao identica — verificado, 0 divergencias. Deduplicar mantendo a
    // entrada de categoria e so aproveitando os metadados que so o arquivo de
    // subcategorias traz. Sem isso o upsert por PK perderia linhas em silencio.
    let complementadas = 0;
    for (const r of subcategorias) {
      const codigo = (r.SUBCAT ?? '').toUpperCase();
      if (!codigo || !r.DESCRICAO) continue;
      // No layout do DATASUS a coluna marca com "N" o que NAO pode ser causa basica.
      const causaObito = r.CAUSAOBITO ? r.CAUSAOBITO.toUpperCase() === 'N' : null;
      const restrSexo = r.RESTRSEXO || null;

      const existente = porCodigo.get(codigo);
      if (existente) {
        existente.causa_obito = causaObito;
        existente.restr_sexo = restrSexo;
        complementadas++;
        continue;
      }
      porCodigo.set(codigo, {
        codigo,
        nivel: 'subcategoria',
        categoria: codigo.slice(0, 3),
        descricao: r.DESCRICAO,
        causa_obito: causaObito,
        restr_sexo: restrSexo,
      });
    }
    console.log(`  CID-10: ${categorias.length} categorias + ${subcategorias.length} subcategorias, ${complementadas} sobrepostas`);
    return [...porCodigo.values()];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function montarCnae() {
  const classes = JSON.parse(await baixar(FONTES.cnae));
  return classes.map((c) => {
    const grupo = c.grupo ?? {};
    const divisao = grupo.divisao ?? {};
    const secao = divisao.secao ?? {};
    return {
      // A CAT usa os 4 primeiros digitos, sem o verificador. Verificado unico.
      codigo: c.id.slice(0, 4),
      codigo_classe: c.id,
      descricao: c.descricao,
      grupo_codigo: grupo.id ?? null,
      grupo_descricao: grupo.descricao ?? null,
      divisao_codigo: divisao.id ?? null,
      divisao_descricao: divisao.descricao ?? null,
      secao_codigo: secao.id ?? null,
      secao_descricao: secao.descricao ?? null,
    };
  });
}

async function montarMunicipios() {
  const municipios = JSON.parse(await baixar(FONTES.municipio));
  return municipios.map((m) => {
    const uf = m.microrregiao?.mesorregiao?.UF ?? m['regiao-imediata']?.['regiao-intermediaria']?.UF ?? {};
    const regiao = uf.regiao ?? {};
    const id = String(m.id);
    return {
      // A CAT usa os 6 primeiros digitos, sem o verificador. Verificado unico.
      codigo: id.slice(0, 6),
      codigo_ibge: id,
      nome: m.nome,
      uf_sigla: uf.sigla,
      uf_nome: uf.nome,
      regiao_sigla: regiao.sigla,
      regiao_nome: regiao.nome,
    };
  });
}

/**
 * Mesma checagem do import-cat-inss.mjs: as tabelas so tem policy de SELECT,
 * entao a carga depende de bypass de RLS. Sem isto, uma chave errada so falha no
 * primeiro lote com 401 / 42501, que parece bug de policy e nao chave trocada.
 */
function conferirChave(chave) {
  if (chave.startsWith('sbp_')) {
    throw new Error(
      'essa e um Personal Access Token (sbp_), da Management API — o PostgREST nao aceita.\n' +
        '       Use a service_role do projeto em Project Settings > API.',
    );
  }
  if (chave.startsWith('sb_publishable_')) {
    throw new Error('essa e a chave publishable, que respeita RLS. Use a secret (sb_secret_...) ou a service_role.');
  }
  if (chave.startsWith('sb_secret_')) return;

  const partes = chave.split('.');
  if (partes.length !== 3) {
    throw new Error('formato de chave nao reconhecido. Esperado JWT (eyJ...) ou sb_secret_...');
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('nao consegui decodificar o payload da chave — confira se ela veio completa.');
  }
  if (payload.role !== 'service_role') {
    throw new Error(
      `essa chave tem role "${payload.role}", que respeita RLS e nao consegue inserir.\n` +
        '       Pegue a service_role em Project Settings > API (nao a anon/publishable).',
    );
  }
  if (payload.ref && payload.ref !== PROJECT_REF) {
    throw new Error(`essa chave e do projeto "${payload.ref}", nao do Externo (${PROJECT_REF}).`);
  }
}

async function enviar(tabela, linhas, chave) {
  let enviados = 0;
  for (let i = 0; i < linhas.length; i += BATCH) {
    const lote = linhas.slice(i, i + BATCH);
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?on_conflict=codigo`, {
      method: 'POST',
      headers: {
        apikey: chave,
        Authorization: `Bearer ${chave}`,
        'Content-Type': 'application/json',
        // merge-duplicates: a fonte oficial pode ser corrigida, queremos a nova.
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(lote),
    });
    if (!resp.ok) {
      throw new Error(`${tabela}: lote ${i / BATCH + 1} falhou: HTTP ${resp.status} ${await resp.text()}`);
    }
    enviados += lote.length;
    process.stdout.write(`\r  ${tabela}: ${enviados}/${linhas.length}`);
  }
  process.stdout.write('\n');
  return enviados;
}

const ALVOS = [
  { chave: 'cid10', tabela: 'ref_cid10', montar: montarCid10 },
  { chave: 'cnae', tabela: 'ref_cnae', montar: montarCnae },
  { chave: 'municipio', tabela: 'ref_municipio_ibge', montar: montarMunicipios },
];

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',').map((s) => s.trim());
  const alvos = only ? ALVOS.filter((a) => only.includes(a.chave)) : ALVOS;

  if (alvos.length === 0) {
    console.error(`erro: --only aceita ${ALVOS.map((a) => a.chave).join(', ')}`);
    process.exit(1);
  }

  const chave = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!dryRun) {
    if (!chave) {
      console.error('erro: defina SUPABASE_SERVICE_ROLE_KEY (ou rode com --dry-run)');
      process.exit(1);
    }
    try {
      conferirChave(chave);
    } catch (e) {
      console.error(`erro: ${e.message}`);
      process.exit(1);
    }
  }

  for (const alvo of alvos) {
    const linhas = await alvo.montar();
    console.log(`${alvo.tabela}: ${linhas.length} linhas`);
    const amostra = linhas[0];
    console.log(`  amostra: ${JSON.stringify(amostra).slice(0, 150)}`);

    const codigos = new Set(linhas.map((l) => l.codigo));
    if (codigos.size !== linhas.length) {
      throw new Error(`${alvo.tabela}: ${linhas.length - codigos.size} codigos duplicados — o upsert perderia linhas`);
    }

    if (dryRun) {
      console.log('  [dry-run] nada foi escrito');
      continue;
    }
    await enviar(alvo.tabela, linhas, chave);
  }

  console.log(dryRun ? '\nok: dry-run concluido' : '\nok: referencias carregadas');
}

main().catch((e) => {
  console.error(`\nerro: ${e.message}`);
  process.exit(1);
});
