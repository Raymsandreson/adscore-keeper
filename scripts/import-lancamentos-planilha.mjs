#!/usr/bin/env node
/**
 * Importa a aba "Lançamentos" da planilha CONTROLE FINANCEIRO GRUPO PRUDÊNCIO
 * para public.jm_lancamentos no Supabase Externo.
 *
 * Uso:
 *   node scripts/import-lancamentos-planilha.mjs --dry-run ~/Downloads/Lancamentos.csv
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-lancamentos-planilha.mjs ~/Downloads/Lancamentos.csv
 *
 *   --dry-run   normaliza, compara com o banco e imprime o que mudaria, sem escrever.
 *   --inserir   também INSERE as linhas da planilha que não existem no banco.
 *               Sem esta flag o script só ATUALIZA o que já está lá (mais seguro:
 *               uma exportação parcial não injeta lixo).
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
 * CHAVE: `ordem_origem` = número da linha na planilha. 4.676 dos 4.742 registros
 * têm ordem única; 66 repetem porque duas cargas distintas foram para a mesma
 * tabela (a linha 1550, por exemplo, é "HC PENSIONAMENTO/Honorários" numa e
 * "NAIRA.../Indenização" na outra). O script NÃO adivinha qual é qual: linha com
 * ordem ambígua é pulada e listada no relatório para resolver à mão.
 *
 * NUNCA sobrescreve `parte_id` nem `parte_conciliacao`: são fruto da conciliação
 * feita depois da importação (1.458 e 1.529 linhas hoje) e não existem na
 * planilha. Recarregar a planilha não pode jogar esse trabalho fora.
 */

import { readFileSync, existsSync } from 'node:fs';

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

/** Colunas que vêm da planilha e podem ser atualizadas. `parte_id` e
 *  `parte_conciliacao` de propósito FORA — são da conciliação, não da planilha. */
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
// Supabase REST
// ---------------------------------------------------------------------------
function cabecalhos(chave) {
  return { apikey: chave, Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' };
}

async function buscarExistentes(chave) {
  const porOrdem = new Map();
  const ambiguas = new Set();
  let de = 0;
  for (;;) {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/${TABELA}?select=id,ordem_origem,categoria&order=id&offset=${de}&limit=1000`,
      { headers: cabecalhos(chave) },
    );
    if (!resp.ok) throw new Error(`falha ao ler o banco: ${resp.status} ${await resp.text()}`);
    const pagina = await resp.json();
    for (const r of pagina) {
      if (r.ordem_origem == null) continue;
      if (porOrdem.has(r.ordem_origem)) ambiguas.add(r.ordem_origem);
      else porOrdem.set(r.ordem_origem, { id: r.id, categoria: r.categoria });
    }
    if (pagina.length < 1000) break;
    de += 1000;
  }
  for (const o of ambiguas) porOrdem.delete(o);
  return { porOrdem, ambiguas };
}

/**
 * "Honorários condenação" (criada em 18/08/2026) NÃO existe na planilha: as 29
 * linhas foram reclassificadas direto no banco porque carregavam a data da
 * DECISÃO dentro de "Honorários a receber" e por isso apareciam vencidas há
 * anos. Reimportar sem este guarda desfaria isso em silêncio. Enquanto a
 * planilha não tiver a categoria, o banco manda — e o script avisa quantas
 * segurou, para não virar divergência esquecida.
 */
function preservaCategoria(categoriaNoBanco, categoriaNaPlanilha) {
  return categoriaNoBanco === 'Honorários condenação'
    && String(categoriaNaPlanilha || '').toLowerCase().includes('a receber');
}

async function atualizar(chave, id, linha, categoriaNoBanco) {
  const corpo = {};
  for (const c of ATUALIZAVEIS) corpo[c] = linha[c];
  if (preservaCategoria(categoriaNoBanco, linha.categoria)) delete corpo.categoria;
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${TABELA}?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...cabecalhos(chave), Prefer: 'return=minimal' },
    body: JSON.stringify(corpo),
  });
  if (!resp.ok) throw new Error(`PATCH id=${id}: ${resp.status} ${await resp.text()}`);
}

async function inserir(chave, linhas) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${TABELA}`, {
    method: 'POST',
    headers: { ...cabecalhos(chave), Prefer: 'return=minimal' },
    body: JSON.stringify(linhas),
  });
  if (!resp.ok) throw new Error(`POST: ${resp.status} ${await resp.text()}`);
}

// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const seco = args.includes('--dry-run');
  const inserirNovas = args.includes('--inserir');
  const arquivo = args.find((a) => !a.startsWith('--'));

  if (!arquivo || !existsSync(arquivo)) {
    console.error('uso: node scripts/import-lancamentos-planilha.mjs [--dry-run] [--inserir] <arquivo.csv>');
    process.exit(1);
  }
  const chave = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!chave && !seco) {
    console.error('erro: defina SUPABASE_SERVICE_ROLE_KEY (ou rode com --dry-run)');
    process.exit(1);
  }

  const linhasCsv = lerCsv(readFileSync(arquivo, 'utf8'));
  if (linhasCsv.length < 2) { console.error('erro: CSV sem dados'); process.exit(1); }

  const { indice, faltando } = mapearColunas(linhasCsv[0]);
  if (faltando.length) console.warn(`aviso: colunas não encontradas no CSV: ${faltando.join(', ')}`);
  if (indice.categoria == null || indice.data == null) {
    console.error('erro: CSV sem as colunas Data e Categoria — é a aba certa?');
    process.exit(1);
  }

  // A linha 1 do CSV é o cabeçalho, então a linha N do CSV é a linha N da
  // planilha — é isso que `ordem_origem` guarda.
  const daPlanilha = [];
  for (let i = 1; i < linhasCsv.length; i++) {
    const campos = linhasCsv[i];
    if (!campos.some((c) => String(c ?? '').trim())) continue; // linha vazia
    daPlanilha.push(montarLinha(campos, indice, i + 1));
  }

  const comPercentual = daPlanilha.filter((l) => l.relacao_cliente).length;
  const porTipo = daPlanilha.reduce((acc, l) => {
    const k = l.tipo ?? '(sem tipo)';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  console.log(`planilha: ${daPlanilha.length} linhas`);
  console.log(`  com percentual (Relação c/ Cliente): ${comPercentual}`);
  console.log(`  tipo: ${Object.entries(porTipo).map(([k, v]) => `${k}=${v}`).join(' · ')}`);

  if (seco && !chave) {
    console.log('\n--dry-run sem chave: só validou o CSV, não comparou com o banco.');
    return;
  }

  const { porOrdem, ambiguas } = await buscarExistentes(chave);
  const paraAtualizar = daPlanilha.filter((l) => porOrdem.has(l.ordem_origem));
  const paraInserir = daPlanilha.filter((l) => !porOrdem.has(l.ordem_origem) && !ambiguas.has(l.ordem_origem));
  const puladas = daPlanilha.filter((l) => ambiguas.has(l.ordem_origem));

  console.log(`\nbanco: ${porOrdem.size} linhas com ordem única, ${ambiguas.size} ordens ambíguas`);
  console.log(`  atualizar: ${paraAtualizar.length}`);
  console.log(`  inserir:   ${paraInserir.length}${inserirNovas ? '' : ' (ignoradas — use --inserir)'}`);
  if (puladas.length) {
    console.log(`  puladas:   ${puladas.length} (ordem repetida no banco: ${[...new Set(puladas.map((l) => l.ordem_origem))].slice(0, 20).join(', ')}${puladas.length > 20 ? '…' : ''})`);
  }

  if (seco) { console.log('\n--dry-run: nada foi escrito.'); return; }

  let feitas = 0;
  let categoriasPreservadas = 0;
  for (const linha of paraAtualizar) {
    const alvo = porOrdem.get(linha.ordem_origem);
    if (preservaCategoria(alvo.categoria, linha.categoria)) categoriasPreservadas += 1;
    await atualizar(chave, alvo.id, linha, alvo.categoria);
    if (++feitas % 200 === 0) console.log(`  ...${feitas}/${paraAtualizar.length} atualizadas`);
  }
  console.log(`atualizadas: ${feitas}`);
  if (categoriasPreservadas) {
    console.log(`  ${categoriasPreservadas} mantiveram "Honorários condenação" (a planilha ainda diz "a receber")`);
  }

  if (inserirNovas && paraInserir.length) {
    for (let i = 0; i < paraInserir.length; i += LOTE) {
      await inserir(chave, paraInserir.slice(i, i + LOTE));
    }
    console.log(`inseridas: ${paraInserir.length}`);
  }
}

// Só executa quando chamado direto: importar este arquivo (no teste) não pode
// disparar a carga.
if (process.argv[1] && process.argv[1].endsWith('import-lancamentos-planilha.mjs')) {
  main().catch((e) => { console.error('erro:', e.message); process.exit(1); });
}

export { preservaCategoria };
