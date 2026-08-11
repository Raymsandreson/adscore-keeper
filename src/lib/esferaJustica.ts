// =============================================================================
// Esfera / ramo da Justiça de um processo — usado pelo filtro do sino de
// atualizações (ProcessUpdatesBell) pra separar o que é da equipe Trabalhista
// do que é Previdenciário (JF), Administrativo (INSS) e Justiça Comum.
//
// A fonte primária é o dígito J do número CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO),
// que é determinístico: 4 = Justiça Federal, 5 = Justiça do Trabalho,
// 8 = Justiça Estadual. Só a separação "previdenciário x cível" dentro da
// Federal depende de assunto/área, porque o número não carrega matéria.
//
// Módulo puro — sem I/O, mesma régua usada no backfill SQL da migration
// 20260811210000_process_update_esfera_e_notificacao.sql e no espelho Deno
// supabase/functions/_shared/esferaJustica.ts. Mexeu numa, mexe nas três.
// =============================================================================

export type Esfera =
  | 'trabalhista'
  | 'federal_prev'
  | 'federal_civel'
  | 'comum'
  | 'administrativo_prev'
  | 'administrativo'
  | 'outros';

export const ESFERAS: Record<Esfera, { label: string; curto: string }> = {
  trabalhista: { label: 'Justiça do Trabalho', curto: 'Trabalhista' },
  federal_prev: { label: 'Justiça Federal — Previdenciário', curto: 'Prev. JF' },
  federal_civel: { label: 'Justiça Federal', curto: 'Federal' },
  comum: { label: 'Justiça Comum (Estadual)', curto: 'Comum' },
  administrativo_prev: { label: 'Administrativo Previdenciário (INSS)', curto: 'Adm. Prev.' },
  administrativo: { label: 'Administrativo', curto: 'Administrativo' },
  outros: { label: 'Outros', curto: 'Outros' },
};

/** Ordem de exibição dos chips de filtro. */
export const ESFERA_ORDER: Esfera[] = [
  'trabalhista', 'federal_prev', 'administrativo_prev', 'comum', 'federal_civel', 'administrativo', 'outros',
];

function normalize(s: string | null | undefined): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Dígito J (ramo da Justiça) do número CNJ. Mesma extração do processStations. */
export function ramoFromCnj(numeroCnj: string | null | undefined): string | null {
  const m = (numeroCnj || '').match(/\d{7}-?\d{2}\.\d{4}\.(\d)\./);
  return m ? m[1] : null;
}

const PREV_RE = /previdenc|bpc|loas|auxilio|aposentad|pensao|incapacidade|maternidade|inss|beneficio assistencial|rural/;

/** Matéria previdenciária a partir de área/assuntos/classe/tipo do caso. */
function ehPrevidenciario(...campos: Array<string | null | undefined>): boolean {
  return PREV_RE.test(normalize(campos.filter(Boolean).join(' ')));
}

export interface EsferaInput {
  numeroCnj?: string | null;
  /** lead_processes.process_type: 'judicial' | 'administrativo'. */
  processType?: string | null;
  area?: string | null;
  assuntos?: string[] | null;
  classe?: string | null;
  /** case_type do lead — melhor sinal de matéria quando o processo veio sem área. */
  caseType?: string | null;
}

/**
 * Classifica o processo numa esfera.
 *
 * Regra (definida com o Raym em 11/08/2026):
 *   J=5                          → trabalhista
 *   J=4 + matéria previdenciária → federal_prev
 *   J=4                          → federal_civel
 *   J=8                          → comum (inclui prev. por competência delegada)
 *   administrativo + prev.       → administrativo_prev
 *   administrativo               → administrativo
 *   resto (STF/STJ/eleitoral/militar, ou sem número)  → outros
 *
 * `process_type` vence o CNJ só quando NÃO há número judicial: processo
 * cadastrado como administrativo que já virou ação tem CNJ e deve ser julgado
 * pelo ramo do número.
 */
export function classificarEsfera(input: EsferaInput): Esfera {
  const prev = ehPrevidenciario(
    input.area,
    (input.assuntos || []).join(' '),
    input.classe,
    input.caseType,
  );
  const ramo = ramoFromCnj(input.numeroCnj);

  if (ramo === '5') return 'trabalhista';
  if (ramo === '4') return prev ? 'federal_prev' : 'federal_civel';
  if (ramo === '8') return 'comum';
  if (ramo) return 'outros'; // 1 STF, 2 CNJ, 3 STJ, 6 eleitoral, 7/9 militar

  if (normalize(input.processType) === 'administrativo') {
    return prev ? 'administrativo_prev' : 'administrativo';
  }
  return 'outros';
}
