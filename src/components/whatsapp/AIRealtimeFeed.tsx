import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Bot, MessageCircle, UserPlus, Zap, Phone, FileText, ArrowRight, Activity } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface FeedEvent {
  id: string;
  type: 'message_sent' | 'message_received' | 'lead_created' | 'followup_sent' | 'agent_activated' | 'agent_paused' | 'session_generated';
  title: string;
  detail: string;
  agent_name?: string;
  timestamp: string;
}

function eventIcon(type: FeedEvent['type']) {
  switch (type) {
    case 'message_sent': return <MessageCircle className="h-3.5 w-3.5 text-blue-500" />;
    case 'message_received': return <MessageCircle className="h-3.5 w-3.5 text-green-500" />;
    case 'lead_created': return <UserPlus className="h-3.5 w-3.5 text-primary" />;
    case 'followup_sent': return <Zap className="h-3.5 w-3.5 text-amber-500" />;
    case 'agent_activated': return <Bot className="h-3.5 w-3.5 text-green-500" />;
    case 'agent_paused': return <Phone className="h-3.5 w-3.5 text-orange-500" />;
    case 'session_generated': return <FileText className="h-3.5 w-3.5 text-purple-500" />;
    default: return <Activity className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function eventColor(type: FeedEvent['type']) {
  switch (type) {
    case 'message_sent': return 'border-l-blue-500';
    case 'message_received': return 'border-l-green-500';
    case 'lead_created': return 'border-l-primary';
    case 'followup_sent': return 'border-l-amber-500';
    case 'agent_activated': return 'border-l-green-500';
    case 'agent_paused': return 'border-l-orange-500';
    case 'session_generated': return 'border-l-purple-500';
    default: return 'border-l-muted';
  }
}

export function AIRealtimeFeed() {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch recent AI activity: outbound messages, sessions, agent changes
  useEffect(() => {
    let mounted = true;

    const fetchRecent = async () => {
      setLoading(true);
      try {
        const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // last 2h

        const [msgsRes, sessionsRes] = await Promise.all([
          supabase
            .from('whatsapp_messages')
            .select('id, phone, direction, message_text, contact_name, instance_name, created_at, campaign_name, lead_id')
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .limit(100),
          supabase
            .from('wjia_sessions')
            .select('id, phone, instance_name, shortcut_name, status, contact_name, created_at')
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .limit(50),
        ]);

        const feedEvents: FeedEvent[] = [];

        // Messages from AI agents (outbound)
        (msgsRes.data || []).forEach((m: any) => {
          if (m.direction === 'outbound') {
            feedEvents.push({
              id: `msg-${m.id}`,
              type: 'message_sent',
              title: `Mensagem enviada para ${m.contact_name || m.phone}`,
              detail: m.message_text?.slice(0, 80) || '',
              timestamp: m.created_at,
            });
          } else if (m.direction === 'inbound') {
            feedEvents.push({
              id: `msg-${m.id}`,
              type: 'message_received',
              title: `${m.contact_name || m.phone} respondeu`,
              detail: m.message_text?.slice(0, 80) || '',
              timestamp: m.created_at,
            });
          }
        });

        // Sessions
        (sessionsRes.data || []).forEach((s: any) => {
          if (s.status === 'generated') {
            feedEvents.push({
              id: `sess-${s.id}`,
              type: 'session_generated',
              title: `Documento gerado: ${s.shortcut_name}`,
              detail: `${s.contact_name || s.phone}`,
              agent_name: s.shortcut_name,
              timestamp: s.created_at,
            });
          }
        });

        feedEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        if (mounted) setEvents(feedEvents.slice(0, 80));
      } catch (e) {
        console.error('Feed fetch error:', e);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchRecent();

    // Subscribe to real-time message changes
    const channel = supabase
      .channel('ai-feed-realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'whatsapp_messages',
      }, (payload: any) => {
        const m = payload.new;
        if (!m) return;
        const newEvent: FeedEvent = {
          id: `msg-${m.id}`,
          type: m.direction === 'outbound' ? 'message_sent' : 'message_received',
          title: m.direction === 'outbound'
            ? `Mensagem enviada para ${m.contact_name || m.phone}`
            : `${m.contact_name || m.phone} respondeu`,
          detail: m.message_text?.slice(0, 80) || '',
          timestamp: m.created_at,
        };
        setEvents(prev => [newEvent, ...prev].slice(0, 100));
      })
      .subscribe();

    const interval = setInterval(fetchRecent, 60000); // refresh every minute

    return () => {
      mounted = false;
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, []);

  const timeAgo = (ts: string) => {
    const diff = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}min`;
    return format(new Date(ts), 'HH:mm', { locale: ptBR });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Atividade em Tempo Real</h3>
        <div className="flex items-center gap-1 ml-auto">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          <span className="text-[10px] text-muted-foreground">ao vivo</span>
        </div>
      </div>

      <ScrollArea className="h-[calc(100vh-520px)]">
        <div className="space-y-1" ref={scrollRef}>
          {events.map(event => (
            <div
              key={event.id}
              className={`flex items-start gap-2 p-2 rounded-md border-l-2 bg-card hover:bg-muted/50 transition-colors ${eventColor(event.type)}`}
            >
              <div className="mt-0.5 shrink-0">{eventIcon(event.type)}</div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium leading-tight truncate">{event.title}</p>
                {event.detail && (
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">{event.detail}</p>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">{timeAgo(event.timestamp)}</span>
            </div>
          ))}

          {events.length === 0 && !loading && (
            <div className="text-center py-8 text-muted-foreground">
              <Activity className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-xs">Nenhuma atividade recente</p>
              <p className="text-[10px] mt-0.5">Eventos aparecerão aqui em tempo real</p>
            </div>
          )}

          {loading && events.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Activity className="h-8 w-8 mx-auto mb-2 animate-pulse opacity-30" />
              <p className="text-xs">Carregando atividades...</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
