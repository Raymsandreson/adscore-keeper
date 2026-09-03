/**
 * Funções puras compartilhadas pelos dois importadores da aba "Lançamentos"
 * da planilha Jurimetria/indenização.
 *
 * POR QUE DOIS IMPORTADORES E NÃO UM (03/09/2026)
 *
 * A aba Lançamentos guarda DUAS coisas na mesma tabela, e a coluna que separa
 * é `N° DA PARCELA`:
 *
 *   sem N° DA PARCELA  1.955 linhas  uma por (parte × DECISÃO)   -> quanto VALE
 *   com N° DA PARCELA  1.022 linhas  uma por (parte × PARCELA)   -> quando ENTRA
 *
 * Tratar tudo como decisão e pegar "a mais recente por parte" deixa 702 de
 * 1.191 partes sem valor e faz sumir 28 processos / R$ 16.460.307,44 que só
 * existem nas linhas de parcela. Medido em 03/09/2026.
 *
 * O ERRO QUE ISSO CAUSOU NA CARGA DE 08/07/2026: as linhas de parcela viraram
 * decisão. Das 95 `HOMOLOGAÇÃO DE ACORDO` em `jm_decisoes`, 64 são repetição no
 * mesmo processo e 52 casam com a data de uma parcela em `jm_pagamentos`. O
 * caso `0000352-23.2023.5.09.0665` tem doze "homologações" mensais (D0091 a
 * D0102) — é um acordo pago em doze vezes, não doze acordos.
 *
 * Estes módulos não apagam nada: as decisões suspeitas saem no relatório para o
 * Raym decidir. Regra do Modo Leopardo.
 */

/** Parser de CSV com aspas. Igual ao de import-tab-aux.mjs. */
export function lerCsv(texto) {
  const linhas = [];
  let campo = '';
  let linha = [];
  let aspas = false;
  const conteudo = String(texto).replace(/^﻿/, '').replace(/\r\n/g, '\n');
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

const semAcento = (v) =>
  String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** "R$ 365.123,42" -> 365123.42 · "#N/A", vazio e "-" -> null. */
export function valor(v) {
  let s = String(v ?? '').replace(/R\$/gi, '').replace(/[\s ]/g, '').trim();
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

/** "10,00%" -> 0.10 · a planilha escreve percentual, o banco guarda fração. */
export function percentual(v) {
  const n = valor(String(v ?? '').replace(/%/g, ''));
  return n == null ? null : n / 100;
}

export const texto = (v) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s && !s.startsWith('#') ? s : null;
};

/**
 * "26/09/2020" -> "2020-09-26". Devolve null para vazio, "#N/A" e para a data
 * zero do Excel (30/12/1899), que aparece quando a célula está em branco mas
 * formatada como data.
 */
export function data(v) {
  const s = texto(v);
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  let iso = null;
  if (m) iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) iso = s;
  if (!iso || iso === '1899-12-30') return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : iso;
}

/** CNJ como a planilha e o banco escrevem (com máscara), validando 20 dígitos. */
export const cnj = (v) => {
  const s = texto(v);
  if (!s) return null;
  return String(s).replace(/\D/g, '').length === 20 ? s : null;
};

/** Nome comparável: sem acento, maiúscula, espaço colapsado. */
export const nomeChave = (v) =>
  String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim().toUpperCase();

export const chaveParte = (processo, cliente) => `${processo ?? ''}|${nomeChave(cliente)}`;

/**
 * O rótulo da planilha vira o par (tipo_evento, instancia) que `jm_decisoes`
 * usa. Devolve null para o que NÃO é decisão — a linha então não entra na
 * régua, em vez de virar uma decisão fantasma.
 *
 * "SEM DECISÃO" são 612 linhas: é processo ainda sem mérito, cujo valor na
 * planilha é projeção. Projeção não é decisão.
 */
const MAPA = new Map(Object.entries({
  'sentenca':                          ['SENTENÇA', '1º GRAU'],
  'embargos 1o grau':                  ['EMBARGOS DE DECLARAÇÃO', '1º GRAU'],
  '2o embargos 1o grau':               ['EMBARGOS DE DECLARAÇÃO', '1º GRAU'],
  'embargos 2o grau':                  ['EMBARGOS DE DECLARAÇÃO', '2º GRAU'],
  'embargos tst':                      ['EMBARGOS DE DECLARAÇÃO', 'TST'],
  'acordao 2o grau':                   ['ACÓRDÃO', '2º GRAU'],
  'acordao tst':                       ['ACÓRDÃO', 'TST'],
  'acordao stj':                       ['ACÓRDÃO', 'STJ'],
  'acordao':                           ['ACÓRDÃO', 'A REVISAR'],
  'decisao tst':                       ['DECISÃO', 'TST'],
  'decisao stj':                       ['DECISÃO', 'STJ'],
  'decisao stf':                       ['DECISÃO', 'STF'],
  'acordo':                            ['HOMOLOGAÇÃO DE ACORDO', 'A REVISAR'],
  'acordo antes da sentenca':          ['HOMOLOGAÇÃO DE ACORDO', '1º GRAU'],
  'acordo parcial antes da sentenca':  ['HOMOLOGAÇÃO DE ACORDO', '1º GRAU'],
  'acordo com sentenca':               ['HOMOLOGAÇÃO DE ACORDO', '1º GRAU'],
  'acordo com acordao 2o grau':        ['HOMOLOGAÇÃO DE ACORDO', '2º GRAU'],
  'acordo com acordao tst':            ['HOMOLOGAÇÃO DE ACORDO', 'TST'],
  'acordo com acordao superior':       ['HOMOLOGAÇÃO DE ACORDO', 'TST'],
}));

/** Rótulos que existem na planilha e NÃO são decisão de mérito. */
export const NAO_E_DECISAO = new Set([
  'sem decisao', 'arquivamento', 'suspenso', 'cancelado', 'inviavel',
  'relatorio de investigacao do acidente(favoravel)', '',
]);

export function classificarDecisao(rotulo) {
  const k = semAcento(rotulo).replace(/º|°/g, 'o');
  if (NAO_E_DECISAO.has(k)) return null;
  return MAPA.get(k) ?? null;
}

/** Rótulos vistos na planilha que o MAPA não cobre — vão para o relatório. */
export function rotulosDesconhecidos(linhas) {
  const fora = new Map();
  for (const l of linhas) {
    const k = semAcento(l.decisao).replace(/º|°/g, 'o');
    if (NAO_E_DECISAO.has(k) || MAPA.has(k)) continue;
    fora.set(l.decisao, (fora.get(l.decisao) ?? 0) + 1);
  }
  return [...fora.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * Separa a aba em DECISÃO e PARCELA. É a divisão que dá nome aos dois
 * importadores: uma linha com `N° DA PARCELA` (ou com `DATA DA PARCELA`) é
 * fluxo de caixa de acordo, não julgamento.
 */
export function separar(linhas) {
  const decisoes = [];
  const parcelas = [];
  for (const l of linhas) {
    if (!l.processo || !l.cliente) continue;
    (l.n_parcela != null || l.data_parcela ? parcelas : decisoes).push(l);
  }
  return { decisoes, parcelas };
}

/** Chave natural de uma decisão: o que a torna a MESMA decisão. */
export const chaveDecisao = (processo, tipo, instancia, dataDecisao) =>
  `${processo}~${tipo}~${instancia}~${dataDecisao}`;

export const sqlTexto = (v) => (v == null || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
export const sqlNum = (v) => (v == null || !Number.isFinite(Number(v)) ? 'null' : String(Number(v)));
