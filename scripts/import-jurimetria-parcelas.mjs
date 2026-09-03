#!/usr/bin/env node
/**
 * Importa as linhas de PARCELA da aba "Lançamentos" (planilha
 * Jurimetria/indenização) para `jm_pagamentos` no Supabase Externo.
 *
 * Uso:
 *   node scripts/import-jurimetria-parcelas.mjs --dry-run Lancamentos.csv
 *   node scripts/import-jurimetria-parcelas.mjs --sql saida.sql Lancamentos.csv
 *
 * O QUE ELE LÊ
 *   Só as linhas COM `N° DA PARCELA` (1.022 de 2.926 em 03/09/2026). As demais
 *   são decisão e vão para `jm_decisoes`/`jm_valores` pelo outro script.
 *
 * ESTADO EM 03/09/2026: `jm_pagamentos` já tem 1.022 linhas e bate com a
 * planilha em 38 dos 40 processos. O delta é um processo novo
 * (1000113-66.2025.8.11.0037) e uma parcela a mais no banco em
 * 0000648-76.2023.5.23.0076. Este script existe para manter isso em dia sem
 * recarregar tudo.
 *
 * CHAVE: (processo, parte, n_parcela). A planilha não tem id de pagamento, e
 * casar por número de linha já deu errado uma vez neste projeto — ver o
 * cabeçalho de import-lancamentos-planilha.mjs.
 *
 * STATUS: a planilha diz "Pago" ou "A receber" na coluna STATUS DO PAGAMENTO.
 * Vira `RECEBIDA`/`A_RECEBER`, e a data cai em `data_recebida` ou
 * `data_prevista` conforme o caso — misturar as duas é o que faz o caixa
 * mostrar como realizado o que ainda não entrou.
 *
 * NUNCA APAGA.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import {
  lerCsv, valor, percentual, texto, data, cnj, chaveParte, separar, sqlTexto, sqlNum,
} from './jurimetria-lancamentos-comum.mjs';

const COLUNAS = {
  cliente: ['cliente'],
  processo: ['autos processuais'],
  status_pagamento: ['status do pagamento'],
  forma_pagamento: ['forma de pagamento'],
  desagio: ['desagio'],
  n_parcela: ['no da parcela', 'n da parcela'],
  data_parcela: ['data da parcela'],
  parte_cjcm: ['total parte cjcm'],
  parte_vista_cjcm: ['total a vista parte cjcm'],
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

/** "Pago" -> RECEBIDA · "A receber" -> A_RECEBER. */
export function statusParcela(v) {
  const s = semAcento(v);
  if (!s) return null;
  if (s.startsWith('pago') || s.startsWith('receb')) return 'RECEBIDA';
  if (s.startsWith('a receber') || s.startsWith('projet')) return 'A_RECEBER';
  return s.toUpperCase();
}

export function montarLinha(campos, indice) {
  const pega = (c) => (indice[c] == null ? null : campos[indice[c]]);
  const st = statusParcela(pega('status_pagamento'));
  const dt = data(pega('data_parcela'));
  const nParcelaTexto = texto(pega('n_parcela'));
  const n = nParcelaTexto == null ? null : Number(String(nParcelaTexto).replace(/\D/g, ''));
  return {
    cliente: texto(pega('cliente')),
    processo: cnj(pega('processo')),
    status: st,
    forma: texto(pega('forma_pagamento')),
    desagio: percentual(pega('desagio')),
    n_parcela: Number.isFinite(n) && n > 0 ? n : null,
    data_parcela: dt,
    // A data cai no campo que corresponde ao status. Nunca nos dois.
    data_recebida: st === 'RECEBIDA' ? dt : null,
    data_prevista: st === 'RECEBIDA' ? null : dt,
    valor_previsto: valor(pega('parte_vista_cjcm')) ?? valor(pega('parte_cjcm')),
  };
}

/**
 * `pagamentosBanco`: [{ id, processo_cnj, parte_id, n_parcela }]
 * `partesBanco`    : [{ parte_id, processo_cnj, cliente }]
 */
export function planejar(linhas, pagamentosBanco, partesBanco) {
  const porParte = new Map();
  for (const p of partesBanco) porParte.set(chaveParte(p.processo_cnj, p.cliente), p.parte_id);
  const existente = new Set(pagamentosBanco.map((g) => `${g.parte_id}|${g.n_parcela}`));

  const inserir = [];
  const jaExiste = [];
  const semParte = [];
  const semNumero = [];
  const vistas = new Set();

  for (const l of linhas) {
    if (l.n_parcela == null) { semNumero.push(l); continue; }
    const parteId = porParte.get(chaveParte(l.processo, l.cliente));
    if (!parteId) { semParte.push(l); continue; }
    const k = `${parteId}|${l.n_parcela}`;
    if (vistas.has(k)) continue;          // planilha repetiu a mesma parcela
    vistas.add(k);
    const reg = {
      parte_id: parteId,
      processo_cnj: l.processo,
      cliente: l.cliente,
      n_parcela: l.n_parcela,
      data_prevista: l.data_prevista,
      data_recebida: l.data_recebida,
      status: l.status,
      forma: l.forma,
      desagio: l.desagio,
      valor_previsto: l.valor_previsto,
      valor_origem: 'JURIMETRIA_LANCAMENTOS',
    };
    (existente.has(k) ? jaExiste : inserir).push(reg);
  }

  // Pagamento no banco que a planilha não tem mais. Nunca apagado aqui.
  const orfaos = pagamentosBanco.filter((g) => !vistas.has(`${g.parte_id}|${g.n_parcela}`));
  return { inserir, jaExiste, semParte, semNumero, orfaos };
}

const CAMPOS = ['parte_id', 'processo_cnj', 'cliente', 'n_parcela', 'data_prevista',
  'data_recebida', 'status', 'forma', 'desagio', 'valor_previsto', 'valor_origem'];
const NUM = new Set(['n_parcela', 'desagio', 'valor_previsto']);

export function gerarSql(plano, lote = 300) {
  if (!plano.inserir.length) return '-- nada a inserir\n';
  const partes = ['-- Gerado por scripts/import-jurimetria-parcelas.mjs', 'begin;'];
  for (let i = 0; i < plano.inserir.length; i += lote) {
    const bloco = plano.inserir.slice(i, i + lote);
    partes.push(
      `insert into public.jm_pagamentos (${CAMPOS.join(',')}) values\n` +
      bloco.map((r) => '(' + CAMPOS.map(
        (c) => (NUM.has(c) ? sqlNum(r[c]) : sqlTexto(r[c]))).join(',') + ')').join(',\n') + ';');
  }
  partes.push('commit;');
  return partes.join('\n\n');
}

export function lerPlanilha(caminho) {
  const linhas = lerCsv(readFileSync(caminho, 'utf8'));
  let cab = 0;
  for (let i = 0; i < Math.min(6, linhas.length); i++) {
    if (mapearColunas(linhas[i]).faltando.length === 0) { cab = i; break; }
  }
  const { indice, faltando } = mapearColunas(linhas[cab]);
  if (faltando.length) throw new Error(`colunas não encontradas: ${faltando.join(', ')}`);
  return linhas.slice(cab + 1).map((c) => montarLinha(c, indice)).filter((l) => l.processo && l.cliente);
}

async function main() {
  const args = process.argv.slice(2);
  const arquivo = args.find((a) => !a.startsWith('--') && a !== args[args.indexOf('--sql') + 1]);
  if (!arquivo || !existsSync(arquivo)) {
    console.error('uso: node scripts/import-jurimetria-parcelas.mjs [--dry-run|--sql ARQ] Lancamentos.csv');
    process.exit(1);
  }
  const todas = lerPlanilha(arquivo);
  const { decisoes, parcelas } = separar(
    todas.map((l) => ({ ...l, n_parcela: l.n_parcela, data_parcela: l.data_parcela })));
  console.log(`planilha: ${todas.length} linhas -> ${parcelas.length} de parcela, ${decisoes.length} de decisão (ignoradas aqui)`);
  console.log(`  status : ${JSON.stringify(parcelas.reduce((a, p) => ((a[p.status ?? 'null'] = (a[p.status ?? 'null'] ?? 0) + 1), a), {}))}`);
  console.log(`  com data de parcela: ${parcelas.filter((p) => p.data_parcela).length}`);
  console.log('\nsem SUPABASE_SERVICE_ROLE_KEY o script não compara com o banco.');
  console.log('Rode com a chave para o dry-run completo, ou use --sql depois de conferir.');
}

if (process.argv[1] && process.argv[1].endsWith('import-jurimetria-parcelas.mjs')) {
  main().catch((e) => { console.error('erro:', e.message); process.exit(1); });
}
