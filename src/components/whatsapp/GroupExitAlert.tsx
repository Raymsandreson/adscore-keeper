import { AlertTriangle, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useGroupExits } from '@/hooks/useGroupExits';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface Props {
  leadId: string | null | undefined;
}

/**
 * Card fixo de aviso: mostra membros que saíram do grupo WhatsApp e ainda
 * não foram reconhecidos. Some quando todos forem marcados como vistos.
 */
export function GroupExitAlert({ leadId }: Props) {
  const { exits, acknowledge, acknowledgeAll } = useGroupExits(leadId);

  if (!exits || exits.length === 0) return null;

  return (
    <div className="border-2 border-destructive/40 bg-destructive/5 rounded-lg p-3 space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-destructive">
              Atenção: cliente saiu do grupo
            </span>
            <Badge variant="destructive" className="text-[10px]">{exits.length}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Não envie atualizações pelo grupo sem confirmar quem ainda está lá.
          </p>
        </div>
        {exits.length > 1 && (
          <Button size="sm" variant="ghost" onClick={acknowledgeAll} className="h-7 text-xs gap-1 shrink-0">
            <Check className="h-3 w-3" /> Vi tudo
          </Button>
        )}
      </div>

      <div className="space-y-1.5 pl-6">
        {exits.map(e => (
          <div key={e.id} className="flex items-center gap-2 text-xs">
            <span className="font-medium">{e.contact_name || e.phone}</span>
            <span className="text-muted-foreground">
              {e.exit_action === 'remove' ? 'foi removido' : 'saiu'} ·{' '}
              {format(new Date(e.exited_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5 ml-auto"
              onClick={() => acknowledge(e.id)}
              title="Marcar como visto"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
