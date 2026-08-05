import { ClipboardCheck, AlertTriangle, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ClientCommitment } from '@/hooks/useClientCommitments';
import { kindMeta } from '@/hooks/useClientCommitments';

interface Props {
  open: ClientCommitment[];
  overdue: ClientCommitment[];
  doneCount: number;
  onOpenPanel: () => void;
  onNew: () => void;
}

/**
 * Barra fina abaixo do cabeçalho da conversa: o que o CLIENTE ficou de fazer.
 * Sem nenhuma pendência registrada, mostra só o atalho de criar — a linha some
 * do caminho em vez de ocupar espaço com "0 pendências".
 */
export function ClientCommitmentsBar({ open, overdue, doneCount, onOpenPanel, onNew }: Props) {
  const hasOpen = open.length > 0;
  const preview = open.slice(0, 3);

  return (
    <div className="w-full flex items-center gap-2 px-3 py-1.5 bg-card border-b">
      <button
        onClick={onOpenPanel}
        className="flex-1 min-w-0 flex items-center gap-2 hover:bg-accent/40 rounded px-1 py-0.5 transition-colors text-left"
        title="Pendências do cliente — o que ele ficou de fazer"
      >
        <ClipboardCheck
          className={cn('h-3.5 w-3.5 shrink-0', hasOpen ? 'text-amber-600' : 'text-muted-foreground')}
        />
        <span className="text-[10px] font-medium text-muted-foreground shrink-0">
          Cliente ficou de
        </span>

        {hasOpen ? (
          <span className="flex items-center gap-1 min-w-0 overflow-hidden">
            {preview.map((c) => (
              <span
                key={c.id}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900 truncate max-w-[160px]"
              >
                {kindMeta(c.kind).emoji} {c.title}
              </span>
            ))}
            {open.length > preview.length && (
              <span className="text-[10px] text-muted-foreground shrink-0">
                +{open.length - preview.length}
              </span>
            )}
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground truncate">
            {doneCount > 0 ? `nada em aberto · ${doneCount} resolvida(s)` : 'nada registrado'}
          </span>
        )}

        <span className="ml-auto flex items-center gap-1 shrink-0">
          {overdue.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-destructive">
              <AlertTriangle className="h-3 w-3" /> {overdue.length} vencida(s)
            </span>
          )}
          {hasOpen && (
            <span className="text-[10px] font-semibold tabular-nums text-amber-700 dark:text-amber-400">
              {open.length} em aberto
            </span>
          )}
        </span>
      </button>

      <button
        onClick={onNew}
        title="Registrar uma pendência do cliente"
        className="shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border hover:bg-accent transition-colors text-muted-foreground"
      >
        <Plus className="h-3 w-3" /> Pendência
      </button>
    </div>
  );
}
