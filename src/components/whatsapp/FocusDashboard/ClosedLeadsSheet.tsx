import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trophy, MessageCircle, User } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { ClosedLeadItem } from '@/hooks/useFocusDashboardData';

interface ClosedLeadsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  closedLeads: ClosedLeadItem[];
  periodLabel: string;
  onOpenChat: (phone: string) => void;
}

export function ClosedLeadsSheet({ open, onOpenChange, closedLeads, periodLabel, onOpenChat }: ClosedLeadsSheetProps) {
  const sorted = [...closedLeads].sort((a, b) => {
    const da = a.became_client_date || '';
    const db = b.became_client_date || '';
    return db.localeCompare(da);
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Trophy className="h-4 w-4 text-emerald-600" />
            Fechados · {periodLabel}
            <span className="text-xs font-normal text-muted-foreground">({sorted.length})</span>
          </SheetTitle>
          <SheetDescription className="text-xs">
            Leads que viraram cliente no período. Toque pra abrir a conversa.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {sorted.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-8">
                Nenhum lead fechado neste período.
              </div>
            ) : (
              sorted.map((lead) => (
                <div
                  key={lead.id}
                  className="flex items-center gap-3 p-2 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate flex items-center gap-1.5">
                      <User className="h-3 w-3 text-muted-foreground shrink-0" />
                      {lead.lead_name || 'Sem nome'}
                    </div>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                      {lead.lead_phone && <span>📞 {lead.lead_phone}</span>}
                      {lead.acolhedor && <span>· {lead.acolhedor}</span>}
                      {lead.became_client_date && (
                        <span>· {format(new Date(lead.became_client_date + 'T00:00:00'), "dd/MM", { locale: ptBR })}</span>
                      )}
                    </div>
                  </div>
                  {lead.lead_phone && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 shrink-0"
                      onClick={() => {
                        onOpenChat(lead.lead_phone!);
                        onOpenChange(false);
                      }}
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
