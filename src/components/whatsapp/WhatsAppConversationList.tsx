import { WhatsAppConversation } from '@/hooks/useWhatsAppMessages';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, User, Link2, Smartphone, PhoneMissed, PhoneCall, Unlink, Clock } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  conversations: WhatsAppConversation[];
  loading: boolean;
  selectedPhone: string | null;
  onSelect: (conv: WhatsAppConversation) => void;
}

type FilterType = 'all' | 'no_lead' | 'unanswered' | 'calls';

export function WhatsAppConversationList({ conversations, loading, selectedPhone, onSelect }: Props) {
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  // Phones that have call records
  const [phonesWithCalls, setPhonesWithCalls] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Fetch all phones that have call records
    const fetchCallPhones = async () => {
      const { data } = await supabase
        .from('call_records')
        .select('contact_phone')
        .not('contact_phone', 'is', null);
      if (data) {
        const phones = new Set(data.map((r: any) => r.contact_phone as string));
        setPhonesWithCalls(phones);
      }
    };
    fetchCallPhones();
  }, []);

  const isUnanswered = (conv: WhatsAppConversation) => {
    // Last message is inbound and no outbound after it
    const sorted = [...conv.messages].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return sorted.length > 0 && sorted[0].direction === 'inbound';
  };

  const getUnansweredTime = (conv: WhatsAppConversation) => {
    const sorted = [...conv.messages].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    if (sorted.length > 0 && sorted[0].direction === 'inbound') {
      return sorted[0].created_at;
    }
    return null;
  };

  const hasCalls = (conv: WhatsAppConversation) => {
    // Check by phone match
    return phonesWithCalls.has(conv.phone);
  };

  const filtered = conversations.filter(c => {
    // Text search
    const term = search.toLowerCase();
    const matchesSearch = !term || (
      c.phone.includes(term) ||
      (c.contact_name?.toLowerCase().includes(term)) ||
      (c.last_message?.toLowerCase().includes(term)) ||
      (c.instance_name?.toLowerCase().includes(term))
    );
    if (!matchesSearch) return false;

    // Category filters
    if (activeFilter === 'no_lead') return !c.lead_id;
    if (activeFilter === 'unanswered') return isUnanswered(c);
    if (activeFilter === 'calls') return hasCalls(c);
    return true;
  });

  const formatPhone = (phone: string) => {
    if (phone.length === 13) {
      return `+${phone.slice(0, 2)} (${phone.slice(2, 4)}) ${phone.slice(4, 9)}-${phone.slice(9)}`;
    }
    if (phone.length === 12) {
      return `+${phone.slice(0, 2)} (${phone.slice(2, 4)}) ${phone.slice(4, 8)}-${phone.slice(8)}`;
    }
    return phone;
  };

  const filters: { key: FilterType; label: string; icon: React.ReactNode }[] = [
    { key: 'all', label: 'Todas', icon: null },
    { key: 'no_lead', label: 'Sem lead', icon: <Unlink className="h-3 w-3" /> },
    { key: 'unanswered', label: 'Não respondidas', icon: <Clock className="h-3 w-3" /> },
    { key: 'calls', label: 'Ligações', icon: <PhoneCall className="h-3 w-3" /> },
  ];

  // Count per filter
  const counts: Record<FilterType, number> = {
    all: conversations.length,
    no_lead: conversations.filter(c => !c.lead_id).length,
    unanswered: conversations.filter(c => isUnanswered(c)).length,
    calls: conversations.filter(c => hasCalls(c)).length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-3 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar conversa..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
      </div>

      {/* Filter chips */}
      <div className="px-2 py-2 border-b flex gap-1 flex-wrap">
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => setActiveFilter(f.key)}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium transition-colors",
              activeFilter === f.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            {f.icon}
            {f.label}
            <span className={cn(
              "ml-0.5 rounded-full px-1 text-[10px]",
              activeFilter === f.key ? "bg-primary-foreground/20" : "bg-background/60"
            )}>
              {counts[f.key]}
            </span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            Nenhuma conversa encontrada
          </div>
        ) : (
          filtered.map(conv => {
            const unansweredAt = activeFilter === 'unanswered' || isUnanswered(conv) ? getUnansweredTime(conv) : null;
            const convHasCalls = hasCalls(conv);

            return (
              <button
                key={conv.phone}
                onClick={() => onSelect(conv)}
                className={cn(
                  "w-full flex items-start gap-3 p-3 text-left hover:bg-accent/50 transition-colors border-b border-border/30",
                  selectedPhone === conv.phone && "bg-accent"
                )}
              >
                <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                  <User className="h-5 w-5 text-green-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm truncate">
                      {conv.contact_name || formatPhone(conv.phone)}
                    </span>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">
                      {format(new Date(conv.last_message_at), 'HH:mm', { locale: ptBR })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <p className="text-xs text-muted-foreground truncate">
                      {conv.last_message || '(mídia)'}
                    </p>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {conv.lead_id && (
                        <Link2 className="h-3 w-3 text-blue-500" />
                      )}
                      {convHasCalls && (
                        <PhoneCall className="h-3 w-3 text-purple-500" />
                      )}
                      {conv.unread_count > 0 && (
                        <Badge className="h-5 min-w-5 flex items-center justify-center text-[10px] bg-green-600 hover:bg-green-600 p-0 px-1.5">
                          {conv.unread_count}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    {conv.contact_name && (
                      <p className="text-[10px] text-muted-foreground">
                        {formatPhone(conv.phone)}
                      </p>
                    )}
                    {conv.instance_name && (
                      <span className="text-[9px] text-muted-foreground/70 flex items-center gap-0.5 ml-auto">
                        <Smartphone className="h-2.5 w-2.5" />
                        {conv.instance_name}
                      </span>
                    )}
                  </div>
                  {/* Unanswered time badge */}
                  {unansweredAt && isUnanswered(conv) && (
                    <div className="flex items-center gap-1 mt-1">
                      <span className="inline-flex items-center gap-1 text-[10px] text-warning-foreground bg-warning/10 border border-warning/20 px-1.5 py-0.5 rounded-full" style={{color: 'hsl(var(--warning, 38 92% 50%))', background: 'hsl(var(--warning, 38 92% 50%) / 0.1)'}}>
                        <Clock className="h-2.5 w-2.5" />
                        Sem resposta há {formatDistanceToNow(new Date(unansweredAt), { locale: ptBR, addSuffix: false })}
                      </span>
                    </div>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
