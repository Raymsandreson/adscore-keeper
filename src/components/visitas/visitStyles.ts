import type { SocialVisitStatus } from '@/hooks/useSocialVisits';

export const VISIT_STATUS_LABELS: Record<SocialVisitStatus, string> = {
  agendada: 'Agendada',
  confirmada: 'Confirmada',
  realizada: 'Realizada',
  remarcada: 'Remarcada',
  cancelada: 'Cancelada',
};

export const VISIT_STATUS_ORDER: SocialVisitStatus[] = [
  'agendada',
  'confirmada',
  'realizada',
  'remarcada',
  'cancelada',
];

export function visitStatusBadgeClass(status: SocialVisitStatus) {
  switch (status) {
    case 'agendada':
      return 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900';
    case 'confirmada':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900';
    case 'realizada':
      return 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900';
    case 'remarcada':
      return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900';
    case 'cancelada':
      return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900';
  }
}

/**
 * Cor por assistente social. Ler a semana é ler "quem está onde": a mesma
 * pessoa precisa da mesma cor em todas as visões, sem cadastro de cor.
 * As classes são literais de propósito — o Tailwind não gera classe montada
 * em runtime.
 */
const WORKER_PALETTE = [
  { bg: 'bg-sky-50 dark:bg-sky-950/30', border: 'border-l-sky-500', text: 'text-sky-700 dark:text-sky-300', dot: 'bg-sky-500' },
  { bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-l-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' },
  { bg: 'bg-violet-50 dark:bg-violet-950/30', border: 'border-l-violet-500', text: 'text-violet-700 dark:text-violet-300', dot: 'bg-violet-500' },
  { bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-l-amber-500', text: 'text-amber-700 dark:text-amber-300', dot: 'bg-amber-500' },
  { bg: 'bg-rose-50 dark:bg-rose-950/30', border: 'border-l-rose-500', text: 'text-rose-700 dark:text-rose-300', dot: 'bg-rose-500' },
  { bg: 'bg-teal-50 dark:bg-teal-950/30', border: 'border-l-teal-500', text: 'text-teal-700 dark:text-teal-300', dot: 'bg-teal-500' },
  { bg: 'bg-indigo-50 dark:bg-indigo-950/30', border: 'border-l-indigo-500', text: 'text-indigo-700 dark:text-indigo-300', dot: 'bg-indigo-500' },
  { bg: 'bg-orange-50 dark:bg-orange-950/30', border: 'border-l-orange-500', text: 'text-orange-700 dark:text-orange-300', dot: 'bg-orange-500' },
];

/** Normaliza para a cor não mudar por acento, caixa ou espaço sobrando. */
export function normalizeWorkerKey(name: string | null | undefined): string {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function workerColor(name: string | null | undefined) {
  const key = normalizeWorkerKey(name);
  if (!key) return WORKER_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return WORKER_PALETTE[hash % WORKER_PALETTE.length];
}

/** "14:30:00" → "14:30"; sem hora devolve string vazia. */
export function fmtVisitTime(time?: string | null) {
  if (!time) return '';
  return time.slice(0, 5);
}

/** Primeiro nome + inicial do sobrenome: cabe no card sem cortar no meio. */
export function shortWorkerName(name: string | null | undefined) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}
