import { useState, useMemo } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Sparkles, Clock, CheckCircle, XCircle, User, Search, Inbox } from 'lucide-react';
import type { NewConvDetail } from '../hooks/useDashboardMetrics';
import { format, parseISO } from 'date-fns';

interface NewConversationsSheetProps {
  open: boolean;
  onClose: () => void;
  conversations: NewConvDetail[];
  onOpenChat?: (phone: string, instanceName: string | null) => void;
}

export function NewConversationsSheet({ open, onClose, conversations, onOpenChat }: NewConversationsSheetProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [responseFilter, setResponseFilter] = useState<'all' | 'responded' | 'waiting'>('all');
  const [leadFilter, setLeadFilter] = useState<'all' | 'com_lead' | 'sem_lead'>('all');

  const filtered = useMemo(() => {
    return conversations.filter(c => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!c.phone.includes(q) && !c.contact_name?.toLowerCase().includes(q) && !c.lead_name?.toLowerCase().includes(q)) return false;
      }
      if (responseFilter === 'responded' && !c.was_responded) return false;
      if (responseFilter === 'waiting' && c.was_responded) return false;
      if (leadFilter === 'com_lead' && !c.has_lead) return false;
      if (leadFilter === 'sem_lead' && c.has_lead) return false;
      return true;
    });
  }, [conversations, searchQuery, responseFilter, leadFilter]);

  const respondedCount = conversations.filter(c => c.was_responded).length;
  const waitingCount = conversations.filter(c => !c.was_responded).length;
  const comLeadCount = conversations.filter(c => c.has_lead).length;
  const semLeadCount = conversations.filter(c => !c.has_lead).length;

  const handleClose = () => {
    setSearchQuery('');
    setResponseFilter('all');
    setLeadFilter('all');
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <SheetContent side="right" className="w-full sm:w-[450px] sm:max-w-[450px] p-0 flex flex-col">
        <SheetHeader className="p-4 pb-2 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Conversas Novas ({conversations.length})
          </SheetTitle>
        </SheetHeader>

        <div className="px-3 pt-2 pb-1 border-b space-y-1.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Buscar por nome ou telefone..." value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)} className="pl-8 h-7 text-xs" />
          </div>
          <div className="flex flex-wrap gap-1">
            {([['all', `Todas (${conversations.length})`], ['responded', `Respondidas (${respondedCount})`], ['waiting', `Aguardando (${waitingCount})`]] as const).map(([k, label]) => (
              <Badge key={k} variant={responseFilter === k ? 'default' : 'outline'}
                className="cursor-pointer text-[10px] px-1.5 py-0 h-5"
                onClick={() => setResponseFilter(k)}>{label}</Badge>
            ))}
          </div>
          <div className="flex flex-wrap gap-1 pb-1">
            {([['all', `Todos (${conversations.length})`], ['com_lead', `Com Lead (${comLeadCount})`], ['sem_lead', `Sem Lead (${semLeadCount})`]] as const).map(([k, label]) => (
              <Badge key={k} variant={leadFilter === k ? 'default' : 'outline'}
                className="cursor-pointer text-[10px] px-1.5 py-0 h-5"
                onClick={() => setLeadFilter(k)}>{label}</Badge>
            ))}
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1.5">
            {filtered.map((c, idx) => (
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
            {filtered.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Inbox className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-xs">Nenhuma conversa encontrada</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
