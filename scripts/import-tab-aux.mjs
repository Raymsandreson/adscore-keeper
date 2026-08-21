#!/usr/bin/env node
/**
 * Importa a aba "Tab. Aux" da planilha Jurimetria/indenização para
 * public.jm_partes no Supabase Externo — condenação, cota do cliente e
 * honorário, POR PARTE.
 *
 * Uso:
 *   node scripts/import-tab-aux.mjs --dry-run ~/Downloads/TabAux.csv
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-tab-aux.mjs ~/Downloads/TabAux.csv
 *   node scripts/import-tab-aux.mjs --sql saida.sql ~/Downloads/TabAux.csv
 *
 *   --dry-run   compara com o banco e imprime o que mudaria, sem escrever.
 *   --sql ARQ   escreve o SQL em vez de chamar a API (para aplicar por migration
 *               ou MCP quando a service key não está à mão).
 *
 * Como exportar: Jurimetria/indenização -> aba Tab. Aux -> Arquivo -> Fazer
 * download -> CSV. A Tab. Aux é a PRIMEIRA aba, então o CSV sai com ela.
 *
 * O QUE ESTA ABA RESOLVE (18/08/2026): é a única fonte que separa o que é do
 * CLIENTE do que é do ESCRITÓRIO, por parte. No caso 10, cada uma das 7 partes:
 * condenação R$ 28.571,43 = cota R$ 20.000,00 + honorário contratual
 * R$ 8.571,43. Nada disso existia no banco — `jm_valores` tinha só o dano moral.
 *
 * NÃO CONFUNDIR COM A OUTRA PLANILHA. São duas, e respondem coisas diferentes:
 *   Tab. Aux (esta)     uma linha por PARTE   — quanto VALE   (estoque)
 *   Lançamentos         uma linha por PARCELA — quando ENTRA  (fluxo)
 * Os números não se somam. O importador da outra é import-lancamentos-planilha.
 *
 * CHAVE: (processo_cnj, cliente). A planilha não tem `parte_id`, então o
 * casamento é pelo nome da parte dentro do processo, normalizado (sem acento,
 * maiúscula, espaços colapsados) — a planilha e o banco divergem em acento e
 * espaço duplicado com frequência. Parte que não casa NÃO é inventada: fica no
 * relatório para conferir à mão.
 *
 * SÓ ATUALIZA colunas de valor. Nunca toca em `parte_id`, `cliente`,
 * `parentesco`, `cessao_*` nem `vendida` — esses são do banco, não da planilha.
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';

const SUPABASE_URL = 'https://kmedldlepwiityjsdahz.supabase.co';
const TABELA = 'jm_partes';

/** Colunas da Tab. Aux que interessam, por nome normalizado do cabeçalho. */
const COLUNAS = {
  cliente: ['parte'],
  processo: ['n° do processo', 'no do processo', 'n do processo'],
  caso: ['n° do caso', 'no do caso', 'n do caso'],
  status_pagamento: ['status pagamento'],
  fase_atual: ['fase atual'],
  condenacao_cjcm: ['total da condenacao cjcm'],
  cota_parte_cjcm: ['total parte cjcm'],
  cota_parte_vista_cjcm: ['total a vista parte cjcm'],
  hc_vista: ['honorarios contratuais a vista'],
  hc_parcelado: ['honorarios contratuais parcelado'],
  hs: ['honorarios sucumbenciais'],
};

/** O que o script escreve. Tudo que não está aqui é do banco e fica intocado. */
export const CAMPOS_VALOR = [
  'condenacao_cjcm', 'cota_parte_cjcm', 'cota_parte_vista_cjcm',
  'hc_vista', 'hc_parcelado', 'hs', 'status_pagamento', 'fase_atual',
];

const semAcento = (v) =>
  String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function lerCsv(texto) {
  const linhas = [];
  let campo = '';
  let linha = [];
  let aspas = false;
  const conteudo = texto.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  for (let i = 0; i < conteudo.length; i++) {
    const c = conteudo[i];
    if (aspas) {
      if (c === '"') {
        if (conteudo[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') { aspas = true; continue; }
    if (c === ',') { linha.push(campo); campo = ''; continue; }
    if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; continue; }
    campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

export function mapearColunas(cabecalho) {
  const porNome = new Map();
  cabecalho.forEach((nome, i) => {
    const n = semAcento(nome);
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

/** "R$ 365.123,42" -> 365123.42 · "#N/A" e vazio -> null. */
export function valor(v) {
  let s = String(v ?? '').replace(/R\$/gi, '').replace(/\s| /g, '').trim();
  if (!s || s === '-' || s.startsWith('#')) return null;
  const negativo = /^\(.*\)$/.test(s);
  if (negativo) s = s.slice(1, -1);
  if (s.includes(',') && s.lastIndexOf(',') > s.lastIndexOf('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}

export const texto = (v) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s && !s.startsWith('#') ? s : null;
};

/**
 * Status em MAIÚSCULA. A planilha mistura "Projetado" (276 linhas) e
 * "PROJETADO" (163), "A receber" (299) e "A RECEBER" (18) — agrupar por texto
 * cru partia cada um em duas contagens.
 */
export const status = (v) => {
  const s = texto(v);
  return s ? s.toUpperCase() : null;
};

/** CNJ só dígitos: a planilha e o banco divergem na pontuação. */
export const cnjDigitos = (v) => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 20 ? d : null;
};

/**
 * Nome da parte comparável: sem acento, maiúscula, espaço colapsado. A planilha
 * escreve "ANTÔNIO JOSÉ DA SILVA" e o banco pode ter "ANTONIO JOSE DA SILVA".
 */
export const nomeChave = (v) =>
  String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim().toUpperCase();

/** Chave de casamento: processo + parte. */
export const chaveParte = (cnj, cliente) => `${cnjDigitos(cnj) ?? ''}|${nomeChave(cliente)}`;

export function montarLinha(campos, indice) {
  const pega = (c) => (indice[c] == null ? null : campos[indice[c]]);
  return {
    processo: texto(pega('processo')),
    cliente: texto(pega('cliente')),
    status_pagamento: status(pega('status_pagamento')),
    fase_atual: texto(pega('fase_atual')),
    condenacao_cjcm: valor(pega('condenacao_cjcm')),
    cota_parte_cjcm: valor(pega('cota_parte_cjcm')),
    cota_parte_vista_cjcm: valor(pega('cota_parte_vista_cjcm')),
    hc_vista: valor(pega('hc_vista')),
    hc_parcelado: valor(pega('hc_parcelado')),
    hs: valor(pega('hs')),
  };
}

/**
 * Casa as linhas da planilha com as partes do banco e diz o que fazer.
 * Puro: sem rede, é o que o teste exercita.
 *
 * Uma parte pode aparecer MAIS DE UMA VEZ na planilha (litisconsórcio com
 * parcelas em linhas separadas). Nesse caso vale a linha com condenação — se
 * houver duas com valor, é ambiguidade e vai para o relatório em vez de o
 * script escolher sozinho.
 */
export function planejar(daPlanilha, doBanco) {
  const porChave = new Map();
  for (const p of doBanco) porChave.set(chaveParte(p.processo_cnj, p.cliente), p);

  const atualizar = [];
  const semParte = [];
  const ambiguas = [];
  const vistas = new Map();

  for (const l of daPlanilha) {
    if (!l.cliente || !cnjDigitos(l.processo)) continue;
    const k = chaveParte(l.processo, l.cliente);
    const alvo = porChave.get(k);
    if (!alvo) { semParte.push(l); continue; }
    const anterior = vistas.get(k);
    if (anterior) {
      // Duas linhas com valor para a mesma parte: não dá para escolher.
      if (anterior.condenacao_cjcm != null && l.condenacao_cjcm != null) {
        ambiguas.push(l);
        continue;
      }
      if (l.condenacao_cjcm == null) continue; // a que já valia é a boa
      const i = atualizar.findIndex((a) => a.chave === k);
      if (i >= 0) atualizar.splice(i, 1);
    }
    vistas.set(k, l);
    atualizar.push({ chave: k, parte_id: alvo.parte_id, linha: l });
  }
  return { atualizar, semParte, ambiguas };
}

// ---------------------------------------------------------------------------
const sql = (v) => (v == null || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const sqlNum = (v) => (v == null ? 'null' : String(Number(v)));
const NUMERICAS = new Set(['condenacao_cjcm', 'cota_parte_cjcm', 'cota_parte_vista_cjcm', 'hc_vista', 'hc_parcelado', 'hs']);

/**
 * Um UPDATE ... FROM (VALUES ...) por lote, não um statement por parte: 997
 * updates soltos são ~200KB de SQL e 997 idas ao banco; assim são 3 comandos.
 * `lote` existe para o SQL caber onde for aplicado (migration, MCP, psql).
 */
export function gerarSql(plano, lote = 400) {
  const out = ['-- Tab. Aux -> jm_partes. Gerado por scripts/import-tab-aux.mjs --sql'];
  for (let i = 0; i < plano.atualizar.length; i += lote) {
    const parte = plano.atualizar.slice(i, i + lote);
    const tuplas = parte.map(({ parte_id, linha }) =>
      `(${sql(parte_id)},${CAMPOS_VALOR.map((c) => (NUMERICAS.has(c) ? sqlNum(linha[c]) : sql(linha[c]))).join(',')})`);
    // O cast é obrigatório: numa lista VALUES o Postgres infere text quando a
    // primeira linha traz null, e aí a atribuição em coluna numeric estoura.
    const sets = CAMPOS_VALOR
      .map((c) => `${c} = v.${c}${NUMERICAS.has(c) ? '::numeric' : '::text'}`)
      .join(', ');
    out.push(
      `update public.jm_partes p set ${sets}, valores_importados_em = now()\n`
      + `from (values\n${tuplas.join(',\n')}\n) as v(parte_id,${CAMPOS_VALOR.join(',')})\n`
      + 'where p.parte_id = v.parte_id;',
    );
  }
  return out.join('\n');
}

function cabecalhos(chave) {
  return { apikey: chave, Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' };
}

async function buscarPartes(chave) {
  const todas = [];
  for (let de = 0; ; de += 1000) {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/${TABELA}?select=parte_id,processo_cnj,cliente&order=parte_id&offset=${de}&limit=1000`,
      { headers: cabecalhos(chave) },
    );
    if (!resp.ok) throw new Error(`falha ao ler ${TABELA}: ${resp.status} ${await resp.text()}`);
    const pagina = await resp.json();
    todas.push(...pagina);
    if (pagina.length < 1000) break;
  }
  return todas;
}

async function main() {
  const args = process.argv.slice(2);
  const seco = args.includes('--dry-run');
  const iSql = args.indexOf('--sql');
  const arquivoSql = iSql >= 0 ? args[iSql + 1] : null;
  const arquivo = args.find((a, n) => !a.startsWith('--') && n !== iSql + 1);

  if (!arquivo || !existsSync(arquivo)) {
    console.error('uso: node scripts/import-tab-aux.mjs [--dry-run] [--sql saida.sql] <TabAux.csv>');
    process.exit(1);
  }
  const chave = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!chave) { console.error('erro: defina SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

  const csv = lerCsv(readFileSync(arquivo, 'utf8'));
  // O cabeçalho não é a primeira linha: a aba tem linhas de totais em cima.
  const iCab = csv.findIndex((l) => {
    const { indice } = mapearColunas(l);
    return indice.cliente != null && indice.condenacao_cjcm != null;
  });
  if (iCab < 0) { console.error('erro: não achei o cabeçalho da Tab. Aux no CSV'); process.exit(1); }
  const { indice, faltando } = mapearColunas(csv[iCab]);
  if (faltando.length) console.warn(`aviso: colunas não encontradas: ${faltando.join(', ')}`);

  const daPlanilha = csv.slice(iCab + 1)
    .filter((l) => l.some((c) => String(c ?? '').trim()))
    .map((l) => montarLinha(l, indice))
    .filter((l) => l.cliente && cnjDigitos(l.processo));

  const doBanco = await buscarPartes(chave);
  const plano = planejar(daPlanilha, doBanco);

  const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const soma = (campo) => brl(plano.atualizar.reduce((t, a) => t + (Number(a.linha[campo]) || 0), 0));

  console.log(`cabeçalho na linha ${iCab + 1} · planilha ${daPlanilha.length} partes · banco ${doBanco.length}`);
  console.log(`  atualizar: ${plano.atualizar.length}`);
  console.log(`    condenação      ${soma('condenacao_cjcm')}`);
  console.log(`    cota do cliente ${soma('cota_parte_cjcm')}`);
  console.log(`    hon. contratual ${brl(plano.atualizar.reduce((t, a) => t + (Number(a.linha.hc_vista) || 0) + (Number(a.linha.hc_parcelado) || 0), 0))}`);
  console.log(`    hon. sucumbenc. ${soma('hs')}`);
  if (plano.semParte.length) {
    console.log(`  SEM PARTE no banco: ${plano.semParte.length} (não inventadas — confira à mão)`);
    for (const l of plano.semParte.slice(0, 10)) console.log(`    ${l.processo} · ${l.cliente}`);
    if (plano.semParte.length > 10) console.log(`    ...e mais ${plano.semParte.length - 10}`);
  }
  if (plano.ambiguas.length) {
    console.log(`  AMBÍGUAS (mesma parte com dois valores na planilha): ${plano.ambiguas.length}`);
    for (const l of plano.ambiguas.slice(0, 10)) console.log(`    ${l.processo} · ${l.cliente}`);
  }

  if (arquivoSql) {
    writeFileSync(arquivoSql, gerarSql(plano));
    console.log(`\nSQL escrito em ${arquivoSql} (nada foi aplicado).`);
    return;
  }
  if (seco) { console.log('\n--dry-run: nada foi escrito.'); return; }

  let n = 0;
  for (const { parte_id, linha } of plano.atualizar) {
    const corpo = { valores_importados_em: new Date().toISOString() };
    for (const c of CAMPOS_VALOR) corpo[c] = linha[c];
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${TABELA}?parte_id=eq.${encodeURIComponent(parte_id)}`, {
      method: 'PATCH',
      headers: { ...cabecalhos(chave), Prefer: 'return=minimal' },
      body: JSON.stringify(corpo),
    });
    if (!resp.ok) throw new Error(`PATCH ${parte_id}: ${resp.status} ${await resp.text()}`);
    if (++n % 200 === 0) console.log(`  ...${n}/${plano.atualizar.length}`);
  }
  console.log(`atualizadas: ${n}`);
}

if (process.argv[1] && process.argv[1].endsWith('import-tab-aux.mjs')) {
  main().catch((e) => { console.error('erro:', e.message); process.exit(1); });
}
