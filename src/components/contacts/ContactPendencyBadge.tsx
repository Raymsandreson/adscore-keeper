/**
 * Etiqueta informativa de pendência do contato.
 *
 * Fica onde o contato aparece (ficha e listas) e responde a pergunta que antes
 * exigia abrir a conversa: "temos algo em aberto com essa pessoa?". Clicando,
 * abre a conversa já com o painel de pendências expandido.
 */
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, Clock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PendencySummary } from '@/hooks/useContactsPendencies';

interface Props {
  summary?: PendencySummary;
  loading?: boolean;
  /** Mostra "Sem pendências" quando não há nada em aberto. */
  showWhenEmpty?: boolean;
  onClick?: () => void;
  className?: string;
}

export function ContactPendencyBadge({ summary, loading, showWhenEmpty, onClick, className }: Props) {
  const open = summary?.open || 0;
  const overdue = summary?.overdue || 0;

  if (loading && open === 0) {
    if (!showWhenEmpty) return null;
    return (
      <Badge variant="outline" className={cn('text-[10px] gap-1 px-1.5 py-0 font-normal', className)}>
        <Loader2 className="h-3 w-3 animate-spin" />
        Pendências
      </Badge>
    );
  }

  if (open === 0 && !showWhenEmpty) return null;

  const label =
    open === 0
      ? 'Sem pendências'
      : overdue > 0
        ? `${open} pendência${open > 1 ? 's' : ''} · ${overdue} vencida${overdue > 1 ? 's' : ''}`
        : `${open} pendência${open > 1 ? 's' : ''}`;

  const Icon = open === 0 ? CheckCircle2 : overdue > 0 ? AlertTriangle : Clock;

  const tone =
    open === 0
      ? 'text-muted-foreground'
      : overdue > 0
        ? 'border-destructive/40 bg-destructive/10 text-destructive'
        : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400';

  const badge = (
    <Badge
      variant="outline"
      className={cn('text-[10px] gap-1 px-1.5 py-0 font-normal', tone, onClick && 'hover:brightness-95', className)}
    >
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );

  if (!onClick) return badge;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={open === 0 ? 'Abrir pendências deste contato' : 'Ver e tratar as pendências'}
      className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {badge}
    </button>
  );
}
