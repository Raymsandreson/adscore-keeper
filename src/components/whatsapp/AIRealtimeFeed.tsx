import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bot, MessageCircle, UserPlus, Zap, Phone, FileText, Activity, ClipboardList } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export type FeedEventType = 'message_sent' | 'message_received' | 'lead_created' | 'followup_sent' | 'agent_activated' | 'agent_paused' | 'session_generated' | 'call_queued' | 'activity_created';

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
    case 'call_queued': return <Phone className="h-3.5 w-3.5 text-blue-400" />;
    case 'activity_created': return <ClipboardList className="h-3.5 w-3.5 text-teal-500" />;
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
    case 'call_queued': return 'border-l-blue-400';
    case 'activity_created': return 'border-l-teal-500';
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
  call_queued: 'Ligações',
  activity_created: 'Atividades',
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

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    events.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
    return counts;
  }, [events]);

  const addEvent = (ev: FeedEvent) => {
    setEvents(prev => [ev, ...prev].slice(0, 150));
  };

  useEffect(() => {
    let mounted = true;

    const fetchRecent = async () => {
      setLoading(true);
      try {
        const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { if (mounted) setLoading(false); return; }

        const [permRes, convAgentsRes] = await Promise.all([
          supabase.from('whatsapp_instance_users').select('instance_id').eq('user_id', user.id),
          supabase.from('whatsapp_conversation_agents').select('phone, instance_name').eq('is_active', true),
        ]);

        const instanceIds = (permRes.data || []).map((p: any) => p.instance_id);
        let allowedInstanceNames: string[] = [];
        if (instanceIds.length > 0) {
          const { data: instances } = await supabase.from('whatsapp_instances').select('instance_name').in('id', instanceIds);
          allowedInstanceNames = (instances || []).map((i: any) => i.instance_name);
        }

        const agentConvKeys = new Set<string>();
        (convAgentsRes.data || []).forEach((ca: any) => { agentConvKeys.add(`${ca.phone}|${ca.instance_name}`); });
        agentConvKeysRef.current = agentConvKeys;
        allowedInstancesRef.current = new Set(allowedInstanceNames);

        // Fetch messages, activities, and call queue in parallel
        const instFilter = allowedInstanceNames.length > 0 ? allowedInstanceNames : ['__none__'];
        const [msgsRes, activitiesRes, callsRes] = await Promise.all([
          supabase.from('whatsapp_messages')
            .select('id, phone, direction, message_text, contact_name, instance_name, created_at, lead_id')
            .gte('created_at', since).in('instance_name', instFilter)
            .order('created_at', { ascending: false }).limit(200),
          supabase.from('lead_activities')
            .select('id, title, description, activity_type, lead_name, created_at, lead_id')
            .gte('created_at', since)
            .order('created_at', { ascending: false }).limit(50),
          supabase.from('whatsapp_call_queue')
            .select('id, phone, instance_name, status, contact_name, created_at')
            .gte('created_at', since).in('instance_name', instFilter)
            .order('created_at', { ascending: false }).limit(50),
        ]);

        const feedEvents: FeedEvent[] = [];

        (msgsRes.data || []).forEach((m: any) => {
          const convKey = `${m.phone}|${m.instance_name}`;
          if (!agentConvKeys.has(convKey)) return;
          feedEvents.push({
            id: `msg-${m.id}`,
            type: m.direction === 'outbound' ? 'message_sent' : 'message_received',
            title: m.direction === 'outbound'
              ? `Msg enviada → ${m.contact_name || m.phone}`
              : `${m.contact_name || m.phone} respondeu`,
            detail: m.message_text?.slice(0, 80) || '',
            timestamp: m.created_at,
            phone: m.phone,
            instance_name: m.instance_name,
            contact_name: m.contact_name,
            lead_id: m.lead_id,
          });
        });

        (activitiesRes.data || []).forEach((a: any) => {
          feedEvents.push({
            id: `act-${a.id}`,
            type: 'activity_created',
            title: `Atividade: ${a.title}`,
            detail: a.lead_name || a.description?.slice(0, 60) || '',
            timestamp: a.created_at,
            lead_id: a.lead_id,
          });
        });

        (callsRes.data || []).forEach((c: any) => {
          feedEvents.push({
            id: `call-${c.id}`,
            type: 'call_queued',
            title: `Ligação enfileirada → ${c.contact_name || c.phone}`,
            detail: `Instância: ${c.instance_name} | Status: ${c.status}`,
            timestamp: c.created_at,
            phone: c.phone,
            instance_name: c.instance_name,
            contact_name: c.contact_name,
          });
        });

        feedEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        if (mounted) setEvents(feedEvents.slice(0, 100));
      } catch (e) {
        console.error('Feed fetch error:', e);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchRecent();

    // Realtime subscriptions for all relevant tables
    const channel = supabase
      .channel('ai-feed-realtime-v2')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_messages' }, (payload: any) => {
        const m = payload.new;
        if (!m) return;
        if (!allowedInstancesRef.current.has(m.instance_name)) return;
        if (!agentConvKeysRef.current.has(`${m.phone}|${m.instance_name}`)) return;
        addEvent({
          id: `msg-${m.id}`,
          type: m.direction === 'outbound' ? 'message_sent' : 'message_received',
          title: m.direction === 'outbound'
            ? `Msg enviada → ${m.contact_name || m.phone}`
            : `${m.contact_name || m.phone} respondeu`,
          detail: m.message_text?.slice(0, 80) || '',
          timestamp: m.created_at,
          phone: m.phone,
          instance_name: m.instance_name,
          contact_name: m.contact_name,
          lead_id: m.lead_id,
        });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lead_activities' }, (payload: any) => {
        const a = payload.new;
        if (!a) return;
        addEvent({
          id: `act-${a.id}`,
          type: 'activity_created',
          title: `Atividade: ${a.title}`,
          detail: a.lead_name || a.description?.slice(0, 60) || '',
          timestamp: a.created_at,
          lead_id: a.lead_id,
        });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_call_queue' }, (payload: any) => {
        const c = payload.new;
        if (!c) return;
        if (!allowedInstancesRef.current.has(c.instance_name)) return;
        addEvent({
          id: `call-${c.id}`,
          type: 'call_queued',
          title: `Ligação enfileirada → ${c.contact_name || c.phone}`,
          detail: `Instância: ${c.instance_name}`,
          timestamp: c.created_at,
          phone: c.phone,
          instance_name: c.instance_name,
          contact_name: c.contact_name,
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'whatsapp_conversation_agents' }, (payload: any) => {
        const ca = payload.new;
        if (!ca) return;
        if (!allowedInstancesRef.current.has(ca.instance_name)) return;
        if (ca.is_active) {
          agentConvKeysRef.current.add(`${ca.phone}|${ca.instance_name}`);
          addEvent({
            id: `agent-${ca.id}-${Date.now()}`,
            type: 'agent_activated',
            title: `Agente ativado → ${ca.phone}`,
            detail: `Instância: ${ca.instance_name}`,
            timestamp: new Date().toISOString(),
            phone: ca.phone,
            instance_name: ca.instance_name,
          });
        } else {
          agentConvKeysRef.current.delete(`${ca.phone}|${ca.instance_name}`);
          addEvent({
            id: `agent-${ca.id}-${Date.now()}`,
            type: 'agent_paused',
            title: `Agente pausado → ${ca.phone}`,
            detail: `Instância: ${ca.instance_name}`,
            timestamp: new Date().toISOString(),
            phone: ca.phone,
            instance_name: ca.instance_name,
          });
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lead_followups' }, (payload: any) => {
        const f = payload.new;
        if (!f) return;
        addEvent({
          id: `fu-${f.id}`,
          type: 'followup_sent',
          title: `Follow-up registrado`,
          detail: f.notes?.slice(0, 60) || f.followup_type || '',
          timestamp: f.created_at || new Date().toISOString(),
          lead_id: f.lead_id,
        });
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

      <ScrollArea className="h-[calc(100vh-420px)]">
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
