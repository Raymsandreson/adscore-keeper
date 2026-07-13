import {
  Gavel, CalendarClock, Stethoscope, Timer, FileText, CircleDot, type LucideIcon,
} from 'lucide-react';
import type { UpdateCategoria } from '@/hooks/useProcessUpdates';

export interface CategoriaStyle {
  label: string;
  icon: LucideIcon;
  badge: string;
  dot: string;
  borda?: string;
}

/** Visual das categorias do feed processual — usado no sino e na aba de movimentações. */
export const CATEGORIAS: Record<UpdateCategoria, CategoriaStyle> = {
  decisao_merito: {
    label: 'Decisão de mérito',
    icon: Gavel,
    badge: 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-700',
    dot: 'bg-purple-500',
    borda: 'border-l-purple-500',
  },
  audiencia: {
    label: 'Audiência',
    icon: CalendarClock,
    badge: 'bg-green-100 text-green-800 border-green-300 dark:bg-green-950/40 dark:text-green-300 dark:border-green-700',
    dot: 'bg-green-500',
    borda: 'border-l-green-500',
  },
  pericia: {
    label: 'Perícia',
    icon: Stethoscope,
    badge: 'bg-cyan-100 text-cyan-800 border-cyan-300 dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-700',
    dot: 'bg-cyan-500',
    borda: 'border-l-cyan-500',
  },
  prazo: {
    label: 'Prazo / intimação',
    icon: Timer,
    badge: 'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-950/40 dark:text-yellow-300 dark:border-yellow-700',
    dot: 'bg-yellow-500',
  },
  despacho: {
    label: 'Despacho',
    icon: FileText,
    badge: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-700',
    dot: 'bg-blue-500',
  },
  movimentacao: {
    label: 'Movimentação',
    icon: CircleDot,
    badge: 'bg-muted text-muted-foreground border-border',
    dot: 'bg-muted-foreground/50',
  },
};
