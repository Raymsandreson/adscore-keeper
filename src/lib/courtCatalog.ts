/**
 * Catálogo de tribunais e vocabulário controlado dos contatos de vara/tribunal.
 *
 * Existe para o cadastro parar de virar texto livre: o operador escolhe o
 * tribunal e o ramo/UF saem de graça. O que está aqui é fechado (24 TRTs,
 * 6 TRFs, 27 TJs, 27 TREs, superiores) mais os pontos não-judiciais que hoje
 * caíam no balaio "Outro" — INSS/APS, PGF, CEJUSC, perito, cartório.
 */

import type { CourtBranch } from './cnj';
import { TRT_UFS, TRF_UFS } from './cnj';

export type { CourtBranch };

/** Nível na estrutura judiciária — responde "que instância é". */
export type CourtDegree =
  | 'primeiro'
  | 'jef'
  | 'turma_recursal'
  | 'segundo'
  | 'superior'
  | 'nao_aplica';

/** Tipo do ponto de contato — responde "com quem eu falo". */
export type ContactType =
  | 'secretaria'
  | 'gabinete'
  | 'central'
  | 'distribuicao'
  | 'oficial'
  | 'pericia'
  | 'outro';

export type PreferredChannel = 'phone' | 'whatsapp' | 'email';

export interface CourtCatalogEntry {
  code: string;
  name: string;
  branch: CourtBranch;
  ufs: string[];
}

export const UF_LIST = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
] as const;

const UF_NAMES: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia',
  CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás',
  MA: 'Maranhão', MG: 'Minas Gerais', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso',
  PA: 'Pará', PB: 'Paraíba', PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná',
  RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RO: 'Rondônia', RR: 'Roraima',
  RS: 'Rio Grande do Sul', SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo',
  TO: 'Tocantins',
};

export const ufName = (uf: string) => UF_NAMES[uf] || uf;

/** Rótulo das regiões do Trabalho que não coincidem com uma UF inteira. */
const TRT_LABEL_OVERRIDE: Record<number, string> = {
  2: 'São Paulo (capital e Grande SP)',
  15: 'São Paulo (interior — Campinas)',
};

const TRTS: CourtCatalogEntry[] = Object.entries(TRT_UFS).map(([n, ufs]) => {
  const num = Number(n);
  return {
    code: `TRT${num}`,
    name: `TRT ${num}ª Região — ${TRT_LABEL_OVERRIDE[num] || ufs.map(ufName).join(' e ')}`,
    branch: 'trabalhista' as const,
    ufs,
  };
});

const TRFS: CourtCatalogEntry[] = Object.entries(TRF_UFS).map(([n, ufs]) => ({
  code: `TRF${Number(n)}`,
  name: `TRF ${Number(n)}ª Região — ${ufs.join(', ')}`,
  branch: 'federal' as const,
  ufs,
}));

const TJS: CourtCatalogEntry[] = UF_LIST.map((uf) => ({
  code: uf === 'DF' ? 'TJDFT' : `TJ${uf}`,
  name: uf === 'DF'
    ? 'TJDFT — Distrito Federal e Territórios'
    : `TJ${uf} — ${ufName(uf)}`,
  branch: 'estadual' as const,
  ufs: [uf],
}));

const TRES: CourtCatalogEntry[] = UF_LIST.map((uf) => ({
  code: `TRE-${uf}`,
  name: `TRE-${uf} — ${ufName(uf)}`,
  branch: 'eleitoral' as const,
  ufs: [uf],
}));

const SUPERIORES: CourtCatalogEntry[] = [
  { code: 'STF', name: 'STF — Supremo Tribunal Federal', branch: 'superior', ufs: [] },
  { code: 'STJ', name: 'STJ — Superior Tribunal de Justiça', branch: 'superior', ufs: [] },
  { code: 'TST', name: 'TST — Tribunal Superior do Trabalho', branch: 'superior', ufs: [] },
  { code: 'TSE', name: 'TSE — Tribunal Superior Eleitoral', branch: 'superior', ufs: [] },
  { code: 'STM', name: 'STM — Superior Tribunal Militar', branch: 'superior', ufs: [] },
];

/** Pontos que não são judiciários mas entram na mesma cobrança do dia a dia. */
const EXTRAJUDICIAIS: CourtCatalogEntry[] = [
  { code: 'INSS', name: 'INSS — APS / Agência', branch: 'extrajudicial', ufs: [] },
  { code: 'PGF', name: 'PGF — Procuradoria-Geral Federal', branch: 'extrajudicial', ufs: [] },
  { code: 'AGU', name: 'AGU — Advocacia-Geral da União', branch: 'extrajudicial', ufs: [] },
  { code: 'MPF', name: 'MPF — Ministério Público Federal', branch: 'extrajudicial', ufs: [] },
  { code: 'MPT', name: 'MPT — Ministério Público do Trabalho', branch: 'extrajudicial', ufs: [] },
  { code: 'CEJUSC', name: 'CEJUSC — Centro de Conciliação', branch: 'extrajudicial', ufs: [] },
  { code: 'CARTORIO', name: 'Cartório / Serventia extrajudicial', branch: 'extrajudicial', ufs: [] },
  { code: 'PERITO', name: 'Perito / Central de perícias', branch: 'extrajudicial', ufs: [] },
  { code: 'OUTRO', name: 'Outro órgão', branch: 'extrajudicial', ufs: [] },
];

export const COURT_CATALOG: CourtCatalogEntry[] = [
  ...TRTS, ...TRFS, ...TJS, ...TRES, ...SUPERIORES, ...EXTRAJUDICIAIS,
];

const CATALOG_BY_CODE = new Map(COURT_CATALOG.map((c) => [c.code, c]));

export const findCourt = (code: string | null | undefined): CourtCatalogEntry | null =>
  (code && CATALOG_BY_CODE.get(code)) || null;

export const courtsForBranch = (branch: CourtBranch | 'todos'): CourtCatalogEntry[] =>
  branch === 'todos' ? COURT_CATALOG : COURT_CATALOG.filter((c) => c.branch === branch);

export const BRANCH_OPTIONS: { value: CourtBranch; label: string; short: string }[] = [
  { value: 'trabalhista', label: 'Trabalhista', short: 'Trab.' },
  { value: 'federal', label: 'Federal', short: 'Fed.' },
  { value: 'estadual', label: 'Estadual', short: 'Est.' },
  { value: 'eleitoral', label: 'Eleitoral', short: 'Eleit.' },
  { value: 'militar', label: 'Militar', short: 'Mil.' },
  { value: 'superior', label: 'Superior', short: 'Sup.' },
  { value: 'extrajudicial', label: 'Extrajudicial / Administrativo', short: 'Extraj.' },
];

export const DEGREE_OPTIONS: { value: CourtDegree; label: string; short: string }[] = [
  { value: 'primeiro', label: '1º grau', short: '1º grau' },
  { value: 'jef', label: 'JEF / Juizado', short: 'JEF' },
  { value: 'turma_recursal', label: 'Turma Recursal', short: 'T. Recursal' },
  { value: 'segundo', label: '2º grau', short: '2º grau' },
  { value: 'superior', label: 'Superior', short: 'Superior' },
  { value: 'nao_aplica', label: 'Não se aplica', short: '—' },
];

export const CONTACT_TYPE_OPTIONS: { value: ContactType; label: string }[] = [
  { value: 'secretaria', label: 'Secretaria' },
  { value: 'gabinete', label: 'Gabinete' },
  { value: 'central', label: 'Central de atendimento' },
  { value: 'distribuicao', label: 'Distribuição' },
  { value: 'oficial', label: 'Oficial de justiça' },
  { value: 'pericia', label: 'Perícia' },
  { value: 'outro', label: 'Outro' },
];

export const CHANNEL_OPTIONS: { value: PreferredChannel; label: string }[] = [
  { value: 'phone', label: 'Telefone' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'E-mail' },
];

const labelFrom = <T extends string>(
  options: { value: T; label: string; short?: string }[],
  value: string | null | undefined,
  short = false,
) => {
  const found = options.find((o) => o.value === value);
  if (!found) return null;
  return (short && found.short) || found.label;
};

export const branchLabel = (v: string | null | undefined, short = false) =>
  labelFrom(BRANCH_OPTIONS, v, short);
export const degreeLabel = (v: string | null | undefined, short = false) =>
  labelFrom(DEGREE_OPTIONS, v, short);
export const contactTypeLabel = (v: string | null | undefined) =>
  labelFrom(CONTACT_TYPE_OPTIONS, v);
export const channelLabel = (v: string | null | undefined) =>
  labelFrom(CHANNEL_OPTIONS, v);

/**
 * Normaliza o nome da unidade para agrupar pontos de contato do mesmo lugar
 * ("6ª Vara Cível da Comarca de Teresina" e "Gabinete da 6ª Vara Cível de
 * Teresina" precisam cair na mesma chave). Conservador de propósito: tira
 * acento, pontuação, ordinal e as preposições de ligação — não tenta adivinhar
 * sinônimos, porque fundir unidades distintas é pior que deixar duas separadas.
 */
export function normalizeUnitName(raw: string): string {
  return String(raw || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[ºª°]/g, '')
    .replace(/\bgabinete\b|\bsecretaria\b|\bcartorio\b/g, '')
    .replace(/\bda comarca de\b|\bda comarca\b|\bcomarca de\b/g, ' ')
    .replace(/\bde\b|\bda\b|\bdo\b|\bdas\b|\bdos\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

/** Chave de agrupamento: tribunal + unidade normalizada. */
export const buildUnitKey = (
  courtCode: string | null | undefined,
  unitName: string | null | undefined,
): string | null => {
  const slug = normalizeUnitName(unitName || '');
  if (!slug) return null;
  return `${courtCode || 'SEM-TRIBUNAL'}:${slug}`;
};

/**
 * Gabinete de desembargador é contato volátil — magistrado é promovido, muda de
 * câmara, se aposenta. Secretaria de vara é estável. Só o volátil envelhece.
 */
export const CONFIRMATION_STALE_DAYS = 365;

export function isContactStale(
  contactType: string | null | undefined,
  lastConfirmedAt: string | null | undefined,
  createdAt: string | null | undefined,
): boolean {
  if (contactType !== 'gabinete') return false;
  const ref = lastConfirmedAt || createdAt;
  if (!ref) return false;
  const days = (Date.now() - new Date(ref).getTime()) / 86_400_000;
  return days > CONFIRMATION_STALE_DAYS;
}
