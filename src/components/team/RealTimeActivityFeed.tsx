import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Activity,
  UserPlus,
  Users,
  Phone,
  ArrowRightLeft,
  CheckCircle2,
  FileSignature,
  Briefcase,
  Scale,
  MessageSquare,
  XCircle,
  ListChecks,
  Loader2,
  Bot,
  Filter,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface FeedItem {
  id: string;
  userId: string;
  userName: string;
  actionType: string;
  actionLabel: string;
  entityName: string;
  icon: React.ElementType;
  color: string;
  timestamp: string;
  instanceName?: string;
}

const ACTION_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  lead_created: { label: 'criou um lead', icon: UserPlus, color: 'text-indigo-500 bg-indigo-50' },
  lead_updated: { label: 'atualizou lead', icon: ArrowRightLeft, color: 'text-amber-500 bg-amber-50' },
  lead_closed: { label: 'fechou lead', icon: CheckCircle2, color: 'text-emerald-500 bg-emerald-50' },
  lead_refused: { label: 'recusou lead', icon: XCircle, color: 'text-red-500 bg-red-50' },
  contact_created: { label: 'criou contato', icon: Users, color: 'text-teal-500 bg-teal-50' },
  call_made: { label: 'fez ligação', icon: Phone, color: 'text-green-500 bg-green-50' },
  stage_changed: { label: 'mudou de fase', icon: ArrowRightLeft, color: 'text-purple-500 bg-purple-50' },
  checklist_checked: { label: 'concluiu passo', icon: ListChecks, color: 'text-cyan-500 bg-cyan-50' },
  document_signed: { label: 'documento assinado', icon: FileSignature, color: 'text-blue-500 bg-blue-50' },
  case_created: { label: 'criou caso', icon: Briefcase, color: 'text-orange-500 bg-orange-50' },
  case_updated: { label: 'atualizou caso', icon: Scale, color: 'text-yellow-500 bg-yellow-50' },
  comment_reply: { label: 'respondeu comentário', icon: MessageSquare, color: 'text-violet-500 bg-violet-50' },
  dm_sent: { label: 'enviou DM', icon: MessageSquare, color: 'text-pink-500 bg-pink-50' },
};

const ACTION_FILTER_OPTIONS = [
  { value: 'all', label: 'Todas as ações' },
  { value: 'lead_created', label: 'Lead criado' },
  { value: 'contact_created', label: 'Contato criado' },
  { value: 'call_made', label: 'Ligação' },
  { value: 'lead_updated', label: 'Lead atualizado' },
  { value: 'lead_closed', label: 'Lead fechado' },
  { value: 'lead_refused', label: 'Lead recusado' },
  { value: 'case_created', label: 'Caso criado' },
  { value: 'case_updated', label: 'Caso atualizado' },
  { value: 'stage_changed', label: 'Mudança de fase' },
  { value: 'document_signed', label: 'Documento assinado' },
];

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

export function RealTimeActivityFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileMap, setProfileMap] = useState<Record<string, string>>({});
  const [filterMember, setFilterMember] = useState('all');
  const [filterAction, setFilterAction] = useState('all');
  const feedRef = useRef<FeedItem[]>([]);

  const SYSTEM_ID = '00000000-0000-0000-0000-000000000000';

  // Load profiles
  useEffect(() => {
    supabase.from('profiles').select('user_id, full_name').then(({ data }) => {
      const map: Record<string, string> = {};
      (data || []).forEach(p => { 
        if (p.full_name) map[p.user_id] = p.full_name; 
      });
      map[SYSTEM_ID] = '🤖 Sistema';
      map['system'] = '🤖 Agente IA';
      setProfileMap(map);
    });
  }, []);

  const getUserName = useCallback((userId: string) => {
    if (!userId || userId === SYSTEM_ID) return '🤖 Sistema';
    if (userId === 'system') return '🤖 Agente IA';
    return profileMap[userId] || 'Membro';
  }, [profileMap]);

  const addItem = useCallback((item: FeedItem) => {
    feedRef.current = [item, ...feedRef.current].slice(0, 150);
    setItems([...feedRef.current]);
  }, []);

  // Build member filter options from items
  const memberOptions = useMemo(() => {
    const seen = new Map<string, string>();
    items.forEach(item => {
      if (!seen.has(item.userId)) {
        seen.set(item.userId, item.userName);
      }
    });
    return Array.from(seen.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => ({ value: id, label: name }));
  }, [items]);

  // Filtered items
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (filterMember !== 'all' && item.userId !== filterMember) return false;
      if (filterAction !== 'all' && item.actionType !== filterAction) return false;
      return true;
    });
  }, [items, filterMember, filterAction]);

  // Helper to get instance for a lead/contact via whatsapp_messages
  const getInstanceForEntity = async (entityId: string): Promise<string | null> => {
    const { data } = await supabase
      .from('whatsapp_messages')
      .select('instance_name')
      .eq('lead_id', entityId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as any)?.instance_name || null;
  };

  // Load initial data
  useEffect(() => {
    if (Object.keys(profileMap).length === 0) return;

    const loadInitial = async () => {
      setLoading(true);
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const allItems: FeedItem[] = [];

      const [leadsRes, contactsRes, callsRes, activityLogRes, casesRes] = await Promise.all([
        supabase.from('leads').select('id, lead_name, created_by, updated_by, lead_status, created_at, updated_at, action_source_detail').gte('created_at', since).order('created_at', { ascending: false }).limit(50),
        supabase.from('contacts').select('id, full_name, created_by, created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(50),
        supabase.from('call_records').select('id, user_id, contact_name, lead_name, call_result, created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(50),
        supabase.from('user_activity_log').select('id, user_id, action_type, entity_type, metadata, created_at').gte('created_at', since).in('action_type', ['checklist_item_checked', 'comment_reply', 'dm_sent', 'lead_moved', 'lead_created', 'lead_updated', 'contact_created']).order('created_at', { ascending: false }).limit(50),
        supabase.from('case_process_tracking').select('id, acolhedor, cliente, status_processo, created_at, updated_at').gte('created_at', since).order('created_at', { ascending: false }).limit(30),
      ]);

      // For bot-created leads, batch-fetch instance names
      const botLeadIds = (leadsRes.data || []).filter(l => !l.created_by).map(l => l.id);
      const instanceMap: Record<string, string> = {};
      if (botLeadIds.length > 0) {
        const { data: msgs } = await supabase
          .from('whatsapp_messages')
          .select('lead_id, instance_name')
          .in('lead_id', botLeadIds)
          .order('created_at', { ascending: false });
        (msgs || []).forEach((m: any) => {
          if (m.lead_id && !instanceMap[m.lead_id]) {
            instanceMap[m.lead_id] = m.instance_name;
          }
        });
      }

      // Leads
      (leadsRes.data || []).forEach(l => {
        const userId = l.created_by || 'system';
        const isBot = !l.created_by;
        const instance = isBot ? instanceMap[l.id] : undefined;
        const userName = isBot ? `🤖 Agente IA` : getUserName(l.created_by!);
        allItems.push({
          id: `lead-c-${l.id}`,
          userId,
          userName,
          actionType: 'lead_created',
          actionLabel: ACTION_CONFIG.lead_created.label,
          entityName: l.lead_name || 'Lead',
          icon: ACTION_CONFIG.lead_created.icon,
          color: ACTION_CONFIG.lead_created.color,
          timestamp: l.created_at,
          instanceName: instance || undefined,
        });
      });

      // Contacts
      (contactsRes.data || []).forEach(c => {
        const userId = c.created_by || 'system';
        const isBot = !c.created_by;
        const userName = isBot ? '🤖 Agente IA' : getUserName(c.created_by!);
        allItems.push({
          id: `contact-${c.id}`,
          userId,
          userName,
          actionType: 'contact_created',
          actionLabel: ACTION_CONFIG.contact_created.label,
          entityName: c.full_name || 'Contato',
          icon: ACTION_CONFIG.contact_created.icon,
          color: ACTION_CONFIG.contact_created.color,
          timestamp: c.created_at,
        });
      });

      // Calls
      (callsRes.data || []).forEach(c => {
        allItems.push({
          id: `call-${c.id}`,
          userId: c.user_id,
          userName: getUserName(c.user_id),
          actionType: 'call_made',
          actionLabel: `${ACTION_CONFIG.call_made.label} (${c.call_result})`,
          entityName: c.contact_name || c.lead_name || 'Contato',
          icon: ACTION_CONFIG.call_made.icon,
          color: ACTION_CONFIG.call_made.color,
          timestamp: c.created_at,
        });
      });

      // Activity log
      (activityLogRes.data || []).forEach(a => {
        const config = ACTION_CONFIG[a.action_type] || ACTION_CONFIG.lead_updated;
        const meta = a.metadata as Record<string, any> || {};
        allItems.push({
          id: `al-${a.id}`,
          userId: a.user_id,
          userName: getUserName(a.user_id),
          actionType: a.action_type,
          actionLabel: config.label,
          entityName: meta.lead_name || meta.contact_name || meta.entity_name || a.entity_type || '',
          icon: config.icon,
          color: config.color,
          timestamp: a.created_at,
        });
      });

      // Cases
      (casesRes.data || []).forEach(c => {
        const userId = Object.entries(profileMap).find(([_, name]) => name === c.acolhedor)?.[0] || '';
        if (userId) {
          allItems.push({
            id: `case-${c.id}`,
            userId,
            userName: c.acolhedor || 'Usuário',
            actionType: 'case_created',
            actionLabel: ACTION_CONFIG.case_created.label,
            entityName: c.cliente || 'Caso',
            icon: ACTION_CONFIG.case_created.icon,
            color: ACTION_CONFIG.case_created.color,
            timestamp: c.created_at || new Date().toISOString(),
          });
        }
      });

      allItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      feedRef.current = allItems.slice(0, 150);
      setItems([...feedRef.current]);
      setLoading(false);
    };

    loadInitial();
  }, [profileMap, getUserName]);

  // Realtime subscriptions
  useEffect(() => {
    if (Object.keys(profileMap).length === 0) return;

    const channel = supabase.channel('team-realtime-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, async (payload) => {
        const l = payload.new as any;
        const userId = l.created_by || 'system';
        const isBot = !l.created_by;
        let instance: string | undefined;
        if (isBot) {
          // Try to get instance from messages (may take a moment)
          setTimeout(async () => {
            const inst = await getInstanceForEntity(l.id);
            if (inst) {
              feedRef.current = feedRef.current.map(item =>
                item.id.includes(l.id) ? { ...item, instanceName: inst } : item
              );
              setItems([...feedRef.current]);
            }
          }, 2000);
        }
        addItem({
          id: `lead-rt-${l.id}-${Date.now()}`,
          userId,
          userName: isBot ? '🤖 Agente IA' : getUserName(l.created_by),
          actionType: 'lead_created',
          actionLabel: ACTION_CONFIG.lead_created.label,
          entityName: l.lead_name || 'Lead',
          icon: ACTION_CONFIG.lead_created.icon,
          color: ACTION_CONFIG.lead_created.color,
          timestamp: l.created_at || new Date().toISOString(),
          instanceName: instance,
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leads' }, (payload) => {
        const l = payload.new as any;
        const old = payload.old as any;
        const userId = l.updated_by || l.created_by;
        if (!userId) return;
        const isClosed = l.lead_status === 'closed' && old.lead_status !== 'closed';
        const isRefused = l.lead_status === 'refused' && old.lead_status !== 'refused';
        const type = isClosed ? 'lead_closed' : isRefused ? 'lead_refused' : 'lead_updated';
        const config = ACTION_CONFIG[type];
        addItem({
          id: `lead-u-${l.id}-${Date.now()}`,
          userId,
          userName: getUserName(userId),
          actionType: type,
          actionLabel: config.label,
          entityName: l.lead_name || 'Lead',
          icon: config.icon,
          color: config.color,
          timestamp: l.updated_at || new Date().toISOString(),
        });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'contacts' }, (payload) => {
        const c = payload.new as any;
        const userId = c.created_by || 'system';
        const isBot = !c.created_by;
        addItem({
          id: `contact-rt-${c.id}-${Date.now()}`,
          userId,
          userName: isBot ? '🤖 Agente IA' : getUserName(c.created_by),
          actionType: 'contact_created',
          actionLabel: ACTION_CONFIG.contact_created.label,
          entityName: c.full_name || c.name || 'Contato',
          icon: ACTION_CONFIG.contact_created.icon,
          color: ACTION_CONFIG.contact_created.color,
          timestamp: c.created_at || new Date().toISOString(),
        });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_records' }, (payload) => {
        const c = payload.new as any;
        addItem({
          id: `call-rt-${c.id}-${Date.now()}`,
          userId: c.user_id,
          userName: getUserName(c.user_id),
          actionType: 'call_made',
          actionLabel: `${ACTION_CONFIG.call_made.label} (${c.call_result})`,
          entityName: c.contact_name || c.lead_name || 'Contato',
          icon: ACTION_CONFIG.call_made.icon,
          color: ACTION_CONFIG.call_made.color,
          timestamp: c.created_at || new Date().toISOString(),
        });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_activity_log' }, (payload) => {
        const a = payload.new as any;
        const config = ACTION_CONFIG[a.action_type] || ACTION_CONFIG.lead_updated;
        const meta = (a.metadata || {}) as Record<string, any>;
        addItem({
          id: `al-rt-${a.id}-${Date.now()}`,
          userId: a.user_id,
          userName: getUserName(a.user_id),
          actionType: a.action_type,
          actionLabel: config.label,
          entityName: meta.lead_name || meta.contact_name || meta.entity_name || a.entity_type || '',
          icon: config.icon,
          color: config.color,
          timestamp: a.created_at || new Date().toISOString(),
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'case_process_tracking' }, (payload) => {
        const c = payload.new as any;
        const userId = Object.entries(profileMap).find(([_, name]) => name === c.acolhedor)?.[0] || '';
        if (!userId) return;
        const isNew = payload.eventType === 'INSERT';
        const type = isNew ? 'case_created' : 'case_updated';
        const config = ACTION_CONFIG[type];
        addItem({
          id: `case-rt-${c.id}-${Date.now()}`,
          userId,
          userName: c.acolhedor || 'Usuário',
          actionType: type,
          actionLabel: config.label,
          entityName: c.cliente || 'Caso',
          icon: config.icon,
          color: config.color,
          timestamp: c.updated_at || c.created_at || new Date().toISOString(),
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profileMap, getUserName, addItem]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Activity className="h-5 w-5 text-primary" />
              <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 border-2 border-background animate-pulse" />
            </div>
            <div>
              <CardTitle className="text-base">Atividade em Tempo Real</CardTitle>
              <CardDescription>O que a equipe está fazendo agora</CardDescription>
            </div>
          </div>
          <Badge variant="secondary" className="text-xs">{filteredItems.length} ações</Badge>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 mt-3">
          <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <Select value={filterMember} onValueChange={setFilterMember}>
            <SelectTrigger className="h-8 text-xs w-[180px]">
              <SelectValue placeholder="Membro" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os membros</SelectItem>
              <SelectItem value="system">🤖 Agente IA</SelectItem>
              {memberOptions
                .filter(m => m.value !== 'system')
                .map(m => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Select value={filterAction} onValueChange={setFilterAction}>
            <SelectTrigger className="h-8 text-xs w-[180px]">
              <SelectValue placeholder="Ação" />
            </SelectTrigger>
            <SelectContent>
              {ACTION_FILTER_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            {items.length === 0 ? 'Nenhuma atividade registrada nas últimas 24h' : 'Nenhuma atividade com esses filtros'}
          </div>
        ) : (
          <ScrollArea className="h-[600px] pr-2">
            <div className="space-y-1">
              {filteredItems.map((item, idx) => {
                const Icon = item.icon;
                const [iconColor, bgColor] = item.color.split(' ');
                return (
                  <div
                    key={item.id}
                    className={cn(
                      'flex items-start gap-3 py-2.5 px-3 rounded-lg transition-colors hover:bg-muted/50',
                      idx === 0 && 'animate-in slide-in-from-top-2 duration-300'
                    )}
                  >
                    <Avatar className="h-8 w-8 shrink-0 mt-0.5">
                      <AvatarFallback className={cn("text-[10px] font-semibold", item.userId === 'system' ? 'bg-emerald-100 text-emerald-700' : 'bg-primary/10 text-primary')}>
                        {item.userId === 'system' ? <Bot className="h-4 w-4" /> : getInitials(item.userName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-snug">
                        <span className="font-semibold text-foreground">
                          {item.userId === 'system' ? '🤖 Agente IA' : item.userName.split(' ')[0]}
                        </span>
                        {' '}
                        <span className="text-muted-foreground">{item.actionLabel}</span>
                        {item.entityName && (
                          <>
                            {' · '}
                            <span className="font-medium text-foreground">{item.entityName}</span>
                          </>
                        )}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-[11px] text-muted-foreground">
                          {formatDistanceToNow(new Date(item.timestamp), { addSuffix: true, locale: ptBR })}
                        </p>
                        {item.instanceName && (
                          <Badge variant="outline" className="text-[9px] h-4 px-1.5 py-0 gap-1 border-emerald-300 text-emerald-700 bg-emerald-50">
                            📱 {item.instanceName}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className={cn('shrink-0 p-1.5 rounded-md', bgColor)}>
                      <Icon className={cn('h-3.5 w-3.5', iconColor)} />
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
