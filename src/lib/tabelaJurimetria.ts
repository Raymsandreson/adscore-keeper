/**
 * A tabela crua da carteira — `jm_partes`, que é a aba Tab. Aux da planilha.
 *
 * Existe para responder "confere o que está no sistema" sem sair para o Google
 * Sheets. Filtro, ordenação e CSV são lógica pura aqui; a página só desenha.
 *
 * ATENÇÃO ao que estes números são: as colunas com **CJCM** já vêm com juros e
 * correção monetária aplicados pela planilha. Não são nominais e não devem ser
 * multiplicados por índice nenhum.
 */

export interface LinhaTabela {
  parteId: string;
  processo: string | null;
  cliente: string | null;
  uf: string | null;
  cidade: string | null;
  status: string | null;
  fase: string | null;
  termoInicial: string | null;
  condenacao: number | null;
  cota: number | null;
  cotaVista: number | null;
  hcVista: number | null;
  hcParcelado: number | null;
  hs: number | null;
  importadoEm: string | null;
}

export interface FiltroTabela {
  /** Busca livre: processo, cliente, status, fase, cidade. */
  busca: string;
  status: string | null;
  fase: string | null;
  uf: string | null;
  /** 'com' = só partes com condenação; 'sem' = só as sem; null = todas. */
  valor: 'com' | 'sem' | null;
}

export const FILTRO_VAZIO: FiltroTabela = { busca: '', status: null, fase: null, uf: null, valor: null };

const texto = (v: unknown): string | null => {
  const s = v == null ? '' : String(v).trim();
  return s === '' ? null : s;
};
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Linha crua de `jm_partes` — o client externo não é tipado. */
export function montarLinha(row: Record<string, unknown>): LinhaTabela {
  return {
    parteId: String(row.parte_id ?? ''),
    processo: texto(row.processo_cnj),
    cliente: texto(row.cliente),
    uf: texto(row.uf_mora),
    cidade: texto(row.cidade_mora),
    status: texto(row.status_pagamento),
    fase: texto(row.fase_atual),
    termoInicial: texto(row.termo_inicial_jcm),
    condenacao: num(row.condenacao_cjcm),
    cota: num(row.cota_parte_cjcm),
    cotaVista: num(row.cota_parte_vista_cjcm),
    hcVista: num(row.hc_vista),
    hcParcelado: num(row.hc_parcelado),
    hs: num(row.hs),
    importadoEm: texto(row.valores_importados_em),
  };
}

/** Honorário do escritório na parte: contratual (vencido + vincendo) + sucumbencial. */
export const honorarioDaLinha = (l: LinhaTabela) =>
  Math.round(((l.hcVista ?? 0) + (l.hcParcelado ?? 0) + (l.hs ?? 0)) * 100) / 100;

/**
 * Normaliza para busca: sem acento, minúsculo. Sem isso "João" não acha "joao",
 * que é como metade dos nomes está digitada na planilha.
 */
const chave = (v: string) =>
  v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function filtrar(linhas: LinhaTabela[], f: FiltroTabela): LinhaTabela[] {
  const termos = chave(f.busca).split(/\s+/).filter(Boolean);
  return linhas.filter(l => {
    if (f.status && l.status !== f.status) return false;
    if (f.fase && l.fase !== f.fase) return false;
    if (f.uf && l.uf !== f.uf) return false;
    if (f.valor === 'com' && l.condenacao == null) return false;
    if (f.valor === 'sem' && l.condenacao != null) return false;
    if (!termos.length) return true;
    // Todos os termos precisam bater em algum campo — buscar "maria pago"
    // acha a Maria que está paga, não tudo que tem "maria" ou "pago".
    const alvo = chave([
      l.parteId, l.processo, l.cliente, l.status, l.fase, l.cidade, l.uf,
    ].filter(Boolean).join(' '));
    return termos.every(t => alvo.includes(t));
  });
}

export interface TotaisTabela {
  partes: number;
  comValor: number;
  condenacao: number;
  cota: number;
  honorario: number;
}

export function totalizar(linhas: LinhaTabela[]): TotaisTabela {
  let condenacao = 0, cota = 0, honorario = 0, comValor = 0;
  for (const l of linhas) {
    if (l.condenacao != null) comValor += 1;
    condenacao += l.condenacao ?? 0;
    cota += l.cota ?? 0;
    honorario += honorarioDaLinha(l);
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { partes: linhas.length, comValor, condenacao: r(condenacao), cota: r(cota), honorario: r(honorario) };
}

/** Valores distintos de uma coluna, para montar os seletores de filtro. */
export function opcoes(linhas: LinhaTabela[], campo: 'status' | 'fase' | 'uf'): string[] {
  return [...new Set(linhas.map(l => l[campo]).filter(Boolean) as string[])].sort();
}

const CABECALHO = [
  'parte_id', 'processo', 'cliente', 'uf', 'cidade', 'status', 'fase',
  'termo_inicial_jcm', 'condenacao_cjcm', 'cota_parte_cjcm',
  'cota_parte_vista_cjcm', 'hc_vista', 'hc_parcelado', 'hs', 'honorario_total',
];

/**
 * CSV para conferir no Excel/Sheets. Separador é `;` e o decimal é vírgula —
 * é o que o Excel em português abre sem pedir nada. Ponto-e-vírgula obriga a
 * escapar o campo que o contiver, e nome de cliente contém.
 */
export function gerarCsv(linhas: LinhaTabela[]): string {
  const campo = (v: string | number | null): string => {
    if (v == null) return '';
    const s = typeof v === 'number' ? v.toFixed(2).replace('.', ',') : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const linhasCsv = linhas.map(l => [
    l.parteId, l.processo, l.cliente, l.uf, l.cidade, l.status, l.fase,
    l.termoInicial, l.condenacao, l.cota, l.cotaVista,
    l.hcVista, l.hcParcelado, l.hs, honorarioDaLinha(l),
  ].map(campo).join(';'));
  // BOM na frente: sem ele o Excel abre "José" como "JosÃ©".
  return '\uFEFF' + [CABECALHO.join(';'), ...linhasCsv].join('\r\n');
}
