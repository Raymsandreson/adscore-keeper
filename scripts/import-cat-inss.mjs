#!/usr/bin/env node
/**
 * Importa os extratos de dados abertos de CAT do INSS/Dataprev para
 * public.cat_inss_registros no Supabase Externo.
 *
 * Formato de entrada: ZIP do portal contendo D.SDA.PDA.005.CAT.AAAAMM.{csv,json,xml}.
 * Lê SEMPRE o CSV: o JSON e o XML repetem as chaves "CBO", "CID-10",
 * "CNAE2.0 Empregador" e "Data Acidente", entao qualquer parser de JSON descarta
 * o codigo e mantem so a descricao truncada. O CSV e posicional e preserva os dois.
 *
 * Uso:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-cat-inss.mjs ~/Downloads/CAT.*.ZIP
 *   node scripts/import-cat-inss.mjs --dry-run ~/Downloads/CAT.JAN25.ZIP
 *
 * --dry-run    normaliza, valida e imprime as estatisticas sem escrever no banco.
 * --sem-filtro carrega tambem as CATs emitidas fora da competencia do arquivo.
 *              LEIA a nota de sobreposicao abaixo antes de usar.
 *
 * A carga e idempotente: a unique (arquivo_origem, linha_num) + ON CONFLICT DO
 * NOTHING deixa reimportar o mesmo arquivo sem duplicar.
 *
 * SOBREPOSICAO ENTRE ARQUIVOS — por que existe o filtro de competencia:
 *   A competencia de um arquivo e a data de EMISSAO da CAT, nao a do acidente.
 *   Medido em 202507: emissao 63.785 em jul + 2.743 em ago, contra acidentes
 *   espalhados por 5 meses (jul 53.646, jun 10.234, mai 1.168, abr 435, mar 340).
 *   E CAT.JUN.25.ZIP nao e junho: traz 214.745 linhas cobrindo jun (66.737),
 *   jul (75.123), ago (72.775) e set (110) — sobrepoe CAT.JUL.25 e CAT.AGO.25
 *   inteiros. Como a origem nao da identificador da CAT, nao ha como deduplicar
 *   depois: carregar os tres sem filtro duplicaria julho e agosto.
 *   Por isso cada arquivo contribui SO com a sua propria competencia de emissao.
 *
 *   Efeito colateral conhecido: para julho, CAT.JUN.25 traz 75.123 registros e
 *   CAT.JUL.25 traz 63.785 — o arquivo do proprio mes foi extraido antes da
 *   consolidacao. A regra acima usa o do mes (63.785), que e o menor. Para ficar
 *   com a versao mais completa, apagar a competencia e recarregar so o JUN.25
 *   com --sem-filtro.
 *
 * QUALIDADE POR COMPETENCIA, medida em 07/08/2026:
 *   202501-202505 : recortes PARCIAIS (7k a 20k/mes contra 53k-82k do padrao)
 *   202511 (205) e 202512 (126): praticamente vazios na origem. 202512 ainda tem
 *                   perfil anomalo — Doenca e a maioria (59 de 126), com CID de
 *                   doenca ocupacional (F41.1, Z73.0, G56.0). Nao usar para serie
 *                   historica sem antes rebaixar esses dois meses.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

const SUPABASE_URL = 'https://kmedldlepwiityjsdahz.supabase.co';
const TABLE = 'cat_inss_registros';
const BATCH = 500;

// Colunas do CSV, por posicao. O cabecalho repete nomes, entao indice e a unica
// referencia confiavel.
const COL = {
  agente: 0,
  dataAcidente: 1,
  cboCod: 2,
  cboDesc: 3,
  cidCod: 4,
  cidDesc: 5,
  cnaeCod: 6,
  cnaeDesc: 7,
  emitente: 8,
  especie: 9,
  filiacao: 10,
  obito: 11,
  municEmpr: 12,
  natureza: 13,
  origem: 14,
  parteCorpo: 15,
  sexo: 16,
  tipoAcidente: 17,
  // 18 = "UF  Munic.  Acidente" -> DESCARTADA de proposito, ver README/migration.
  ufEmpregador: 19,
  dataAfastamento: 20,
  dataDespacho: 21,
  // 22 = "Data Acidente" repetida, identica a 1 (verificado 7276/7276 em 202501).
  dataNascimento: 23,
  dataEmissao: 24,
  tipoEmpregador: 25,
  cnpj: 26,
};

/**
 * Sentinelas de ausencia que a origem escreve como texto. Comparados em minusculo
 * porque a caixa varia entre competencias: janeiro manda "{ñ class}" e os arquivos
 * de 202506+ mandam "{ñ Class}" — a primeira carga (619.529 linhas) deixou passar
 * 170 municipios por causa disso.
 *
 * "Zerado" (UF) e "Ignorado" (municipio) so aparecem a partir de 202506 e sempre
 * junto do IBGE "000000": 19.629 linhas com a tripla completa. Sem normalizar,
 * "Zerado" entra num group by de UF como se fosse a 7a maior do pais.
 */
const NULOS = new Set([
  '',
  '{ñ class}',
  '{n class}',
  'não informado',
  'nao informado',
  '00/00/0000',
  'zerado',
  'ignorado',
]);

const txt = (v) => {
  const s = (v ?? '').trim();
  return !s || NULOS.has(s.toLowerCase()) ? null : s;
};

/** Codigo numerico em que so zeros significa "sem classificacao": "0000", "000000". */
const codigo = (v) => {
  const s = txt(v);
  return !s || /^0+$/.test(s) ? null : s;
};

/**
 * O campo de codigo do CID tem largura fixa 6 e vem preenchido a direita.
 * Ate 202506 o preenchimento era espaco ("S610  "); em 202507 a origem passou a
 * serializar o subcampo nulo como a string "NULL", que o truncamento em 6 chars
 * deixou como sufixo: "S610NU", "S61NUL" — 66.528/66.528 do arquivo de julho.
 * CID-10 e sempre letra + 2 ou 3 digitos, e nenhum codigo valido termina em letra,
 * entao extrair o prefixo valido descarta o lixo sem risco de cortar dado bom.
 */
const cid = (v) => {
  const s = txt(v)?.toUpperCase();
  if (!s) return null;
  const m = /^([A-Z]\d{2,3})/.exec(s);
  return m ? m[1] : null;
};

/** CNAE "0000" e ausencia de classificacao, nao um setor. Aparece a partir de 202506. */
const cnae = codigo;

/** "01/01/2025" -> "2025-01-01"; "00/00/0000" e datas invalidas -> null */
const data = (v) => {
  const s = (v ?? '').trim();
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const [, d, mo, y] = m;
  if (d === '00' || mo === '00' || y === '0000') return null;
  const iso = `${y}-${mo}-${d}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.getUTCDate() !== Number(d)) return null;
  return iso;
};

const bool = (v) => {
  const s = (v ?? '').trim().toLowerCase();
  if (s === 'sim') return true;
  if (s === 'não' || s === 'nao') return false;
  return null;
};

/**
 * "316860-Teófilo Otoni" -> ["316860", "Teófilo Otoni"]
 * "000000-Ignorado"      -> [null, null]
 */
const splitCodigo = (v) => {
  const s = txt(v);
  if (!s) return [null, null];
  const i = s.indexOf('-');
  if (i < 0) return [null, txt(s)];
  return [codigo(s.slice(0, i)), txt(s.slice(i + 1))];
};

/**
 * A descricao vem prefixada pelo proprio codigo, em formatos diferentes por campo:
 *   CBO   "322205-Tec. de Enfer"  -> "Tec. de Enfer"
 *   CID   "S61.0 Ferim de Dedos"  -> "Ferim de Dedos"
 * Tudo truncado em 20 caracteres na origem; a descricao integra sai do join com
 * as tabelas de referencia pelo codigo.
 */
const descSemCodigo = (v, codigo) => {
  const s = txt(v);
  if (!s) return null;
  if (!codigo) return s;
  const semPontos = codigo.replace(/\./g, '');
  for (const pref of [codigo, semPontos]) {
    if (s.startsWith(pref)) return s.slice(pref.length).replace(/^[-\s.]+/, '').trim() || null;
  }
  // CID vem como "S61.0 ..." e o codigo como "S610": compara sem pontuacao.
  const alvo = s.replace(/[.\s]/g, '');
  if (alvo.startsWith(semPontos)) {
    const corte = s.search(/\s/);
    if (corte > 0) return s.slice(corte).trim() || null;
  }
  return s;
};

/** D.SDA.PDA.005.CAT.202501.csv -> "2025-01-01" */
const competenciaDoNome = (nome) => {
  const m = /\.(\d{4})(\d{2})\./.exec(nome);
  if (!m) return null;
  return `${m[1]}-${m[2]}-01`;
};

function lerCsvDoZip(caminho) {
  if (/\.csv$/i.test(caminho)) {
    return { nome: basename(caminho), buf: readFileSync(caminho) };
  }
  const lista = execFileSync('unzip', ['-Z1', caminho], { encoding: 'utf8' })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const csv = lista.find((n) => /\.csv$/i.test(n));
  if (!csv) throw new Error(`${basename(caminho)}: nenhum .csv dentro do zip (achei: ${lista.join(', ')})`);
  const buf = execFileSync('unzip', ['-p', caminho, csv], { maxBuffer: 256 * 1024 * 1024 });
  return { nome: csv, buf };
}

/** CSV do INSS: latin-1, CRLF, delimitador ';', sem aspas. */
function parseCsv(buf) {
  const texto = new TextDecoder('latin1').decode(buf);
  return texto
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => l.split(';'));
}

function normalizar(caminho, { semFiltro = false } = {}) {
  const { nome, buf } = lerCsvDoZip(caminho);
  const linhas = parseCsv(buf);
  if (linhas.length < 2) throw new Error(`${nome}: arquivo sem linhas de dados`);

  const cabecalho = linhas[0];
  if (cabecalho.length !== 27) {
    throw new Error(
      `${nome}: esperava 27 colunas, achei ${cabecalho.length}. Layout mudou — confira antes de importar.`,
    );
  }

  const competencia = competenciaDoNome(nome);
  if (!competencia) throw new Error(`${nome}: nao consegui extrair a competencia AAAAMM do nome do arquivo`);

  const registros = [];
  const avisos = { semCbo: 0, semCid: 0, semData: 0, semEmissao: 0 };
  // Descartados por competencia: ver nota sobre sobreposicao no final do arquivo.
  const foraDaCompetencia = new Map();

  for (let i = 1; i < linhas.length; i++) {
    const r = linhas[i];
    if (r.length < 27) continue;

    const cboCod = codigo(r[COL.cboCod]);
    const cidCod = cid(r[COL.cidCod]);
    const cnaeCod = cnae(r[COL.cnaeCod]);
    const [ibge, municipio] = splitCodigo(r[COL.municEmpr]);
    const dataAcidente = data(r[COL.dataAcidente]);
    const dataEmissao = data(r[COL.dataEmissao]);

    // A competencia do arquivo e a da EMISSAO da CAT, nao a do acidente:
    // em 202507, emissao 63.785 em jul + 2.743 em ago, contra acidentes
    // espalhados por 5 meses. Sem esse filtro, CAT.JUN.25.ZIP (que traz
    // jun+jul+ago) duplicaria julho e agosto inteiros contra os arquivos deles.
    const mes = competencia.slice(0, 7);
    if (!dataEmissao) {
      avisos.semEmissao++;
    } else if (!dataEmissao.startsWith(mes)) {
      const k = dataEmissao.slice(0, 7);
      foraDaCompetencia.set(k, (foraDaCompetencia.get(k) ?? 0) + 1);
      if (!semFiltro) continue;
    }

    if (!cboCod) avisos.semCbo++;
    if (!cidCod) avisos.semCid++;
    if (!dataAcidente) avisos.semData++;

    registros.push({
      competencia,
      arquivo_origem: nome,
      linha_num: i,
      data_acidente: dataAcidente,
      data_emissao_cat: dataEmissao,
      data_nascimento: data(r[COL.dataNascimento]),
      data_afastamento: data(r[COL.dataAfastamento]),
      data_despacho_beneficio: data(r[COL.dataDespacho]),
      agente_causador: txt(r[COL.agente]),
      natureza_lesao: txt(r[COL.natureza]),
      parte_corpo_atingida: txt(r[COL.parteCorpo]),
      tipo_acidente: txt(r[COL.tipoAcidente]),
      indica_obito: bool(r[COL.obito]),
      sexo: txt(r[COL.sexo]),
      cbo_codigo: cboCod,
      cbo_descricao: descSemCodigo(r[COL.cboDesc], cboCod),
      cid_codigo: cidCod,
      cid_descricao: descSemCodigo(r[COL.cidDesc], cidCod),
      cnae_codigo: cnaeCod,
      // preserva a descricao mesmo quando o codigo veio "0000"

      cnae_descricao: descSemCodigo(r[COL.cnaeDesc], cnaeCod),
      municipio_empregador_ibge: ibge,
      municipio_empregador_nome: municipio,
      uf_empregador: txt(r[COL.ufEmpregador]),
      cnpj_empregador: txt(r[COL.cnpj]),
      tipo_empregador: txt(r[COL.tipoEmpregador]),
      emitente_cat: txt(r[COL.emitente]),
      origem_cadastramento: txt(r[COL.origem]),
      filiacao_segurado: txt(r[COL.filiacao]),
      especie_beneficio: txt(r[COL.especie]),
    });
  }

  return { nome, competencia, registros, avisos, foraDaCompetencia, totalLinhas: linhas.length - 1 };
}

function estatisticas(registros) {
  const conta = (fn) => {
    const m = new Map();
    for (const r of registros) {
      const k = fn(r);
      if (k == null) continue;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const top = (pares, n = 5) => pares.slice(0, n).map(([k, v]) => `${k}=${v}`).join(', ');
  return [
    `  tipo acidente : ${top(conta((r) => r.tipo_acidente))}`,
    `  obitos        : ${registros.filter((r) => r.indica_obito).length}`,
    `  UF empregador : ${top(conta((r) => r.uf_empregador))}`,
    `  top CNAE      : ${top(conta((r) => r.cnae_codigo))}`,
    `  top CID       : ${top(conta((r) => r.cid_codigo))}`,
    `  CNPJs unicos  : ${new Set(registros.map((r) => r.cnpj_empregador)).size}`,
  ].join('\n');
}

/**
 * A tabela so tem policy de SELECT, entao a carga depende de bypass de RLS.
 * Sem esta checagem, uma chave errada so falha no primeiro lote, com
 * 401 / 42501 "new row violates row-level security policy" — mensagem que
 * parece bug de policy e nao chave trocada. Falhar antes, dizendo o motivo.
 */
function conferirChave(chave) {
  if (chave.startsWith('sbp_')) {
    throw new Error(
      'essa e um Personal Access Token (sbp_), da Management API — o PostgREST nao aceita.\n' +
        '       Use a service_role do projeto em Project Settings > API.',
    );
  }
  // Chave nova do Supabase: sb_secret_ equivale a service_role, sb_publishable_ nao.
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
  if (payload.ref && payload.ref !== 'kmedldlepwiityjsdahz') {
    throw new Error(`essa chave e do projeto "${payload.ref}", nao do Externo (kmedldlepwiityjsdahz).`);
  }
}

async function enviar(registros, chave) {
  let inseridos = 0;
  for (let i = 0; i < registros.length; i += BATCH) {
    const lote = registros.slice(i, i + BATCH);
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?on_conflict=arquivo_origem,linha_num`, {
      method: 'POST',
      headers: {
        apikey: chave,
        Authorization: `Bearer ${chave}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify(lote),
    });
    if (!resp.ok) {
      throw new Error(`lote ${i / BATCH + 1} falhou: HTTP ${resp.status} ${await resp.text()}`);
    }
    inseridos += lote.length;
    process.stdout.write(`\r  enviados ${inseridos}/${registros.length}`);
  }
  process.stdout.write('\n');
  return inseridos;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const semFiltro = args.includes('--sem-filtro');
  const arquivos = args.filter((a) => !a.startsWith('--'));

  if (arquivos.length === 0) {
    console.error('uso: node scripts/import-cat-inss.mjs [--dry-run] <arquivo.zip|csv> [...]');
    process.exit(1);
  }

  const chave = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!dryRun) {
    if (!chave) {
      console.error('erro: defina SUPABASE_SERVICE_ROLE_KEY (ou rode com --dry-run)');
      process.exit(1);
    }
    conferirChave(chave);
  }

  let total = 0;
  for (const arq of arquivos) {
    if (!existsSync(arq)) {
      console.error(`\n!! ${arq}: nao encontrado, pulando`);
      continue;
    }
    const { nome, competencia, registros, avisos, foraDaCompetencia, totalLinhas } = normalizar(arq, { semFiltro });
    console.log(`\n${basename(arq)} -> ${nome}`);
    console.log(`  competencia   : ${competencia}`);
    console.log(`  registros     : ${registros.length}${registros.length !== totalLinhas ? ` (de ${totalLinhas} no arquivo)` : ''}`);
    console.log(estatisticas(registros));
    if (foraDaCompetencia.size) {
      const det = [...foraDaCompetencia.entries()].sort().map(([k, v]) => `${k}=${v}`).join(', ');
      const total = [...foraDaCompetencia.values()].reduce((a, b) => a + b, 0);
      console.log(`  ${semFiltro ? 'INCLUIDOS' : 'descartados'} fora da competencia: ${total} (${det})`);
    }
    const alerta = Object.entries(avisos).filter(([, v]) => v > 0);
    if (alerta.length) console.log(`  campos vazios : ${alerta.map(([k, v]) => `${k}=${v}`).join(', ')}`);

    if (dryRun) {
      console.log('  [dry-run] nada foi escrito');
    } else {
      total += await enviar(registros, chave);
    }
  }
  if (!dryRun) console.log(`\nok: ${total} registros enviados (duplicatas ignoradas pelo on_conflict)`);
}

main().catch((e) => {
  console.error(`\nerro: ${e.message}`);
  process.exit(1);
});
