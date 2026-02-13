import { WhatsAppConversation } from '@/hooks/useWhatsAppMessages';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Search, User, Link2 } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useState } from 'react';

interface Props {
  conversations: WhatsAppConversation[];
  loading: boolean;
  selectedPhone: string | null;
  onSelect: (conv: WhatsAppConversation) => void;
}

export function WhatsAppConversationList({ conversations, loading, selectedPhone, onSelect }: Props) {
  const [search, setSearch] = useState('');

  const filtered = conversations.filter(c => {
    const term = search.toLowerCase();
    return (
      c.phone.includes(term) ||
      (c.contact_name?.toLowerCase().includes(term)) ||
      (c.last_message?.toLowerCase().includes(term))
    );
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
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

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            Nenhuma conversa encontrada
          </div>
        ) : (
          filtered.map(conv => (
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
                    {conv.unread_count > 0 && (
                      <Badge className="h-5 min-w-5 flex items-center justify-center text-[10px] bg-green-600 hover:bg-green-600 p-0 px-1.5">
                        {conv.unread_count}
                      </Badge>
                    )}
                  </div>
                </div>
                {conv.contact_name && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {formatPhone(conv.phone)}
                  </p>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
