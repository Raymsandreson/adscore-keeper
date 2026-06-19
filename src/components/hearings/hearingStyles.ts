import type { HearingCategory, HearingStatus } from '@/hooks/useHearings';

export const CATEGORY_LABELS: Record<HearingCategory, string> = {
  previdenciario: 'Previdenciário',
  civel: 'Cível',
  trabalhista: 'Trabalhista',
  criminal: 'Criminal',
  outro: 'Outro',
};

export const STATUS_LABELS: Record<HearingStatus, string> = {
  ativa: 'Ativa',
  adiada: 'Adiada',
  cancelada: 'Cancelada',
  concluida: 'Concluída',
};

export const HEARING_TYPES = [
  'UNA Virtual',
  'UNA Presencial',
  'Instrução',
  'Conciliação',
  'Encerramento de Instrução',
  'Inicial Virtual',
  'Perícia Médica',
  'Outro',
];

export const TIMEZONE_OPTIONS = [
  'Padrão Brasília',
  'Horário de Manaus',
  'Horário de Cuiabá',
  'Horário do Acre',
  'Horário de Fernando de Noronha',
];

/** Tailwind classes per category using semantic tokens defined in index.css. */
export function categoryClasses(cat: HearingCategory) {
  switch (cat) {
    case 'previdenciario':
      return {
        bg: 'bg-[hsl(var(--hearing-prev-bg))]',
        border: 'border-[hsl(var(--hearing-prev))]',
        text: 'text-[hsl(var(--hearing-prev))]',
        dot: 'bg-[hsl(var(--hearing-prev))]',
      };
    case 'civel':
      return {
        bg: 'bg-[hsl(var(--hearing-civel-bg))]',
        border: 'border-[hsl(var(--hearing-civel))]',
        text: 'text-[hsl(var(--hearing-civel))]',
        dot: 'bg-[hsl(var(--hearing-civel))]',
      };
    case 'trabalhista':
      return {
        bg: 'bg-[hsl(var(--hearing-trabalhista-bg))]',
        border: 'border-[hsl(var(--hearing-trabalhista))]',
        text: 'text-[hsl(var(--hearing-trabalhista))]',
        dot: 'bg-[hsl(var(--hearing-trabalhista))]',
      };
    case 'criminal':
      return {
        bg: 'bg-[hsl(var(--hearing-criminal-bg))]',
        border: 'border-[hsl(var(--hearing-criminal))]',
        text: 'text-[hsl(var(--hearing-criminal))]',
        dot: 'bg-[hsl(var(--hearing-criminal))]',
      };
    default:
      return {
        bg: 'bg-[hsl(var(--hearing-outro-bg))]',
        border: 'border-[hsl(var(--hearing-outro))]',
        text: 'text-[hsl(var(--hearing-outro))]',
        dot: 'bg-[hsl(var(--hearing-outro))]',
      };
  }
}

export function statusBadgeClass(status: HearingStatus) {
  switch (status) {
    case 'ativa':
      return 'bg-success/10 text-success border-success/20';
    case 'adiada':
      return 'bg-warning/10 text-warning border-warning/20';
    case 'cancelada':
      return 'bg-destructive/10 text-destructive border-destructive/20';
    case 'concluida':
      return 'bg-muted text-muted-foreground border-border';
  }
}

export function fmtTime(t?: string | null) {
  if (!t) return '';
  return t.slice(0, 5);
}
