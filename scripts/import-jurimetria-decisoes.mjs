#!/usr/bin/env node
/**
 * Importa as linhas de DECISÃO da aba "Lançamentos" (planilha
 * Jurimetria/indenização) para `jm_decisoes` + `jm_valores` no Supabase Externo.
 *
 * Uso:
 *   node scripts/import-jurimetria-decisoes.mjs --dry-run Lancamentos.csv
 *   node scripts/import-jurimetria-decisoes.mjs --sql saida.sql Lancamentos.csv
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-jurimetria-decisoes.mjs Lancamentos.csv
 *
 *   --dry-run   (padrão) compara com o banco e imprime o que mudaria.
 *   --sql ARQ   escreve o SQL em vez de chamar a API — para aplicar por
 *               migration ou MCP quando a service key não está à mão.
 *
 * Como exportar: Jurimetria/indenização -> aba Lançamentos -> Arquivo ->
 * Fazer download -> CSV. O cabeçalho está na LINHA 3; as duas primeiras são
 * painel de totais.
 *
 * O QUE ELE LÊ E O QUE IGNORA
 *   Só as linhas SEM `N° DA PARCELA` (1.955 de 2.977 em 03/09/2026). As com
 *   parcela são fluxo de acordo e vão para `jm_pagamentos` pelo outro script,
 *   `import-jurimetria-parcelas.mjs`. Ver o cabeçalho de
 *   jurimetria-lancamentos-comum.mjs para o porquê.
 *
 *   Ignora também os rótulos que não são decisão de mérito — "SEM DECISÃO"
 *   (612 linhas), ARQUIVAMENTO, SUSPENSO, CANCELADO, INVIÁVEL. Nesses o valor
 *   da planilha é PROJEÇÃO, e projeção não é julgamento: virar decisão faria a
 *   escada do honorário liberar tranche sobre um número que ninguém decidiu.
 *
 * NUNCA APAGA. Decisão que está no banco e sumiu da planilha fica; sai no
 * relatório. O mesmo para as `HOMOLOGAÇÃO DE ACORDO` que a carga de 08/07/2026
 * criou a partir de linhas de parcela (64 repetidas, 52 casando com data de
 * pagamento) — o script aponta, o Raym decide.
 *
 * CHAVE da decisão: (processo, tipo_evento, instância, data). É o que a torna a
 * MESMA decisão. `dec_id` novo só é gerado para o que não existe, continuando a
 * sequência Dnnnn.
 * CHAVE do valor: (dec_id, parte_id) — o UNIQUE que a tabela já tem.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import {
  lerCsv, valor, percentual, texto, data, cnj, nomeChave, chaveParte,
  classificarDecisao, rotulosDesconhecidos, separar, chaveDecisao, sqlTexto, sqlNum,
} from './jurimetria-lancamentos-comum.mjs';

const SUPABASE_URL = 'https://kmedldlepwiityjsdahz.supabase.co';

/** Colunas da aba, por nome de cabeçalho sem acento e em minúscula. */
const COLUNAS = {
  cliente: ['cliente'],
  processo: ['autos processuais'],
  caso: ['caso'],
  decisao: ['decisao'],
  data_decisao: ['data da decisao'],
  termo_inicial_jcm: ['termo inicial dos jcm'],
  dano_moral: ['dano moral'],
  dano_estetico: ['dano estetico'],
  base_calculo: ['base de calculo(dano material)'],
  meses_pensionamento: ['tempo de pensionamento'],
  hs_pct: ['hs(%)'],
  titulo_judicial: ['titulo judicial'],
  orgao: ['orgao julgador'],
  relator: ['relator/juiz'],
  link: ['link da decisao/noticia'],
  n_parcela: ['no da parcela', 'n da parcela'],
  data_parcela: ['data da parcela'],
};

const semAcento = (v) =>
  String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function mapearColunas(cabecalho) {
  const porNome = new Map();
  cabecalho.forEach((nome, i) => {
    const n = semAcento(nome).replace(/º|°/g, 'o');
    if (n && !porNome.has(n)) porNome.set(n, i);
  });
  const indice = {};
  const faltando = [];
  for (const [campo, apelidos] of Object.entries(COLUNAS)) {
    const achou = apelidos.map((a) => porNome.get(a)).find((i) => i != null);
    if (achou == null) faltando.push(campo); else indice[campo] = achou;
  }
  return { indice, faltando };
}

export function montarLinha(campos, indice) {
  const pega = (c) => (indice[c] == null ? null : campos[indice[c]]);
  return {
    cliente: texto(pega('cliente')),
    processo: cnj(pega('processo')),
    decisao: texto(pega('decisao')),
    data_decisao: data(pega('data_decisao')),
    termo_inicial_jcm: data(pega('termo_inicial_jcm')),
    dano_moral: valor(pega('dano_moral')),
    dano_estetico: valor(pega('dano_estetico')),
    base_calculo: valor(pega('base_calculo')),
    meses_pensionamento: valor(pega('meses_pensionamento')),
    meses_pensionamento_raw: texto(pega('meses_pensionamento')),
    hs_pct: percentual(pega('hs_pct')),
    titulo_judicial: texto(pega('titulo_judicial')),
    orgao: texto(pega('orgao')),
    relator: texto(pega('relator')),
    link: texto(pega('link')),
    n_parcela: texto(pega('n_parcela')),
    data_parcela: data(pega('data_parcela')),
  };
}

/** Dnnnn seguinte ao maior já usado. */
export function proximoDecId(existentes) {
  let maior = 0;
  for (const id of existentes) {
    const m = String(id).match(/^D(\d+)$/);
    if (m) maior = Math.max(maior, Number(m[1]));
  }
  let n = maior;
  return () => { n += 1; return `D${String(n).padStart(4, '0')}`; };
}

/**
 * Casa a planilha com o banco e diz o que fazer. Puro: é o que o teste exercita.
 *
 * `decisoesBanco`: [{ dec_id, processo_cnj, tipo_evento, instancia, data_decisao }]
 * `partesBanco`  : [{ parte_id, processo_cnj, cliente }]
 * `valoresBanco` : [{ dec_id, parte_id }]
 */
export function planejar(linhas, decisoesBanco, partesBanco, valoresBanco = []) {
  const porChaveDecisao = new Map();
  for (const d of decisoesBanco) {
    porChaveDecisao.set(chaveDecisao(d.processo_cnj, d.tipo_evento, d.instancia, d.data_decisao), d.dec_id);
  }
  const porChaveParte = new Map();
  for (const p of partesBanco) porChaveParte.set(chaveParte(p.processo_cnj, p.cliente), p.parte_id);
  const valorExistente = new Set(valoresBanco.map((v) => `${v.dec_id}|${v.parte_id}`));

  const gerarId = proximoDecId(decisoesBanco.map((d) => d.dec_id));
  const decisoesNovas = new Map();   // chave -> registro
  const valores = [];                // linhas de jm_valores a gravar
  const semParte = [];               // parte da planilha que não existe no banco
  const semData = [];                // decisão de mérito sem data: não entra
  const ignoradas = [];              // rótulo que não é decisão

  for (const l of linhas) {
    const par = classificarDecisao(l.decisao);
    if (!par) { ignoradas.push(l); continue; }
    if (!l.data_decisao) { semData.push(l); continue; }

    const [tipo, instancia] = par;
    const chave = chaveDecisao(l.processo, tipo, instancia, l.data_decisao);
    let decId = porChaveDecisao.get(chave);
    if (!decId) {
      const nova = decisoesNovas.get(chave);
      if (nova) decId = nova.dec_id;
      else {
        decId = gerarId();
        decisoesNovas.set(chave, {
          dec_id: decId,
          processo_cnj: l.processo,
          data_decisao: l.data_decisao,
          tipo_evento: tipo,
          instancia,
          abrangencia: 'TOTAL',
          rotulo_original: l.decisao,
          termo_inicial_jcm: l.termo_inicial_jcm,
          titulo: l.titulo_judicial,
          orgao: l.orgao,
          relator: l.relator,
          link: l.link,
        });
      }
    }

    const parteId = porChaveParte.get(chaveParte(l.processo, l.cliente));
    if (!parteId) { semParte.push(l); continue; }
    valores.push({
      dec_id: decId,
      parte_id: parteId,
      processo_cnj: l.processo,
      cliente: l.cliente,
      dano_moral: l.dano_moral,
      dano_estetico: l.dano_estetico,
      base_calculo: l.base_calculo,
      meses_pensionamento: l.meses_pensionamento,
      meses_pensionamento_raw: l.meses_pensionamento_raw,
      hs_pct: l.hs_pct,
      novo: !valorExistente.has(`${decId}|${parteId}`),
    });
  }

  // Decisões do banco que a planilha não tem mais. Nunca apagadas aqui.
  const vistas = new Set();
  for (const l of linhas) {
    const par = classificarDecisao(l.decisao);
    if (par && l.data_decisao) vistas.add(chaveDecisao(l.processo, par[0], par[1], l.data_decisao));
  }
  const orfas = decisoesBanco.filter(
    (d) => !vistas.has(chaveDecisao(d.processo_cnj, d.tipo_evento, d.instancia, d.data_decisao)),
  );

  return {
    decisoesNovas: [...decisoesNovas.values()],
    valores,
    valoresNovos: valores.filter((v) => v.novo),
    orfas,
    semParte,
    semData,
    ignoradas,
  };
}

const CAMPOS_DECISAO = ['dec_id', 'processo_cnj', 'data_decisao', 'tipo_evento', 'instancia',
  'abrangencia', 'rotulo_original', 'termo_inicial_jcm', 'titulo', 'orgao', 'relator', 'link'];
const CAMPOS_VALOR = ['dec_id', 'parte_id', 'processo_cnj', 'cliente', 'dano_moral',
  'dano_estetico', 'base_calculo', 'meses_pensionamento', 'meses_pensionamento_raw', 'hs_pct'];
const NUM_VALOR = new Set(['dano_moral', 'dano_estetico', 'base_calculo', 'meses_pensionamento', 'hs_pct']);

export function gerarSql(plano, lote = 300) {
  const partes = ['-- Gerado por scripts/import-jurimetria-decisoes.mjs', 'begin;'];
  const emLotes = (linhas, montar) => {
    for (let i = 0; i < linhas.length; i += lote) partes.push(montar(linhas.slice(i, i + lote)));
  };

  if (plano.decisoesNovas.length) {
    emLotes(plano.decisoesNovas, (bloco) =>
      `insert into public.jm_decisoes (${CAMPOS_DECISAO.join(',')}) values\n` +
      bloco.map((d) => '(' + CAMPOS_DECISAO.map((c) => sqlTexto(d[c])).join(',') + ')').join(',\n') +
      '\non conflict (dec_id) do nothing;');
  }
  if (plano.valores.length) {
    emLotes(plano.valores, (bloco) =>
      `insert into public.jm_valores (${CAMPOS_VALOR.join(',')}) values\n` +
      bloco.map((v) => '(' + CAMPOS_VALOR.map(
        (c) => (NUM_VALOR.has(c) ? sqlNum(v[c]) : sqlTexto(v[c]))).join(',') + ')').join(',\n') +
      '\non conflict (dec_id, parte_id) do update set ' +
      ['dano_moral', 'dano_estetico', 'base_calculo', 'meses_pensionamento',
       'meses_pensionamento_raw', 'hs_pct'].map((c) => `${c} = excluded.${c}`).join(', ') + ';');
  }
  partes.push('commit;');
  return partes.join('\n\n');
}

export function lerPlanilha(caminho) {
  const linhas = lerCsv(readFileSync(caminho, 'utf8'));
  // A aba tem duas linhas de painel antes do cabeçalho real.
  let cab = 0;
  for (let i = 0; i < Math.min(6, linhas.length); i++) {
    if (mapearColunas(linhas[i]).faltando.length === 0) { cab = i; break; }
  }
  const { indice, faltando } = mapearColunas(linhas[cab]);
  if (faltando.length) throw new Error(`colunas não encontradas: ${faltando.join(', ')}`);
  return linhas.slice(cab + 1).map((c) => montarLinha(c, indice)).filter((l) => l.processo && l.cliente);
}

async function buscarTudo(chave, tabela, campos) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?select=${campos}&limit=1000&offset=${de}`, {
      headers: { apikey: chave, Authorization: `Bearer ${chave}` },
    });
    if (!r.ok) throw new Error(`${tabela}: ${r.status} ${await r.text()}`);
    const p = await r.json();
    out.push(...p);
    if (p.length < 1000) return out;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const arquivo = args.find((a) => !a.startsWith('--') && a !== args[args.indexOf('--sql') + 1]);
  const saidaSql = args.includes('--sql') ? args[args.indexOf('--sql') + 1] : null;
  if (!arquivo || !existsSync(arquivo)) {
    console.error('uso: node scripts/import-jurimetria-decisoes.mjs [--dry-run|--sql ARQ] Lancamentos.csv');
    process.exit(1);
  }

  const todas = lerPlanilha(arquivo);
  const { decisoes, parcelas } = separar(todas);
  console.log(`planilha: ${todas.length} linhas -> ${decisoes.length} de decisão, ${parcelas.length} de parcela (ignoradas aqui)`);

  const desconhecidos = rotulosDesconhecidos(decisoes);
  if (desconhecidos.length) {
    console.log('\nROTULOS não mapeados (não viram decisão — confira antes de rodar):');
    for (const [r, n] of desconhecidos) console.log(`   ${n.toString().padStart(4)}  ${r}`);
  }

  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!chave) {
    console.error('\nsem SUPABASE_SERVICE_ROLE_KEY: não dá para comparar com o banco.');
    console.error('Rode com a chave, ou use --sql para gerar o SQL a partir de um dump local.');
    process.exit(1);
  }
  const [decisoesBanco, partesBanco, valoresBanco] = await Promise.all([
    buscarTudo(chave, 'jm_decisoes', 'dec_id,processo_cnj,tipo_evento,instancia,data_decisao'),
    buscarTudo(chave, 'jm_partes', 'parte_id,processo_cnj,cliente'),
    buscarTudo(chave, 'jm_valores', 'dec_id,parte_id'),
  ]);
  const plano = planejar(decisoes, decisoesBanco, partesBanco, valoresBanco);

  console.log(`\nbanco: ${decisoesBanco.length} decisões, ${valoresBanco.length} valores`);
  console.log(`decisões novas .......... ${plano.decisoesNovas.length}`);
  console.log(`valores a gravar ........ ${plano.valores.length} (${plano.valoresNovos.length} novos)`);
  console.log(`decisões órfãs no banco . ${plano.orfas.length}  (NÃO serão apagadas)`);
  console.log(`linhas sem parte no banco ${plano.semParte.length}`);
  console.log(`decisões sem data ....... ${plano.semData.length}  (não entram)`);
  console.log(`linhas ignoradas ........ ${plano.ignoradas.length}  (SEM DECISÃO e afins)`);

  if (saidaSql) {
    writeFileSync(saidaSql, gerarSql(plano));
    console.log(`\nSQL escrito em ${saidaSql}`);
    return;
  }
  console.log('\n--dry-run: nada foi escrito. Use --sql ARQ para gerar o SQL.');
}

if (process.argv[1] && process.argv[1].endsWith('import-jurimetria-decisoes.mjs')) {
  main().catch((e) => { console.error('erro:', e.message); process.exit(1); });
}
