import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Clock, CheckCircle, XCircle, User } from 'lucide-react';
import type { NewConvDetail } from '../hooks/useDashboardMetrics';
import { format, parseISO } from 'date-fns';

interface NewConversationsSheetProps {
  open: boolean;
  onClose: () => void;
  conversations: NewConvDetail[];
  onOpenChat?: (phone: string, instanceName: string | null) => void;
}

export function NewConversationsSheet({ open, onClose, conversations, onOpenChat }: NewConversationsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:w-[450px] sm:max-w-[450px] p-0 flex flex-col">
        <SheetHeader className="p-4 pb-2 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Conversas Novas ({conversations.length})
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1.5">
            {conversations.map((c, idx) => (
              <div
                key={`${c.phone}-${idx}`}
                className="border rounded-lg p-3 hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={() => onOpenChat?.(c.phone, c.instance_name)}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium truncate">
                      {c.contact_name || c.lead_name || c.phone}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {c.was_responded ? (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 text-green-600 border-green-200">
                        <CheckCircle className="h-2.5 w-2.5 mr-0.5" /> Respondida
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 text-amber-600 border-amber-200">
                        <XCircle className="h-2.5 w-2.5 mr-0.5" /> Aguardando
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span>{c.phone}</span>
                  {c.instance_name && <span>· {c.instance_name}</span>}
                  <span>· {format(parseISO(c.first_message_at), 'HH:mm')}</span>
                  {c.response_time_minutes !== null && (
                    <span className="flex items-center gap-0.5">
                      <Clock className="h-2.5 w-2.5" /> {c.response_time_minutes}min
                    </span>
                  )}
                </div>
                {c.has_lead && (
                  <div className="mt-1">
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4">Lead: {c.lead_name}</Badge>
                  </div>
                )}
              </div>
            ))}
            {conversations.length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-xs">
                Nenhuma conversa nova no período
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
