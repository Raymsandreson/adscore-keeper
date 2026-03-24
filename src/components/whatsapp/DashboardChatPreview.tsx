import { useState, useEffect, useRef } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { format, parseISO, isToday, isYesterday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ExternalLink, Loader2, User, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  message_text: string | null;
  direction: string;
  created_at: string;
  message_type: string;
  media_url: string | null;
  media_type: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phone: string | null;
  contactName: string | null;
  instanceName: string | null;
  hasLead: boolean;
  hasContact: boolean;
  wasResponded: boolean;
  responseTimeMinutes: number | null;
}

export function DashboardChatPreview({ open, onOpenChange, phone, contactName, instanceName, hasLead, hasContact, wasResponded, responseTimeMinutes }: Props) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !phone) return;
    setLoading(true);
    const fetchMessages = async () => {
      const { data } = await supabase
        .from('whatsapp_messages')
        .select('id, message_text, direction, created_at, message_type, media_url, media_type')
        .eq('phone', phone)
        .order('created_at', { ascending: true })
        .limit(100);
      setMessages(data || []);
      setLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'auto' }), 100);
    };
    fetchMessages();
  }, [open, phone]);

  const formatDateSeparator = (dateStr: string) => {
    const date = parseISO(dateStr);
    if (isToday(date)) return 'Hoje';
    if (isYesterday(date)) return 'Ontem';
    return format(date, "dd 'de' MMMM", { locale: ptBR });
  };

  const goToFullChat = () => {
    onOpenChange(false);
    if (phone) navigate(`/whatsapp?openChat=${encodeURIComponent(phone)}`);
  };

  let lastDateLabel = '';

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <DrawerTitle className="text-base truncate flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground shrink-0" />
                {contactName || phone}
              </DrawerTitle>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {phone && contactName && <span className="text-xs text-muted-foreground">{phone}</span>}
                {instanceName && <span className="text-[10px] text-muted-foreground">• {instanceName}</span>}
              </div>
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                {hasLead && <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4">Lead</Badge>}
                {hasContact && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">Contato</Badge>}
                {!hasLead && !hasContact && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground">Sem vínculo</Badge>}
                {wasResponded ? (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800">
                    ✓ Respondido {responseTimeMinutes != null && responseTimeMinutes < 60 ? `em ${responseTimeMinutes}min` : responseTimeMinutes != null ? `em ${Math.floor(responseTimeMinutes / 60)}h` : ''}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800">
                    ⏳ Aguardando
                  </Badge>
                )}
              </div>
            </div>
            <Button variant="outline" size="sm" className="shrink-0 ml-2 gap-1" onClick={goToFullChat}>
              Abrir chat <ExternalLink className="h-3 w-3" />
            </Button>
          </div>
        </DrawerHeader>

        <div className="flex-1 min-h-0 px-4 pb-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhuma mensagem encontrada</p>
          ) : (
            <ScrollArea className="h-[50vh]">
              <div className="space-y-1 pr-3">
                {messages.map((msg) => {
                  const dateLabel = formatDateSeparator(msg.created_at);
                  const showDateSep = dateLabel !== lastDateLabel;
                  if (showDateSep) lastDateLabel = dateLabel;
                  const isInbound = msg.direction === 'inbound';

                  return (
                    <div key={msg.id}>
                      {showDateSep && (
                        <div className="flex justify-center my-2">
                          <span className="text-[10px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground">{dateLabel}</span>
                        </div>
                      )}
                      <div className={cn("flex", isInbound ? "justify-start" : "justify-end")}>
                        <div className={cn(
                          "max-w-[80%] rounded-lg px-3 py-1.5 text-xs",
                          isInbound
                            ? "bg-muted text-foreground rounded-tl-none"
                            : "bg-primary text-primary-foreground rounded-tr-none"
                        )}>
                          {msg.media_type && !msg.message_text && (
                            <span className="italic text-[10px] opacity-70">
                              {msg.media_type === 'image' ? '📷 Imagem' : msg.media_type === 'audio' ? '🎵 Áudio' : msg.media_type === 'video' ? '🎬 Vídeo' : msg.media_type === 'document' ? '📄 Documento' : '📎 Mídia'}
                            </span>
                          )}
                          {msg.message_text && <p className="whitespace-pre-wrap break-words">{msg.message_text}</p>}
                          <p className={cn("text-[9px] mt-0.5", isInbound ? "text-muted-foreground" : "text-primary-foreground/70")}>
                            {format(parseISO(msg.created_at), 'HH:mm')}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>
          )}
        </div>

        <div className="px-4 pb-4">
          <Button variant="default" className="w-full gap-2" onClick={goToFullChat}>
            Abrir conversa completa <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
