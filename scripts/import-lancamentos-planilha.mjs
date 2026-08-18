#!/usr/bin/env node
/**
 * Importa a aba "Lançamentos" da planilha CONTROLE FINANCEIRO GRUPO PRUDÊNCIO
 * para public.jm_lancamentos no Supabase Externo.
 *
 * Uso:
 *   node scripts/import-lancamentos-planilha.mjs --dry-run ~/Downloads/Lancamentos.csv
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-lancamentos-planilha.mjs ~/Downloads/Lancamentos.csv
 *
 *   --dry-run   compara com o banco e imprime o que mudaria, sem escrever.
 *   --inserir   INSERE as linhas da planilha que não existem no banco.
 *   --apagar    APAGA do banco as linhas que sumiram da planilha. Fora do padrão
 *               de propósito: uma exportação parcial apagaria a base inteira.
 *   --sql ARQ   em vez de chamar a API, escreve o SQL da sincronização em ARQ.
 *               Serve para aplicar por outro caminho (migration, MCP) quando a
 *               SUPABASE_SERVICE_ROLE_KEY não está à mão.
 *
 * Como exportar: no Google Sheets, aba Lançamentos -> Arquivo -> Fazer download
 * -> Valores separados por vírgula (.csv).
 *
 * POR QUE ESTE SCRIPT EXISTE (18/08/2026): a carga anterior trouxe 21 das 23
 * colunas. Ficaram de fora `Relação c/ Cliente` (o percentual do contrato — 30%,
 * 15%; só 7 de 4.742 linhas tinham valor) e `Beneficiário`. O Raym decidiu que
 * Beneficiário não é necessário — o titular do lançamento é deduzido da
 * categoria, e essa dedução está certa (ver src/lib/lancamentoCategorias.ts).
 * Então este script existe para trazer o percentual e manter a base em dia a
 * cada nova exportação.
 *
 * CHAVE: o CONTEÚDO da linha, nunca o número dela.
 *
 * A primeira versão casava por `ordem_origem` (número da linha na planilha).
 * Isso estava ERRADO e foi pego antes de rodar, em 18/08/2026: o Raym apagou 99
 * linhas da planilha, e tudo abaixo delas subiu. A `ordem_origem` 3000 no banco
 * é "FELIPE ESTEFÂNIO R$ 105,21"; na planilha de hoje a linha 3000 é "JONAS
 * AIRES SILVA, Indenização, R$ 30.864,59". Casar por número teria sobrescrito
 * milhares de registros com os dados errados, em silêncio.
 *
 * Agora a identidade é o conteúdo, em dois níveis:
 *   CHAVE FORTE  data+categoria+pessoa+processo+valor+parcela+observação+conta.
 *                Bateu -> a linha não mudou, não faz nada.
 *   CHAVE FRACA  data+categoria+pessoa+processo+parcela (sem valor nem texto).
 *                Bateu só a fraca -> é a MESMA linha com valor/observação
 *                editados: vira UPDATE, preservando id, `parte_id`,
 *                `parte_conciliacao` e `tem_data_pagamento`.
 * Sobrou só no banco -> foi REMOVIDA da planilha (só apaga com --apagar).
 * Sobrou só na planilha -> é NOVA (só insere com --inserir).
 *
 * Texto entra nas chaves em minúscula e com espaços colapsados: a carga antiga
 * gravou `conta` em maiúscula ("TITULAR" contra "Titular" da planilha), e sem
 * isso NENHUMA linha casaria.
 *
 * Linhas de conteúdo idêntico (61 na planilha de hoje — parcelas repetidas)
 * ganham um ordinal na chave. Como são intercambiáveis, qual casa com qual é
 * indiferente.
 *
 * CONCILIAÇÃO (`parte_id`, `parte_conciliacao`): não existe na planilha e não
 * pode se perder na recarga. Preservar linha a linha NÃO funciona — o Raym
 * reorganiza as partes, e uma parcela de 28/02/2024 que era "ADERALDO PIRES
 * CARVALHO" hoje é "KEILA CARVALHO SANTOS SOUSA": a linha antiga some, a nova
 * nasce, e o vínculo cairia junto (37 linhas no diff de 18/08/2026).
 *
 * O que salva é que `parte_id` é FUNÇÃO de (processo, pessoa) — conferido no
 * banco: 242 combinações, zero ambíguas. Então o script guarda esse mapa ANTES
 * de mexer e o reaplica DEPOIS, nas linhas que ficarem sem vínculo. A
 * conciliação passa a sobreviver a qualquer reorganização de linhas.
 *
 * `tem_data_pagamento` também não vem da planilha e fica fora do UPDATE.
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SUPABASE_URL = 'https://kmedldlepwiityjsdahz.supabase.co';
const TABELA = 'jm_lancamentos';
const LOTE = 200;

// ---------------------------------------------------------------------------
// Colunas da planilha. A busca é por NOME normalizado (sem acento, minúsculo),
// porque a ordem das colunas já mudou uma vez e posição fixa quebraria calado.
// ---------------------------------------------------------------------------
const COLUNAS = {
  responsavel: ['responsavel'],
  distribuido: ['distribuido'],
  data: ['data'],
  caso: ['caso'],
  processo_raw: ['processo'],
  pessoa: ['pessoa'],
  categoria: ['categoria'],
  subcategoria: ['subcategoria'],
  // A planilha tem DUAS colunas "Natureza": a primeira é a da recorrência (fica
  // antes de Tipo) e a última é a natureza do dano (última coluna da aba). Sem
  // dizer qual ocorrência pegar, a segunda ficava invisível e o dano vinha nulo.
  natureza_recorrencia: ['natureza'],
  recorrencia: ['recorrencia'],
  tipo_raw: ['tipo'],
  relacao_cliente: ['relacao c/ cliente', 'relacao c/cliente', 'relacao cliente'],
  n_parcela: ['n° da parcela', 'no da parcela', 'n da parcela', 'numero da parcela'],
  nf: ['nf'],
  conta: ['conta'],
  observacao: ['observacao'],
  valor_caixa: ['valor (regime de caixa)', 'valor regime de caixa', 'valor (regime de caix'],
  valor_competencia: ['valor (regime de competencia)', 'valor regime de competencia', 'valor (regime de'],
  beneficiario: ['beneficiario'],
  conta_beneficiaria: ['conta beneficiaria da transferencia', 'conta beneficiaria'],
  banco: ['banco'],
  taxa_am: ['taxa(a.m)', 'taxa (a.m)', 'taxa am'],
  natureza_dano: ['natureza dano', 'natureza do dano', 'natureza'],
};

/**
 * Colunas que vêm da planilha e podem ser atualizadas. Ficam de fora de
 * propósito: `parte_id` e `parte_conciliacao` (da conciliação feita depois da
 * importação) e `tem_data_pagamento` (marca que a `data` da linha é a da
 * decisão, não de vencimento). Nada disso existe na planilha, então reimportar
 * não pode apagar.
 */
const ATUALIZAVEIS = [
  'responsavel', 'distribuido', 'data', 'processo_cnj', 'processo_raw', 'pessoa',
  'categoria', 'subcategoria', 'natureza_recorrencia', 'recorrencia', 'tipo',
  'tipo_raw', 'relacao_cliente', 'n_parcela', 'nf', 'conta', 'observacao',
  'valor_caixa', 'valor_competencia', 'beneficiario', 'conta_beneficiaria',
  'banco', 'taxa_am', 'natureza_dano',
];

const semAcento = (v) =>
  String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// ---------------------------------------------------------------------------
// CSV com aspas: campo pode conter vírgula e quebra de linha (a coluna
// `observacao` tem as duas coisas). Parser posicional, sem dependência.
// ---------------------------------------------------------------------------
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

/** Mapa nome-normalizado -> índice, a partir da linha de cabeçalho. */
/** Campos que devem pegar a ÚLTIMA coluna de nome repetido, não a primeira. */
const ULTIMA_OCORRENCIA = new Set(['natureza_dano']);

export function mapearColunas(cabecalho) {
  // Guarda TODAS as posições de cada nome: a planilha repete "Natureza".
  const porNome = new Map();
  cabecalho.forEach((nome, i) => {
    const n = semAcento(nome);
    if (!n) return;
    porNome.set(n, [...(porNome.get(n) || []), i]);
  });
  const escolher = (posicoes, campo) =>
    ULTIMA_OCORRENCIA.has(campo) ? posicoes[posicoes.length - 1] : posicoes[0];

  const indice = {};
  const faltando = [];
  const usados = new Set();
  for (const [campo, apelidos] of Object.entries(COLUNAS)) {
    let achou = -1;
    for (const apelido of apelidos) {
      if (porNome.has(apelido)) {
        // Nome repetido: se a primeira posição já foi de outro campo, cai para
        // a seguinte — é assim que "Natureza" serve recorrência E dano.
        const livres = porNome.get(apelido).filter((i) => !usados.has(i));
        const posicoes = livres.length ? livres : porNome.get(apelido);
        achou = escolher(posicoes, campo);
        break;
      }
      // Cabeçalho vem truncado em algumas exportações ("Valor (Regime de Caix"),
      // então prefixo nos dois sentidos também vale.
      for (const [nome, posicoes] of porNome) {
        if (nome.startsWith(apelido) || apelido.startsWith(nome)) {
          const livres = posicoes.filter((i) => !usados.has(i));
          achou = escolher(livres.length ? livres : posicoes, campo);
          break;
        }
      }
      if (achou >= 0) break;
    }
    if (achou < 0) faltando.push(campo);
    else { indice[campo] = achou; usados.add(achou); }
  }
  return { indice, faltando };
}

/** "30/11/2025" -> "2025-11-30". Já-ISO passa direto. Vazio -> null. */
export function data(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** "R$ 1.234,56" -> 1234.56 · "1234.56" -> 1234.56 · "" -> null. */
export function valor(v) {
  let s = String(v ?? '').replace(/R\$/gi, '').replace(/\s/g, '').trim();
  if (!s || s === '-' || /^#/.test(s)) return null;
  const negativo = /^\(.*\)$/.test(s);
  if (negativo) s = s.slice(1, -1);
  // Formato BR quando a vírgula vem depois do último ponto: 1.234,56.
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
  const s = String(v ?? '').trim();
  return s && !/^#(N\/A|REF!|VALUE!|DIV\/0!)/i.test(s) ? s : null;
};

/** Dígitos do CNJ com 20 dígitos, no formato canônico da base. */
export function cnj(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  if (d.length !== 20) return null;
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}`;
}

/**
 * TIPO — para onde o dinheiro andou, na régua combinada com o Raym em
 * 18/08/2026. Espelha src/lib/lancamentoCategorias.ts (fonte da verdade do
 * front); mudou lá, muda aqui:
 *
 *   ENTRADA  entrou e é NOSSO   (honorário recebido/a receber, crédito
 *                                comprado, adiantamento do FIDC)
 *   SAIDA    saiu e era NOSSO   (custas, perícia, folha, imposto)
 *   REPASSE  dinheiro de TERCEIRO passando pela conta — cota do cliente e
 *            repasse ao advogado parceiro. Não é receita nem despesa.
 *
 * O que a pessoa escreveu na planilha vale primeiro; a categoria só decide
 * quando a coluna Tipo está vazia ou traz algo fora dessas três.
 */
export function tipoNormalizado(tipoPlanilha, categoria) {
  const t = semAcento(tipoPlanilha);
  if (t === 'entrada') return 'ENTRADA';
  if (t === 'saida') return 'SAIDA';
  if (t === 'repasse') return 'REPASSE';

  const cat = semAcento(categoria);
  if (cat.includes('parceiro')) return 'REPASSE';
  if (cat.includes('comprad')) return 'ENTRADA';
  if (cat.includes('indeniza') || cat.includes('cota')) return 'REPASSE';
  if (cat.includes('honorari')) return 'ENTRADA';
  return null; // Movimentação de conta, OUTROS: ambíguo, não inventa.
}

export function montarLinha(campos, indice, numeroDaLinha) {
  const pega = (campo) => (indice[campo] == null ? null : campos[indice[campo]]);
  const categoria = texto(pega('categoria'));
  const tipoRaw = texto(pega('tipo_raw'));
  const processoRaw = texto(pega('processo_raw'));
  return {
    ordem_origem: numeroDaLinha,
    responsavel: texto(pega('responsavel')),
    distribuido: texto(pega('distribuido')),
    data: data(pega('data')),
    processo_cnj: cnj(processoRaw),
    processo_raw: processoRaw,
    pessoa: texto(pega('pessoa')),
    categoria,
    subcategoria: texto(pega('subcategoria')),
    natureza_recorrencia: texto(pega('natureza_recorrencia')),
    recorrencia: texto(pega('recorrencia')),
    tipo: tipoNormalizado(tipoRaw, categoria),
    tipo_raw: tipoRaw,
    relacao_cliente: texto(pega('relacao_cliente')),
    n_parcela: texto(pega('n_parcela')),
    nf: texto(pega('nf')),
    conta: texto(pega('conta')),
    observacao: texto(pega('observacao')),
    valor_caixa: valor(pega('valor_caixa')),
    valor_competencia: valor(pega('valor_competencia')),
    beneficiario: texto(pega('beneficiario')),
    conta_beneficiaria: texto(pega('conta_beneficiaria')),
    banco: texto(pega('banco')),
    taxa_am: texto(pega('taxa_am')),
    natureza_dano: texto(pega('natureza_dano')),
  };
}

// ---------------------------------------------------------------------------
// IDENTIDADE DA LINHA — por conteúdo, nunca por número de linha (ver o topo).
// ---------------------------------------------------------------------------

/**
 * Minúscula, sem espaço duplicado nem sobra nas pontas — e erro de fórmula
 * ("#N/A", "#REF!") vale como vazio. Isto é essencial: a carga antiga gravou o
 * erro cru no banco e o `texto()` daqui devolve null para ele. Sem alinhar os
 * dois lados, 39 linhas viravam apagar+inserir em vez de update, e levavam
 * junto a conciliação de parte que estava nelas.
 */
const txt = (v) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s.startsWith('#') ? '' : s.toLowerCase();
};

/** Numérico canônico com 4 casas — a mesma forma dos dois lados da comparação. */
const nmr = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? '' : Number(v).toFixed(4));

const md5 = (s) => createHash('md5').update(s).digest('hex').slice(0, 12);

/** Bateu = a linha não mudou em nada que a planilha controla. */
export function chaveForte(l) {
  return md5([
    l.data || '', txt(l.categoria), txt(l.pessoa), txt(l.processo_raw),
    nmr(l.valor_caixa), txt(l.n_parcela), txt(l.observacao), txt(l.conta),
  ].join('|'));
}

/** Bateu só esta = mesma linha, com valor ou texto editado. */
export function chaveFraca(l) {
  return md5([
    l.data || '', txt(l.categoria), txt(l.pessoa), txt(l.processo_raw), txt(l.n_parcela),
  ].join('|'));
}

/** Linhas de conteúdo idêntico existem (parcelas repetidas): o ordinal separa. */
export function comOrdinal(linhas, fn) {
  const visto = new Map();
  return linhas.map((l) => {
    const k = fn(l);
    const n = (visto.get(k) || 0) + 1;
    visto.set(k, n);
    return `${k}#${n}`;
  });
}

/**
 * O plano de sincronização. Puro: recebe as duas listas e devolve o que fazer,
 * sem tocar em rede — é o que o teste exercita.
 */
export function planejar(daPlanilha, doBanco) {
  const fortesPlanilha = comOrdinal(daPlanilha, chaveForte);
  const fortesBanco = comOrdinal(doBanco, chaveForte);
  const indiceBanco = new Map(fortesBanco.map((k, i) => [k, i]));
  const setPlanilha = new Set(fortesPlanilha);

  const iguais = [];
  const soNaPlanilha = [];
  fortesPlanilha.forEach((k, i) => {
    if (indiceBanco.has(k)) iguais.push(daPlanilha[i]);
    else soNaPlanilha.push(daPlanilha[i]);
  });
  const soNoBanco = doBanco.filter((_, i) => !setPlanilha.has(fortesBanco[i]));

  // Entre as sobras, quem casa pela chave FRACA é a mesma linha editada.
  const fracasBanco = new Map();
  comOrdinal(soNoBanco, chaveFraca).forEach((k, i) => fracasBanco.set(k, soNoBanco[i]));
  const usadas = new Set();
  const atualizar = [];
  const inserir = [];
  comOrdinal(soNaPlanilha, chaveFraca).forEach((k, i) => {
    const alvo = fracasBanco.get(k);
    if (alvo && !usadas.has(k)) {
      usadas.add(k);
      atualizar.push({ id: alvo.id, linha: soNaPlanilha[i], antes: alvo });
    } else {
      inserir.push(soNaPlanilha[i]);
    }
  });
  const apagar = soNoBanco.filter((b) => !atualizar.some((a) => a.id === b.id));
  return { iguais, atualizar, inserir, apagar };
}

// ---------------------------------------------------------------------------
// Supabase REST
// ---------------------------------------------------------------------------
function cabecalhos(chave) {
  return { apikey: chave, Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' };
}

/** Campos que o script precisa para identificar a linha e preservar o enriquecimento. */
const CAMPOS_BANCO = 'id,data,categoria,pessoa,processo_cnj,processo_raw,valor_caixa,n_parcela,observacao,conta,parte_id,parte_conciliacao,tem_data_pagamento';

/**
 * (processo, pessoa) -> conciliação, tirado do estado ATUAL do banco. É o que
 * permite apagar e reinserir linha sem perder o vínculo de parte.
 */
export function mapaConciliacao(doBanco) {
  const mapa = new Map();
  for (const l of doBanco) {
    if (l.parte_id == null) continue;
    const k = `${l.processo_cnj ?? l.processo_raw ?? ''}|${txt(l.pessoa)}`;
    if (!mapa.has(k)) mapa.set(k, { parte_id: l.parte_id, parte_conciliacao: l.parte_conciliacao });
  }
  return mapa;
}

async function buscarDoBanco(chave) {
  const todas = [];
  for (let de = 0; ; de += 1000) {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/${TABELA}?select=${CAMPOS_BANCO}&order=id&offset=${de}&limit=1000`,
      { headers: cabecalhos(chave) },
    );
    if (!resp.ok) throw new Error(`falha ao ler o banco: ${resp.status} ${await resp.text()}`);
    const pagina = await resp.json();
    todas.push(...pagina);
    if (pagina.length < 1000) break;
  }
  return todas;
}

async function enviar(chave, metodo, caminho, corpo) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
    method: metodo,
    headers: { ...cabecalhos(chave), Prefer: 'return=minimal' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (!resp.ok) throw new Error(`${metodo} ${caminho}: ${resp.status} ${await resp.text()}`);
}

// ---------------------------------------------------------------------------
// Geração de SQL — caminho para aplicar sem a service key em mão.
// ---------------------------------------------------------------------------
const sql = (v) => (v == null || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const sqlNum = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? 'null' : String(Number(v)));
const NUMERICAS = new Set(['valor_caixa', 'valor_competencia', 'ordem_origem']);

export function gerarSql(plano) {
  const out = [];
  out.push('-- Sincronização jm_lancamentos <- planilha Lançamentos.');
  out.push('-- Gerado por scripts/import-lancamentos-planilha.mjs --sql');
  out.push('begin;');
  out.push(`-- 1. Guarda (processo, pessoa) -> parte_id ANTES de mexer: a linha pode
--    sumir e renascer com outro nome, mas o vinculo e da PARTE, nao da linha.
create temporary table _conc on commit drop as
  select distinct on (processo_cnj, upper(btrim(pessoa)))
         processo_cnj, upper(btrim(pessoa)) as pessoa, parte_id, parte_conciliacao
  from public.jm_lancamentos where parte_id is not null;`);
  if (plano.apagar.length) {
    const ids = plano.apagar.map((l) => l.id).join(',');
    out.push('-- Rota de fuga: guarda as linhas antes de apagar.');
    out.push(`create table if not exists jm_lancamentos_removidas_20260818 as
  select * from public.jm_lancamentos where false;`);
    out.push(`insert into jm_lancamentos_removidas_20260818
  select * from public.jm_lancamentos where id in (${ids});`);
    out.push(`delete from public.jm_lancamentos where id in (${ids});`);
  }
  for (const { id, linha } of plano.atualizar) {
    const sets = ATUALIZAVEIS
      .map((c) => `${c} = ${NUMERICAS.has(c) ? sqlNum(linha[c]) : sql(linha[c])}`)
      .join(', ');
    out.push(`update public.jm_lancamentos set ${sets} where id = ${id};`);
  }
  if (plano.inserir.length) {
    const cols = ['ordem_origem', ...ATUALIZAVEIS];
    const vals = plano.inserir.map((l) =>
      `(${cols.map((c) => (NUMERICAS.has(c) ? sqlNum(l[c]) : sql(l[c]))).join(',')})`);
    out.push(`insert into public.jm_lancamentos (${cols.join(',')}) values\n${vals.join(',\n')};`);
  }
  out.push(`-- Reaplica a conciliacao no que ficou sem vinculo.
update public.jm_lancamentos l
   set parte_id = c.parte_id, parte_conciliacao = coalesce(l.parte_conciliacao, c.parte_conciliacao)
  from _conc c
 where l.parte_id is null
   and l.processo_cnj = c.processo_cnj
   and upper(btrim(l.pessoa)) = c.pessoa;`);
  out.push('commit;');
  return out.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const seco = args.includes('--dry-run');
  const inserirNovas = args.includes('--inserir');
  const apagarSumidas = args.includes('--apagar');
  const iSql = args.indexOf('--sql');
  const arquivoSql = iSql >= 0 ? args[iSql + 1] : null;
  const arquivo = args.find((a, n) => !a.startsWith('--') && n !== iSql + 1);

  if (!arquivo || !existsSync(arquivo)) {
    console.error('uso: node scripts/import-lancamentos-planilha.mjs [--dry-run] [--inserir] [--apagar] [--sql saida.sql] <arquivo.csv>');
    process.exit(1);
  }
  const chave = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!chave) {
    console.error('erro: defina SUPABASE_SERVICE_ROLE_KEY (o script precisa ler o banco para comparar)');
    process.exit(1);
  }

  const linhasCsv = lerCsv(readFileSync(arquivo, 'utf8'));
  // O cabeçalho nem sempre é a primeira linha: a planilha tem uma linha de
  // totais em cima. Procura a primeira linha que tenha Categoria e data.
  const iCabecalho = linhasCsv.findIndex((l) => {
    const { indice } = mapearColunas(l);
    return indice.categoria != null && indice.data != null && indice.valor_caixa != null;
  });
  if (iCabecalho < 0) { console.error('erro: não achei o cabeçalho no CSV — é a aba certa?'); process.exit(1); }
  const { indice, faltando } = mapearColunas(linhasCsv[iCabecalho]);
  if (faltando.length) console.warn(`aviso: colunas não encontradas: ${faltando.join(', ')}`);

  const daPlanilha = [];
  for (let i = iCabecalho + 1; i < linhasCsv.length; i++) {
    const campos = linhasCsv[i];
    if (!campos.some((c) => String(c ?? '').trim())) continue;
    daPlanilha.push(montarLinha(campos, indice, i + 1));
  }

  const doBanco = await buscarDoBanco(chave);
  const plano = planejar(daPlanilha, doBanco);

  const soma = (ls, campo = 'valor_caixa') =>
    ls.reduce((t, l) => t + (Number(l[campo]) || 0), 0)
      .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  console.log(`planilha: ${daPlanilha.length} linhas · banco: ${doBanco.length} linhas`);
  console.log(`  inalteradas: ${plano.iguais.length}`);
  console.log(`  atualizar:   ${plano.atualizar.length}  (${soma(plano.atualizar.map((a) => a.linha))})`);
  console.log(`  inserir:     ${plano.inserir.length}  (${soma(plano.inserir)})${inserirNovas || arquivoSql ? '' : ' — use --inserir'}`);
  console.log(`  apagar:      ${plano.apagar.length}  (${soma(plano.apagar)})${apagarSumidas || arquivoSql ? '' : ' — use --apagar'}`);

  // Apagar linha já conciliada joga fora trabalho manual: avisa sempre, alto.
  const conciliadas = plano.apagar.filter((l) => l.parte_id != null);
  if (conciliadas.length) {
    console.log(`  ATENÇÃO: ${conciliadas.length} das linhas a apagar têm conciliação de parte (parte_id) — o vínculo se perde.`);
  }
  const marcadas = plano.apagar.filter((l) => l.tem_data_pagamento === false);
  if (marcadas.length) {
    console.log(`  nota: ${marcadas.length} das linhas a apagar estavam marcadas como condenação (tem_data_pagamento=false).`);
  }

  const total = daPlanilha.length;
  const resultado = doBanco.length - (apagarSumidas ? plano.apagar.length : 0)
    + (inserirNovas ? plano.inserir.length : 0);
  if (apagarSumidas && inserirNovas && resultado !== total) {
    console.log(`  AVISO: o banco ficaria com ${resultado} linhas e a planilha tem ${total} — confira antes de aplicar.`);
  }

  if (arquivoSql) {
    writeFileSync(arquivoSql, gerarSql(plano));
    console.log(`\nSQL escrito em ${arquivoSql} (nada foi aplicado).`);
    return;
  }
  if (seco) { console.log('\n--dry-run: nada foi escrito.'); return; }

  if (apagarSumidas && plano.apagar.length) {
    const ids = plano.apagar.map((l) => l.id);
    await enviar(chave, 'DELETE', `${TABELA}?id=in.(${ids.join(',')})`);
    console.log(`apagadas: ${ids.length}`);
  }
  let n = 0;
  for (const { id, linha } of plano.atualizar) {
    const corpo = {};
    for (const c of ATUALIZAVEIS) corpo[c] = linha[c];
    await enviar(chave, 'PATCH', `${TABELA}?id=eq.${id}`, corpo);
    if (++n % 100 === 0) console.log(`  ...${n}/${plano.atualizar.length} atualizadas`);
  }
  console.log(`atualizadas: ${n}`);
  if (inserirNovas && plano.inserir.length) {
    for (let k = 0; k < plano.inserir.length; k += LOTE) {
      await enviar(chave, 'POST', TABELA, plano.inserir.slice(k, k + LOTE));
    }
    console.log(`inseridas: ${plano.inserir.length}`);
  }
}

// Só executa quando chamado direto: importar este arquivo (no teste) não pode
// disparar a carga.
if (process.argv[1] && process.argv[1].endsWith('import-lancamentos-planilha.mjs')) {
  main().catch((e) => { console.error('erro:', e.message); process.exit(1); });
}
