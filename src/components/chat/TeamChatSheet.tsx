import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { TeamChatPanel } from './TeamChatPanel';
import { Users, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface TeamChatSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: string;
  entityId: string;
  entityName?: string;
  highlightMessageId?: string | null;
}

export function TeamChatSheet({ open, onOpenChange, entityType, entityId, entityName, highlightMessageId }: TeamChatSheetProps) {
  const navigate = useNavigate();
  const typeLabels: Record<string, string> = {
    lead: 'Lead',
    activity: 'Atividade',
    contact: 'Contato',
    workflow: 'POP',
    pop_step: 'Passo do POP',
  };

  // Atividade tem rota própria (/?openActivity=id) — o nome no cabeçalho vira link.
  const canOpenEntity = entityType === 'activity' && !!entityId;
  const handleOpenEntity = () => {
    onOpenChange(false);
    navigate(`/?openActivity=${entityId}`);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[380px] sm:w-[420px] p-0 flex flex-col">
        <div className="shrink-0 px-4 py-3 border-b bg-primary/5">
          <SheetHeader>
            <SheetTitle className="text-sm flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                <Users className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm">Chat da Equipe</div>
                {canOpenEntity ? (
                  <button
                    type="button"
                    onClick={handleOpenEntity}
                    title="Abrir atividade"
                    className="flex items-center gap-1 text-[10px] text-muted-foreground font-normal hover:text-primary hover:underline max-w-full"
                  >
                    <span className="truncate">
                      {typeLabels[entityType] || entityType}{entityName ? `: ${entityName}` : ''}
                    </span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </button>
                ) : (
                  <div className="text-[10px] text-muted-foreground font-normal">
                    {typeLabels[entityType] || entityType}{entityName ? `: ${entityName}` : ''}
                  </div>
                )}
              </div>
            </SheetTitle>
          </SheetHeader>
        </div>
        <TeamChatPanel
          entityType={entityType}
          entityId={entityId}
          entityName={entityName}
          highlightMessageId={highlightMessageId}
        />
      </SheetContent>
    </Sheet>
  );
}
