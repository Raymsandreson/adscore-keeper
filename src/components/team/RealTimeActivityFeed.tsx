import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

export function RealTimeActivityFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileMap, setProfileMap] = useState<Record<string, string>>({});
  const feedRef = useRef<FeedItem[]>([]);

  // Load profiles
  useEffect(() => {
    supabase.from('profiles').select('user_id, full_name').then(({ data }) => {
      const map: Record<string, string> = {};
      (data || []).forEach(p => { map[p.user_id] = p.full_name || 'Usuário'; });
      setProfileMap(map);
    });
  }, []);

  const getUserName = useCallback((userId: string) => profileMap[userId] || 'Usuário', [profileMap]);

  const addItem = useCallback((item: FeedItem) => {
    feedRef.current = [item, ...feedRef.current].slice(0, 100);
    setItems([...feedRef.current]);
  }, []);

  // Load initial data from multiple sources
  useEffect(() => {
    if (Object.keys(profileMap).length === 0) return;

    const loadInitial = async () => {
      setLoading(true);
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const allItems: FeedItem[] = [];

      const [leadsRes, contactsRes, callsRes, activityLogRes, casesRes] = await Promise.all([
        supabase.from('leads').select('id, lead_name, created_by, updated_by, lead_status, created_at, updated_at').gte('created_at', since).order('created_at', { ascending: false }).limit(50),
        supabase.from('contacts').select('id, full_name, created_by, created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(50),
        supabase.from('call_records').select('id, user_id, contact_name, lead_name, call_result, created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(50),
        supabase.from('user_activity_log').select('id, user_id, action_type, entity_type, metadata, created_at').gte('created_at', since).in('action_type', ['checklist_item_checked', 'comment_reply', 'dm_sent', 'lead_moved', 'lead_created', 'lead_updated', 'contact_created']).order('created_at', { ascending: false }).limit(50),
        supabase.from('case_process_tracking').select('id, acolhedor, cliente, status_processo, created_at, updated_at').gte('created_at', since).order('created_at', { ascending: false }).limit(30),
      ]);

      // Leads (include agent-created leads too)
      (leadsRes.data || []).forEach(l => {
        const userId = l.created_by || 'system';
        const userName = l.created_by ? getUserName(l.created_by) : '🤖 Agente IA';
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
        });
      });

      // Contacts (include agent-created too)
      (contactsRes.data || []).forEach(c => {
        const userId = c.created_by || 'system';
        const userName = c.created_by ? getUserName(c.created_by) : '🤖 Agente IA';
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

      // Activity log items
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
        // Find user_id from acolhedor name (reverse lookup)
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

      // Sort by timestamp desc
      allItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      feedRef.current = allItems.slice(0, 100);
      setItems([...feedRef.current]);
      setLoading(false);
    };

    loadInitial();
  }, [profileMap, getUserName]);

  // Realtime subscriptions
  useEffect(() => {
    if (Object.keys(profileMap).length === 0) return;

    const channel = supabase.channel('team-realtime-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, (payload) => {
        const l = payload.new as any;
        if (!l.created_by) return;
        addItem({
          id: `lead-rt-${l.id}-${Date.now()}`,
          userId: l.created_by,
          userName: getUserName(l.created_by),
          actionType: 'lead_created',
          actionLabel: ACTION_CONFIG.lead_created.label,
          entityName: l.lead_name || 'Lead',
          icon: ACTION_CONFIG.lead_created.icon,
          color: ACTION_CONFIG.lead_created.color,
          timestamp: l.created_at || new Date().toISOString(),
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
        if (!c.created_by) return;
        addItem({
          id: `contact-rt-${c.id}-${Date.now()}`,
          userId: c.created_by,
          userName: getUserName(c.created_by),
          actionType: 'contact_created',
          actionLabel: ACTION_CONFIG.contact_created.label,
          entityName: c.name || 'Contato',
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
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            Nenhuma atividade registrada nas últimas 24h
          </div>
        ) : (
          <ScrollArea className="h-[600px] pr-2">
            <div className="space-y-1">
              {items.map((item, idx) => {
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
                      <AvatarFallback className="text-[10px] font-semibold bg-primary/10 text-primary">
                        {getInitials(item.userName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-snug">
                        <span className="font-semibold text-foreground">{item.userName.split(' ')[0]}</span>
                        {' '}
                        <span className="text-muted-foreground">{item.actionLabel}</span>
                        {item.entityName && (
                          <>
                            {' · '}
                            <span className="font-medium text-foreground">{item.entityName}</span>
                          </>
                        )}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {formatDistanceToNow(new Date(item.timestamp), { addSuffix: true, locale: ptBR })}
                      </p>
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
