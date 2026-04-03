import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Bot, MessageCircle, UserPlus, Zap, Phone, FileText, ArrowRight, Activity, Filter } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export type FeedEventType = 'message_sent' | 'message_received' | 'lead_created' | 'followup_sent' | 'agent_activated' | 'agent_paused' | 'session_generated';

export interface FeedEvent {
  id: string;
  type: FeedEventType;
  title: string;
  detail: string;
  agent_name?: string;
  timestamp: string;
  phone?: string;
  instance_name?: string;
  contact_name?: string;
  lead_id?: string;
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

const EVENT_TYPE_LABELS: Record<FeedEventType, string> = {
  message_sent: 'Enviadas',
  message_received: 'Recebidas',
  lead_created: 'Leads',
  followup_sent: 'Follow-ups',
  agent_activated: 'Ativações',
  agent_paused: 'Pausas',
  session_generated: 'Sessões',
};

interface AIRealtimeFeedProps {
  onEventClick?: (event: FeedEvent) => void;
}

export function AIRealtimeFeed({ onEventClick }: AIRealtimeFeedProps) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilters, setActiveFilters] = useState<Set<FeedEventType>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const allowedInstancesRef = useRef<Set<string>>(new Set());
  const agentConvKeysRef = useRef<Set<string>>(new Set());

  const toggleFilter = (type: FeedEventType) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const filteredEvents = useMemo(() => {
    if (activeFilters.size === 0) return events;
    return events.filter(e => activeFilters.has(e.type));
  }, [events, activeFilters]);

  // Count by type for filter badges
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    events.forEach(e => {
      counts[e.type] = (counts[e.type] || 0) + 1;
    });
    return counts;
  }, [events]);

  useEffect(() => {
    let mounted = true;

    const fetchRecent = async () => {
      setLoading(true);
      try {
        const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

        // Get current user
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { if (mounted) setLoading(false); return; }

        // Get user's permitted instances and active agent conversations in parallel
        const [permRes, convAgentsRes] = await Promise.all([
          supabase.from('whatsapp_instance_users').select('instance_id').eq('user_id', user.id),
          supabase.from('whatsapp_conversation_agents').select('phone, instance_name').eq('is_active', true),
        ]);

        // Get instance names from IDs
        const instanceIds = (permRes.data || []).map((p: any) => p.instance_id);
        let allowedInstanceNames: string[] = [];
        if (instanceIds.length > 0) {
          const { data: instances } = await supabase
            .from('whatsapp_instances')
            .select('instance_name')
            .in('id', instanceIds);
          allowedInstanceNames = (instances || []).map((i: any) => i.instance_name);
        }

        // Store refs for realtime filtering
        const agentConvKeys = new Set<string>();
        (convAgentsRes.data || []).forEach((ca: any) => {
          agentConvKeys.add(`${ca.phone}|${ca.instance_name}`);
        });
        agentConvKeysRef.current = agentConvKeys;
        allowedInstancesRef.current = new Set(allowedInstanceNames);

        const [msgsRes] = await Promise.all([
          supabase
            .from('whatsapp_messages')
            .select('id, phone, direction, message_text, contact_name, instance_name, created_at, campaign_name, lead_id')
            .gte('created_at', since)
            .in('instance_name', allowedInstanceNames.length > 0 ? allowedInstanceNames : ['__none__'])
            .order('created_at', { ascending: false })
            .limit(200),
        ]);

        const feedEvents: FeedEvent[] = [];

        (msgsRes.data || []).forEach((m: any) => {
          // Only include messages from conversations with an active agent
          const convKey = `${m.phone}|${m.instance_name}`;
          if (!agentConvKeys.has(convKey)) return;

          if (m.direction === 'outbound') {
            feedEvents.push({
              id: `msg-${m.id}`,
              type: 'message_sent',
              title: `Mensagem enviada para ${m.contact_name || m.phone}`,
              detail: m.message_text?.slice(0, 80) || '',
              timestamp: m.created_at,
              phone: m.phone,
              instance_name: m.instance_name,
              contact_name: m.contact_name,
              lead_id: m.lead_id,
            });
          } else if (m.direction === 'inbound') {
            feedEvents.push({
              id: `msg-${m.id}`,
              type: 'message_received',
              title: `${m.contact_name || m.phone} respondeu`,
              detail: m.message_text?.slice(0, 80) || '',
              timestamp: m.created_at,
              phone: m.phone,
              instance_name: m.instance_name,
              contact_name: m.contact_name,
              lead_id: m.lead_id,
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

    const channel = supabase
      .channel('ai-feed-realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'whatsapp_messages',
      }, (payload: any) => {
        const m = payload.new;
        if (!m) return;
        // Filter: only allowed instances and agent-managed conversations
        if (!allowedInstancesRef.current.has(m.instance_name)) return;
        if (!agentConvKeysRef.current.has(`${m.phone}|${m.instance_name}`)) return;
        const newEvent: FeedEvent = {
          id: `msg-${m.id}`,
          type: m.direction === 'outbound' ? 'message_sent' : 'message_received',
          title: m.direction === 'outbound'
            ? `Mensagem enviada para ${m.contact_name || m.phone}`
            : `${m.contact_name || m.phone} respondeu`,
          detail: m.message_text?.slice(0, 80) || '',
          timestamp: m.created_at,
          phone: m.phone,
          instance_name: m.instance_name,
          contact_name: m.contact_name,
          lead_id: m.lead_id,
        };
        setEvents(prev => [newEvent, ...prev].slice(0, 100));
      })
      .subscribe();

    const interval = setInterval(fetchRecent, 60000);

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

  // Which types actually exist in current events
  const availableTypes = useMemo(() => {
    const types = new Set<FeedEventType>();
    events.forEach(e => types.add(e.type));
    return Array.from(types);
  }, [events]);

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

      {/* Event type filters */}
      <div className="flex flex-wrap gap-1">
        {(Object.keys(EVENT_TYPE_LABELS) as FeedEventType[]).filter(t => (typeCounts[t] || 0) > 0 || activeFilters.has(t)).map(type => {
          const isActive = activeFilters.has(type);
          return (
            <button
              key={type}
              onClick={() => toggleFilter(type)}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                isActive
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'
              }`}
            >
              {eventIcon(type)}
              {EVENT_TYPE_LABELS[type]}
              {(typeCounts[type] || 0) > 0 && (
                <span className={`ml-0.5 text-[9px] ${isActive ? 'opacity-80' : 'opacity-60'}`}>
                  {typeCounts[type]}
                </span>
              )}
            </button>
          );
        })}
        {activeFilters.size > 0 && (
          <button
            onClick={() => setActiveFilters(new Set())}
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] text-muted-foreground hover:text-foreground border border-border hover:bg-muted transition-colors"
          >
            Limpar
          </button>
        )}
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-1" ref={scrollRef}>
          {filteredEvents.map(event => (
            <div
              key={event.id}
              onClick={() => onEventClick?.(event)}
              className={`flex items-start gap-2 p-2 rounded-md border-l-2 bg-card hover:bg-muted/50 transition-colors cursor-pointer ${eventColor(event.type)}`}
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

          {filteredEvents.length === 0 && !loading && (
            <div className="text-center py-8 text-muted-foreground">
              <Activity className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-xs">Nenhuma atividade recente</p>
              <p className="text-[10px] mt-0.5">
                {activeFilters.size > 0 ? 'Nenhum evento desse tipo encontrado' : 'Eventos aparecerão aqui em tempo real'}
              </p>
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
