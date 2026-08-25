/**
 * Qual peça dos autos sustenta este número.
 *
 * A conferência mostra marco, valor por parte e pagamento. Até 24/08/2026 o
 * único caminho para ver a prova era um link `target="_blank"` para o site do
 * tribunal — que joga a pessoa para fora do app e, pior, só existia para
 * decisão. Marco e pagamento não tinham prova nenhuma.
 *
 * Agora temos os autos: `jm_documentos` guarda a peça e `storage_path` aponta
 * para o PDF no bucket privado `jm-autos`. Medido no caso 88
 * (0011351-63.2022.5.15.0031) em 24/08: 140 peças, 118 RESTRITAS, todas
 * arquivadas. A prova está em casa — falta ligar o número a ela.
 *
 * ── O casamento é pela DATA, e isso tem limite
 *
 *    Não existe chave ligando `jm_valores`/`jm_pagamentos` a `jm_documentos`.
 *    O que há em comum é a data. Casar por data exata é o único critério que
 *    não inventa vínculo: a decisão de 10/04/2024 casa com a peça juntada em
 *    10/04/2024.
 *
 *    Comprovante de pagamento, porém, costuma ser juntado DEPOIS do pagamento.
 *    Por isso a janela é parâmetro, e cada resultado carrega `distanciaDias` e
 *    `exata` — a tela precisa poder dizer "peça do mesmo dia" e "peça de 3 dias
 *    depois" com palavras diferentes. Anexar peça errada a um valor é pior que
 *    não anexar nada: vira prova falsa de um número.
 *
 * ── Só entra o que dá para abrir
 *
 *    Peça sem `storage_path` não foi baixada. Oferecer botão que não abre nada
 *    é pior que não oferecer botão.
 */

export interface PecaDoProcesso {
  id: number;
  titulo: string | null;
  /** PUBLICO ou RESTRITO. O restrito só existe depois dos autos com certificado. */
  tipo: string | null;
  dataDocumento: string | null;
  storagePath: string | null;
  paginas: number | null;
  /** `manual` = anexada por alguém e, só por isso, apagável. */
  origem?: string | null;
  /** Preenchido = fora do casamento e da tela; o arquivo continua no bucket. */
  ocultaEm?: string | null;
  ocultaMotivo?: string | null;
}

/** Para que número a peça está sendo procurada — muda o desempate por título. */
export type AssuntoPeca = 'DECISAO' | 'PAGAMENTO' | 'MARCO';

export interface PecaCasada extends PecaDoProcesso {
  /** Dias entre a data do número e a da peça. Negativo = peça anterior. */
  distanciaDias: number;
  exata: boolean;
  /** true = o título bate com o assunto procurado (sentença, comprovante...). */
  tituloBate: boolean;
}

/**
 * Palavras que fazem uma peça ser A peça daquele número. Vieram dos títulos
 * reais que o TRT15 devolveu no caso 88 — não de um vocabulário imaginado.
 */
const PALAVRAS: Record<AssuntoPeca, string[]> = {
  DECISAO: ['sentenca', 'acordao', 'decisao', 'homologa', 'acordo', 'julgamento', 'liquidacao'],
  PAGAMENTO: ['comprovante', 'alvara', 'guia', 'deposito', 'planilha', 'calculo', 'recibo',
    'pagamento', 'transferencia', 'peticao'],
  MARCO: ['sentenca', 'acordao', 'decisao', 'certidao', 'transito', 'homologa', 'acordo',
    'despacho', 'peticao', 'ata'],
};

const semAcento = (v: string) =>
  v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Dias entre duas datas ISO. null quando qualquer uma faltar. */
export function distanciaEmDias(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ta = Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  const tb = Date.parse(`${b.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.round((tb - ta) / 86400000);
}

export function tituloBateCom(titulo: string | null, assunto: AssuntoPeca): boolean {
  if (!titulo) return false;
  const t = semAcento(titulo);
  return PALAVRAS[assunto].some((p) => t.includes(p));
}

/**
 * As peças que podem sustentar um número datado, da mais provável para a menos.
 *
 * `janelaDias` = 0 devolve só as do mesmo dia. Maior que zero admite peças
 * juntadas depois (comprovante), nunca antes — documento anterior ao fato não
 * o comprova.
 */
export function pecasParaData(
  pecas: PecaDoProcesso[],
  data: string | null,
  opts: { assunto?: AssuntoPeca; janelaDias?: number } = {},
): PecaCasada[] {
  if (!data) return [];
  const assunto = opts.assunto ?? 'MARCO';
  const janela = Math.max(0, opts.janelaDias ?? 0);

  return (pecas ?? [])
    .filter((p) => p.storagePath) // só o que dá para abrir
    .map((p) => {
      const d = distanciaEmDias(data, p.dataDocumento);
      return d == null ? null : {
        ...p,
        distanciaDias: d,
        exata: d === 0,
        tituloBate: tituloBateCom(p.titulo, assunto),
      };
    })
    .filter((p): p is PecaCasada => p != null && p.distanciaDias >= 0 && p.distanciaDias <= janela)
    .sort((a, b) =>
      // Mesmo dia antes de qualquer outro; título que bate antes do que não bate;
      // e, empatado, a peça com mais páginas — a íntegra antes da intimação.
      Number(b.exata) - Number(a.exata) ||
      a.distanciaDias - b.distanciaDias ||
      Number(b.tituloBate) - Number(a.tituloBate) ||
      (b.paginas ?? 0) - (a.paginas ?? 0),
    );
}

/** A peça a abrir quando a tela só tem espaço para um botão. */
export function melhorPeca(
  pecas: PecaDoProcesso[],
  data: string | null,
  opts: { assunto?: AssuntoPeca; janelaDias?: number } = {},
): PecaCasada | null {
  return pecasParaData(pecas, data, opts)[0] ?? null;
}

/** Rótulo honesto do vínculo: a tela nunca deve dizer "a peça" sobre um palpite. */
export function rotuloDaPeca(p: PecaCasada): string {
  const nome = p.titulo || 'Peça dos autos';
  if (p.exata) return nome;
  const d = p.distanciaDias;
  return `${nome} — juntada ${d} dia${d === 1 ? '' : 's'} depois`;
}
