// =============================================================================
// Esfera / ramo da Justiça de um processo (Deno). Espelho de
// src/lib/esferaJustica.ts — o frontend não pode ser importado aqui, e o
// backfill em SQL usa a mesma régua (migration 20260811210000). Ao mexer numa
// das três, mexa nas três.
//
// Fonte primária: dígito J do CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO).
//   4 = Justiça Federal · 5 = Justiça do Trabalho · 8 = Justiça Estadual.
// Matéria (área/assuntos/classe/tipo do caso) só separa previdenciário de cível.
// =============================================================================

export type Esfera =
  | 'trabalhista'
  | 'federal_prev'
  | 'federal_civel'
  | 'comum'
  | 'administrativo_prev'
  | 'administrativo'
  | 'outros';

function normalize(s: string | null | undefined): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// "deficien" cobre o BPC/LOAS ("Pessoa com Deficiência" nos assuntos do Escavador).
const PREV_RE = /previdenc|bpc|loas|auxilio|aposentad|pensao|incapacidade|maternidade|inss|seguro social|beneficio|assistencial|deficien|rural/;

export function ramoFromCnj(numeroCnj: string | null | undefined): string | null {
  const m = (numeroCnj || '').match(/\d{7}-?\d{2}\.\d{4}\.(\d)\./);
  return m ? m[1] : null;
}

export interface EsferaInput {
  numeroCnj?: string | null;
  processType?: string | null;
  area?: string | null;
  assuntos?: string[] | null;
  classe?: string | null;
  caseType?: string | null;
  /** Título e partes — área/assuntos vêm vazios na maioria dos processos. */
  titulo?: string | null;
  poloAtivo?: string | null;
  poloPassivo?: string | null;
}

export function classificarEsfera(input: EsferaInput): Esfera {
  const prev = PREV_RE.test(normalize([
    input.area,
    (input.assuntos || []).join(' '),
    input.classe,
    input.caseType,
    input.titulo,
    input.poloAtivo,
    input.poloPassivo,
  ].filter(Boolean).join(' ')));
  const ramo = ramoFromCnj(input.numeroCnj);

  if (ramo === '5') return 'trabalhista';
  if (ramo === '4') return prev ? 'federal_prev' : 'federal_civel';
  if (ramo === '8') return 'comum';
  if (ramo) return 'outros';

  if (normalize(input.processType) === 'administrativo') {
    return prev ? 'administrativo_prev' : 'administrativo';
  }
  return 'outros';
}
