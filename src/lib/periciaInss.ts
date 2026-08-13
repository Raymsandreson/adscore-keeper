// =============================================================================
// Perícias do Benefício INSS (médica + social) — regras puras.
//
// As duas datas moram em `lead_processes.pericia_medica_at` / `pericia_social_at`
// (migration 20260813120000). Aqui ficam só as decisões que não dependem de I/O:
// quando os campos aparecem, e a conversão entre o `timestamptz` do banco e o
// `datetime-local` do formulário.
//
// Conversão explícita porque o input HTML não carrega fuso: gravar a string
// "2026-08-14T09:20" crua faria o Postgres interpretá-la no fuso do SERVIDOR
// (UTC) e a perícia das 9h20 apareceria às 6h20 pra quem marcou.
// =============================================================================

export type PericiaCampo = 'pericia_medica_at' | 'pericia_social_at';

export const PERICIA_LABEL: Record<PericiaCampo, string> = {
  pericia_medica_at: 'Perícia médica',
  pericia_social_at: 'Perícia social',
};

function normalize(value?: string | null): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * O processo é o "Benefício INSS" do caso?
 *
 * Título literal, e não heurística de INSS/BPC/auxílio: é assim que o processo
 * nasce (724 dos 1.000 primeiros processos administrativos em 13/08/2026) e é a
 * mesma string que `processAssignment` já usa pra decidir responsável. Ampliar
 * pra qualquer título "previdenciário" traria perícia pra processo que não tem.
 */
export function isBeneficioInssProcess(title?: string | null): boolean {
  return normalize(title) === 'beneficio inss';
}

/** `timestamptz` do banco → valor de `<input type="datetime-local">` (hora local). */
export function periciaInputValue(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Valor do `<input type="datetime-local">` (hora local) → `timestamptz` pro banco. */
export function periciaIsoFromInput(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Rótulo curto do chip: "14/08/2026 09:20". */
export function formatPericia(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).replace(',', '');
}

export type PericiaTom = 'vazio' | 'futura' | 'hoje' | 'passada';

/**
 * Em que pé está a perícia, pra colorir o chip. `agora` é injetável pra teste.
 * "hoje" é o dia civil da perícia — quem abre a atividade nesse dia precisa ver
 * na hora que o cliente tem perícia marcada.
 */
export function periciaTom(iso?: string | null, agora: Date = new Date()): PericiaTom {
  if (!iso) return 'vazio';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'vazio';
  const mesmoDia = d.getFullYear() === agora.getFullYear()
    && d.getMonth() === agora.getMonth()
    && d.getDate() === agora.getDate();
  if (mesmoDia) return 'hoje';
  return d.getTime() > agora.getTime() ? 'futura' : 'passada';
}
