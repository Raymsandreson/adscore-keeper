/**
 * Etiqueta informativa de atividades em aberto do contato.
 *
 * Par da `ContactPendencyBadge`: aquela mostra o que o cliente ficou de fazer,
 * esta mostra o que NÓS ficamos. Clicando, abre a ficha do contato já na aba
 * Atividades — que é onde dá para tratar.
 */
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ListTodo, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ActivitySummary } from '@/hooks/useContactsActivities';

interface Props {
  summary?: ActivitySummary;
  loading?: boolean;
  /** Mostra "Sem atividades" quando não há nada em aberto. */
  showWhenEmpty?: boolean;
  onClick?: () => void;
  className?: string;
}

export function ContactActivityBadge({ summary, loading, showWhenEmpty, onClick, className }: Props) {
  const open = summary?.open || 0;
  const overdue = summary?.overdue || 0;

  if (loading && open === 0) {
    if (!showWhenEmpty) return null;
    return (
      <Badge variant="outline" className={cn('text-[10px] gap-1 px-1.5 py-0 font-normal', className)}>
        <Loader2 className="h-3 w-3 animate-spin" />
        Atividades
      </Badge>
    );
  }

  if (open === 0 && !showWhenEmpty) return null;

  const label =
    open === 0
      ? 'Sem atividades'
      : overdue > 0
        ? `${open} atv · ${overdue} atrasada${overdue > 1 ? 's' : ''}`
        : `${open} atv`;

  const Icon = overdue > 0 ? AlertTriangle : ListTodo;

  const tone =
    open === 0
      ? 'text-muted-foreground'
      : overdue > 0
        ? 'border-destructive/40 bg-destructive/10 text-destructive'
        : 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400';

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
      title={open === 0 ? 'Abrir as atividades deste contato' : 'Ver e tratar as atividades'}
      className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {badge}
    </button>
  );
}
