import { lazy, Suspense, useCallback, useState } from 'react';
import { ChevronDown, Loader2, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

const TeamChatPanel = lazy(() => import('./TeamChatPanel').then(m => ({ default: m.TeamChatPanel })));

interface EntityTeamChatDockProps {
  entityType: string;
  entityId: string;
  entityName?: string;
  /** Altura da área do chat quando aberto. */
  height?: number | string;
  className?: string;
  title?: string;
  /** Aberto por padrão — o chat interno é parte da ficha, não uma aba escondida. */
  defaultOpen?: boolean;
}

/**
 * Chat interno da equipe embutido na própria ficha (lead, processo, caso, conversa).
 * Fica visível por padrão em vez de morar dentro de uma aba: a conversa da equipe
 * sobre a entidade acompanha o que está sendo lido, sem troca de contexto.
 *
 * O estado aberto/fechado é lembrado por tipo de entidade (não por registro), então
 * quem fechar no lead continua vendo fechado no próximo lead.
 */
export function EntityTeamChatDock({
  entityType,
  entityId,
  entityName,
  height = 280,
  className,
  title = 'Chat interno da equipe',
  defaultOpen = true,
}: EntityTeamChatDockProps) {
  const storageKey = `team-chat-dock:${entityType}`;
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === '0') return false;
      if (saved === '1') return true;
    } catch {
      /* localStorage pode estar bloqueado — cai no padrão */
    }
    return defaultOpen;
  });

  const toggle = useCallback(() => {
    setOpen(prev => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, next ? '1' : '0');
      } catch {
        /* sem persistência é aceitável */
      }
      return next;
    });
  }, [storageKey]);

  if (!entityId) return null;

  return (
    <section className={cn('rounded-lg border border-primary/20 overflow-hidden bg-background', className)}>
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between px-2.5 py-1.5 bg-primary/5 hover:bg-primary/10 transition-colors"
      >
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
          <Users className="h-3.5 w-3.5" /> {title}
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-primary transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t bg-background" style={{ height: typeof height === 'number' ? `${height}px` : height }}>
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <TeamChatPanel entityType={entityType} entityId={entityId} entityName={entityName} />
          </Suspense>
        </div>
      )}
    </section>
  );
}
