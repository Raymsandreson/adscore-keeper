import { useState, useEffect, useMemo } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Progress } from '@/components/ui/progress';
import { AnimatedNumber } from '@/components/ui/animated-number';
import {
  Loader2, ExternalLink, Target, MessageSquare, Send, Phone, ArrowRightLeft,
  ListChecks, CheckCircle2, AlertTriangle, Trophy, Users, Briefcase, CalendarIcon,
  Check, X, ChevronRight, TrendingUp, History,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import {
  startOfDay, endOfDay, format, subDays, startOfWeek, endOfWeek, startOfMonth,
  endOfMonth, startOfYear, endOfYear, eachDayOfInterval,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

export type MetricKey =
  | 'commentReplies' | 'dmsSent' | 'contactsCreated' | 'leadsCreated'
  | 'leadsClosed' | 'leadsProgressed' | 'callsMade' | 'stageChanges'
  | 'checklistItemsChecked' | 'activitiesCompleted' | 'activitiesOverdue';

type PeriodKey = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'this_year' | 'last_x_days' | 'custom';

interface MetricDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metricKey: MetricKey | null;
  /** Optional: show data for a different user instead of the logged-in user */
  targetUserId?: string;
  targetUserName?: string;
  /** Optional: lock the date range (disables period picker) */
  dateRangeOverride?: { start: Date; end: Date };
}

const METRIC_CONFIG: Record<MetricKey, { label: string; icon: React.ElementType; color: string }> = {
  commentReplies: { label: 'Respostas de Comentários', icon: MessageSquare, color: 'text-blue-500' },
  dmsSent: { label: 'DMs Enviadas', icon: Send, color: 'text-violet-500' },
  contactsCreated: { label: 'Contatos Criados', icon: Users, color: 'text-teal-500' },
  leadsCreated: { label: 'Leads Criados', icon: Target, color: 'text-indigo-500' },
  leadsClosed: { label: 'Leads Fechados', icon: Trophy, color: 'text-yellow-500' },
  leadsProgressed: { label: 'Leads com Progresso', icon: Briefcase, color: 'text-purple-500' },
  callsMade: { label: 'Ligações Realizadas', icon: Phone, color: 'text-green-500' },
  stageChanges: { label: 'Mudanças de Fase', icon: ArrowRightLeft, color: 'text-amber-500' },
  checklistItemsChecked: { label: 'Passos Concluídos', icon: ListChecks, color: 'text-cyan-500' },
  activitiesCompleted: { label: 'Atividades Concluídas', icon: CheckCircle2, color: 'text-emerald-500' },
  activitiesOverdue: { label: 'Atividades Atrasadas', icon: AlertTriangle, color: 'text-red-500' },
};

const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: 'this_week', label: 'Esta semana' },
  { value: 'this_month', label: 'Este mês' },
  { value: 'this_year', label: 'Este ano' },
  { value: 'last_x_days', label: 'Últimos X dias' },
  { value: 'custom', label: 'Personalizado' },
];

interface ListItem {
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
  badgeVariant?: 'default' | 'secondary' | 'destructive' | 'outline';
  navigateTo?: string;
  date?: string;
}

interface DaySummary {
  date: Date;
  count: number;
  goalMet: boolean;
  target: number;
  pct: number;
}

function getDateRange(period: PeriodKey, lastXDays: number, customFrom?: Date, customTo?: Date): { start: Date; end: Date } {
  const now = new Date();
  switch (period) {
    case 'today': return { start: startOfDay(now), end: endOfDay(now) };
    case 'yesterday': { const y = subDays(now, 1); return { start: startOfDay(y), end: endOfDay(y) }; }
    case 'this_week': return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
    case 'this_month': return { start: startOfMonth(now), end: endOfMonth(now) };
    case 'this_year': return { start: startOfYear(now), end: endOfYear(now) };
    case 'last_x_days': return { start: startOfDay(subDays(now, lastXDays - 1)), end: endOfDay(now) };
    case 'custom': return { start: startOfDay(customFrom || now), end: endOfDay(customTo || now) };
    default: return { start: startOfDay(now), end: endOfDay(now) };
  }
}

const METRIC_TO_GOAL: Partial<Record<MetricKey, string>> = {
  commentReplies: 'target_replies',
  dmsSent: 'target_dms',
  contactsCreated: 'target_contacts',
  leadsCreated: 'target_leads',
  callsMade: 'target_calls',
  stageChanges: 'target_stage_changes',
  leadsClosed: 'target_leads_closed',
  checklistItemsChecked: 'target_checklist_items',
  activitiesCompleted: 'target_activities',
};

export function MetricDetailSheet({ open, onOpenChange, metricKey, targetUserId, targetUserName, dateRangeOverride }: MetricDetailSheetProps) {
  const { user } = useAuthContext();
  const navigate = useNavigate();
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState<PeriodKey>('today');
  const [lastXDays, setLastXDays] = useState(7);
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();
  const [dailyTarget, setDailyTarget] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [filterUserId, setFilterUserId] = useState<string>('all');
  const [teamMembers, setTeamMembers] = useState<{ user_id: string; full_name: string }[]>([]);

  useEffect(() => {
    if (open) { if (!dateRangeOverride) setPeriod('today'); setHistoryOpen(false); setFilterUserId('all'); }
  }, [open, dateRangeOverride]);

  useEffect(() => {
    if (open && metricKey === 'leadsClosed') {
      supabase.from('profiles').select('user_id, full_name').then(({ data }) => {
        setTeamMembers((data || []).filter(p => p.full_name).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')));
      });
    }
  }, [open, metricKey]);

  const dateRange = useMemo(() => dateRangeOverride || getDateRange(period, lastXDays, customFrom, customTo), [dateRangeOverride, period, lastXDays, customFrom, customTo]);

  const isMultiDay = useMemo(() => {
    return format(dateRange.start, 'yyyy-MM-dd') !== format(dateRange.end, 'yyyy-MM-dd');
  }, [dateRange]);

  useEffect(() => {
    if (!open || !metricKey || (!user && !targetUserId)) return;
    fetchItems(metricKey);
  }, [open, metricKey, user, targetUserId, dateRange, filterUserId]);

  useEffect(() => {
    if (!open || !metricKey || !user) return;
    fetchGoalTarget(metricKey);
  }, [open, metricKey, user]);

  const fetchGoalTarget = async (key: MetricKey) => {
    if (!user) return;
    const goalKey = METRIC_TO_GOAL[key];
    if (!goalKey) { setDailyTarget(0); return; }
    try {
      const today = format(new Date(), 'yyyy-MM-dd');
      const { data: userGoal } = await supabase.from('workflow_daily_goals')
        .select('*').eq('user_id', user.id).eq('goal_date', today).maybeSingle();
      if (userGoal && (userGoal as any)[goalKey] != null) {
        setDailyTarget((userGoal as any)[goalKey]); return;
      }
      const { data: defaults } = await supabase.from('workflow_default_goals')
        .select('*').limit(1).maybeSingle();
      if (defaults && (defaults as any)[goalKey] != null) {
        setDailyTarget((defaults as any)[goalKey]);
      } else {
        const fallbacks: Record<string, number> = {
          target_replies: 20, target_dms: 10, target_leads: 5, target_contacts: 5,
          target_calls: 10, target_stage_changes: 10, target_leads_closed: 2,
          target_checklist_items: 10, target_activities: 5,
        };
        setDailyTarget(fallbacks[goalKey] || 0);
      }
    } catch { setDailyTarget(0); }
  };

  const fetchItems = async (key: MetricKey) => {
    if (!user && !targetUserId) return;
    setLoading(true);
    setItems([]);
    const startDate = dateRange.start.toISOString();
    const endDate = dateRange.end.toISOString();
    const userId = targetUserId || user!.id;
    try {
      let result: ListItem[] = [];
      switch (key) {
        case 'contactsCreated': {
          const { data } = await supabase.from('contacts').select('id, full_name, instagram_username, phone, created_at')
            .eq('created_by', userId).gte('created_at', startDate).lte('created_at', endDate)
            .order('created_at', { ascending: false });
          result = (data || []).map(c => ({
            id: c.id, title: c.full_name,
            subtitle: c.instagram_username ? `@${c.instagram_username}` : c.phone || undefined,
            badge: format(new Date(c.created_at), 'HH:mm'),
            date: format(new Date(c.created_at), 'yyyy-MM-dd'),
          }));
          break;
        }
        case 'leadsCreated': {
          const { data } = await supabase.from('leads').select('id, lead_name, status, board_id, created_at')
            .eq('created_by', userId).gte('created_at', startDate).lte('created_at', endDate)
            .order('created_at', { ascending: false });
          result = (data || []).map(l => ({
            id: l.id, title: l.lead_name || 'Sem nome', subtitle: l.status || undefined,
            badge: format(new Date(l.created_at), 'HH:mm'),
            navigateTo: l.board_id ? `/leads?board=${l.board_id}&openLead=${l.id}` : `/leads?openLead=${l.id}`,
            date: format(new Date(l.created_at), 'yyyy-MM-dd'),
          }));
          break;
        }
        case 'leadsClosed': {
          // Query leads that are currently closed, filtered by updated_at (when they were closed)
          const { data: closedLeads } = await supabase.from('leads')
            .select('id, lead_name, board_id, updated_at, lead_status')
            .eq('lead_status', 'closed')
            .gte('updated_at', startDate).lte('updated_at', endDate)
            .order('updated_at', { ascending: false });
          
          let filteredLeads = closedLeads || [];
          
          // If filtering by user, check who closed the lead via stage history
          if (filterUserId !== 'all' || targetUserId) {
            const effectiveUserId = filterUserId !== 'all' ? filterUserId : userId;
            const leadIds = filteredLeads.map(l => l.id);
            if (leadIds.length > 0) {
              const { data: historyData } = await supabase.from('lead_stage_history')
                .select('lead_id, changed_by')
                .in('lead_id', leadIds)
                .eq('to_stage', 'closed');
              const closedByUser = new Set(
                (historyData || []).filter(h => h.changed_by === effectiveUserId).map(h => h.lead_id)
              );
              filteredLeads = filteredLeads.filter(l => closedByUser.has(l.id));
            }
          }

          // Get user names for who closed each lead (for "all" view)
          let userNamesMap: Record<string, string> = {};
          if (filterUserId === 'all' && filteredLeads.length > 0) {
            const leadIds = filteredLeads.map(l => l.id);
            const { data: historyData } = await supabase.from('lead_stage_history')
              .select('lead_id, changed_by')
              .in('lead_id', leadIds)
              .eq('to_stage', 'closed');
            
            const leadCloserMap: Record<string, string> = {};
            (historyData || []).forEach(h => {
              if (h.changed_by) leadCloserMap[h.lead_id] = h.changed_by;
            });
            
            const closerIds = [...new Set(Object.values(leadCloserMap))];
            if (closerIds.length > 0) {
              const { data: profiles } = await supabase.from('profiles')
                .select('user_id, full_name').in('user_id', closerIds);
              (profiles || []).forEach(p => { userNamesMap[p.user_id] = p.full_name || 'Usuário'; });
            }
            
            // Attach closer name to each lead
            filteredLeads = filteredLeads.map(l => ({ ...l, _closerName: userNamesMap[leadCloserMap[l.id]] })) as any;
          }
          
          result = filteredLeads.map((l: any) => ({
            id: l.id, 
            title: l.lead_name || 'Sem nome',
            subtitle: filterUserId === 'all' && l._closerName ? `👤 ${l._closerName}` : undefined,
            badge: '✓ Fechado', badgeVariant: 'default' as const,
            navigateTo: l.board_id 
              ? `/leads?board=${l.board_id}&openLead=${l.id}` 
              : `/leads?openLead=${l.id}`,
            date: l.updated_at ? format(new Date(l.updated_at), 'yyyy-MM-dd') : undefined,
          }));
          break;
        }
        case 'commentReplies': {
          const { data } = await supabase.from('instagram_comments')
            .select('id, author_username, comment_text, replied_at')
            .eq('replied_by', userId).gte('replied_at', startDate).lte('replied_at', endDate)
            .order('replied_at', { ascending: false });
          result = (data || []).map(c => ({
            id: c.id, title: `@${c.author_username || 'desconhecido'}`,
            subtitle: c.comment_text ? (c.comment_text.length > 60 ? c.comment_text.slice(0, 60) + '...' : c.comment_text) : undefined,
            badge: c.replied_at ? format(new Date(c.replied_at), 'HH:mm') : undefined,
            date: c.replied_at ? format(new Date(c.replied_at), 'yyyy-MM-dd') : undefined,
          }));
          break;
        }
        case 'dmsSent': {
          const { data } = await supabase.from('dm_history')
            .select('id, instagram_username, dm_message, created_at, action_type')
            .eq('user_id', userId).neq('action_type', 'received')
            .gte('created_at', startDate).lte('created_at', endDate)
            .order('created_at', { ascending: false });
          result = (data || []).map(d => ({
            id: d.id, title: `@${d.instagram_username}`,
            subtitle: d.dm_message ? (d.dm_message.length > 60 ? d.dm_message.slice(0, 60) + '...' : d.dm_message) : undefined,
            badge: format(new Date(d.created_at), 'HH:mm'),
            date: format(new Date(d.created_at), 'yyyy-MM-dd'),
          }));
          break;
        }
        case 'stageChanges': {
          const { data } = await supabase.from('lead_stage_history')
            .select('id, lead_id, from_stage, to_stage, changed_at')
            .eq('changed_by', userId).gte('changed_at', startDate).lte('changed_at', endDate)
            .order('changed_at', { ascending: false });
          const leadIds = [...new Set((data || []).map(s => s.lead_id))];
          let leadNames: Record<string, string> = {};
          if (leadIds.length > 0) {
            const { data: leads } = await supabase.from('leads').select('id, lead_name').in('id', leadIds);
            leadNames = Object.fromEntries((leads || []).map(l => [l.id, l.lead_name || 'Sem nome']));
          }
          result = (data || []).map(s => ({
            id: s.id, title: leadNames[s.lead_id] || 'Lead',
            subtitle: `${s.from_stage || '?'} → ${s.to_stage || '?'}`,
            badge: s.changed_at ? format(new Date(s.changed_at), 'HH:mm') : undefined,
            navigateTo: `/leads?openLead=${s.lead_id}`,
            date: s.changed_at ? format(new Date(s.changed_at), 'yyyy-MM-dd') : undefined,
          }));
          break;
        }
        case 'leadsProgressed': {
          const { data } = await supabase.from('lead_stage_history')
            .select('lead_id, changed_at')
            .eq('changed_by', userId).gte('changed_at', startDate).lte('changed_at', endDate)
            .order('changed_at', { ascending: false });
          const uniqueLeadIds = [...new Set((data || []).map(s => s.lead_id))];
          if (uniqueLeadIds.length > 0) {
            const { data: leads } = await supabase.from('leads').select('id, lead_name, status, board_id').in('id', uniqueLeadIds);
            result = (leads || []).map(l => ({
              id: l.id, title: l.lead_name || 'Sem nome', subtitle: l.status || undefined,
              navigateTo: l.board_id ? `/leads?board=${l.board_id}&openLead=${l.id}` : `/leads?openLead=${l.id}`,
            }));
          }
          break;
        }
        case 'callsMade': {
          const { data } = await supabase.from('cat_lead_contacts')
            .select('id, cat_lead_id, contact_channel, contact_result, phone_used, created_at')
            .eq('contacted_by', userId).in('contact_channel', ['phone', 'ligacao'])
            .gte('created_at', startDate).lte('created_at', endDate)
            .order('created_at', { ascending: false });
          const catIds = [...new Set((data || []).map(c => c.cat_lead_id))];
          let catNames: Record<string, string> = {};
          if (catIds.length > 0) {
            const { data: cats } = await supabase.from('cat_leads').select('id, nome_completo').in('id', catIds);
            catNames = Object.fromEntries((cats || []).map(c => [c.id, c.nome_completo]));
          }
          result = (data || []).map(c => ({
            id: c.id, title: catNames[c.cat_lead_id] || 'Contato',
            subtitle: c.phone_used ? `📞 ${c.phone_used}` : undefined,
            badge: format(new Date(c.created_at), 'HH:mm'),
            date: format(new Date(c.created_at), 'yyyy-MM-dd'),
          }));
          break;
        }
        case 'checklistItemsChecked': {
          const { data } = await supabase.from('user_activity_log')
            .select('id, action_type, entity_type, entity_id, metadata, created_at')
            .eq('user_id', userId).eq('action_type', 'checklist_item_checked')
            .gte('created_at', startDate).lte('created_at', endDate)
            .order('created_at', { ascending: false });
          result = (data || []).map(a => ({
            id: a.id, title: (a.metadata as any)?.item_label || (a.metadata as any)?.checklist_name || 'Passo',
            subtitle: (a.metadata as any)?.lead_name || undefined,
            badge: format(new Date(a.created_at), 'HH:mm'),
            date: format(new Date(a.created_at), 'yyyy-MM-dd'),
          }));
          break;
        }
        case 'activitiesCompleted': {
          const { data } = await supabase.from('lead_activities')
            .select('id, title, lead_name, completed_at')
            .eq('completed_by', userId).eq('status', 'concluida')
            .gte('completed_at', startDate).lte('completed_at', endDate)
            .order('completed_at', { ascending: false });
          result = (data || []).map(a => ({
            id: a.id, title: a.title || 'Atividade', subtitle: a.lead_name || undefined,
            badge: a.completed_at ? format(new Date(a.completed_at), 'HH:mm') : undefined,
            date: a.completed_at ? format(new Date(a.completed_at), 'yyyy-MM-dd') : undefined,
          }));
          break;
        }
        case 'activitiesOverdue': {
          const now = new Date();
          const { data } = await supabase.from('lead_activities')
            .select('id, title, lead_name, deadline')
            .eq('assigned_to', userId).eq('status', 'pendente')
            .lt('deadline', format(now, 'yyyy-MM-dd'))
            .not('deadline', 'is', null)
            .order('deadline', { ascending: true });
          result = (data || []).map(a => ({
            id: a.id, title: a.title || 'Atividade', subtitle: a.lead_name || undefined,
            badge: a.deadline || undefined, badgeVariant: 'destructive' as const,
            date: a.deadline || undefined,
          }));
          break;
        }
      }
      setItems(result);
    } catch (error) {
      console.error('Error fetching metric detail:', error);
    } finally {
      setLoading(false);
    }
  };

  // Daily summaries
  const daySummaries = useMemo<DaySummary[]>(() => {
    if (dailyTarget === 0) return [];
    const endLimit = dateRange.end > new Date() ? new Date() : dateRange.end;
    const days = eachDayOfInterval({ start: dateRange.start, end: endLimit });
    return days.map(day => {
      const dayStr = format(day, 'yyyy-MM-dd');
      const count = items.filter(i => i.date === dayStr).length;
      const pct = dailyTarget > 0 ? Math.min(Math.round((count / dailyTarget) * 100), 999) : 0;
      return { date: day, count, goalMet: count >= dailyTarget, target: dailyTarget, pct };
    }).reverse();
  }, [items, dailyTarget, dateRange]);

  // Aggregated stats
  const totalCount = items.length;
  const totalTarget = useMemo(() => {
    if (dailyTarget === 0) return 0;
    const endLimit = dateRange.end > new Date() ? new Date() : dateRange.end;
    const days = eachDayOfInterval({ start: dateRange.start, end: endLimit });
    return days.length * dailyTarget;
  }, [dailyTarget, dateRange]);
  const overallPct = totalTarget > 0 ? Math.min(Math.round((totalCount / totalTarget) * 100), 999) : 0;
  const metDays = daySummaries.filter(d => d.goalMet).length;
  const totalDays = daySummaries.length;

  const config = metricKey ? METRIC_CONFIG[metricKey] : null;
  const Icon = config?.icon || Target;

  const pctColor = overallPct >= 100 ? 'text-emerald-500' : overallPct >= 50 ? 'text-amber-500' : 'text-red-500';

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              {config && <Icon className={`h-5 w-5 ${config.color}`} />}
              <span className="truncate">
                {config?.label || 'Detalhes'}
                {targetUserName && <span className="text-muted-foreground font-normal text-sm"> — {targetUserName}</span>}
              </span>
            </SheetTitle>
          </SheetHeader>

          {/* Period selector - hidden when dateRangeOverride is set */}
          {!dateRangeOverride && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
                <SelectTrigger className="h-8 text-xs flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIOD_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {period === 'last_x_days' && (
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Últimos</Label>
                <Input type="number" min={1} max={365} value={lastXDays}
                  onChange={e => setLastXDays(Math.max(1, parseInt(e.target.value) || 7))}
                  className="h-8 w-20 text-xs" />
                <span className="text-xs text-muted-foreground">dias</span>
              </div>
            )}

            {period === 'custom' && (
              <div className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 text-xs flex-1">
                      {customFrom ? format(customFrom, 'dd/MM/yyyy') : 'De'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={customFrom} onSelect={setCustomFrom} locale={ptBR} className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
                <span className="text-xs text-muted-foreground">até</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 text-xs flex-1">
                      {customTo ? format(customTo, 'dd/MM/yyyy') : 'Até'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar mode="single" selected={customTo} onSelect={setCustomTo} locale={ptBR} className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>
            )}

            <p className="text-[10px] text-muted-foreground">
              {format(dateRange.start, "dd/MM/yyyy")} — {format(dateRange.end, "dd/MM/yyyy")}
            </p>

            {metricKey === 'leadsClosed' && teamMembers.length > 0 && (
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <Select value={filterUserId} onValueChange={setFilterUserId}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Filtrar por acolhedor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os acolhedores</SelectItem>
                    {teamMembers.map(m => (
                      <SelectItem key={m.user_id} value={m.user_id}>{m.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          )}
          {dateRangeOverride && (
            <p className="mt-3 text-[10px] text-muted-foreground">
              {format(dateRange.start, 'HH:mm')} — {format(dateRange.end, 'HH:mm')}
            </p>
          )}

          {/* Summary card */}
          {!loading && (
            <div className="mt-4 p-4 rounded-xl border bg-muted/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center", config?.color === 'text-blue-500' ? 'bg-blue-500/10' : config?.color === 'text-violet-500' ? 'bg-violet-500/10' : config?.color === 'text-teal-500' ? 'bg-teal-500/10' : config?.color === 'text-indigo-500' ? 'bg-indigo-500/10' : config?.color === 'text-yellow-500' ? 'bg-yellow-500/10' : config?.color === 'text-purple-500' ? 'bg-purple-500/10' : config?.color === 'text-green-500' ? 'bg-green-500/10' : config?.color === 'text-amber-500' ? 'bg-amber-500/10' : config?.color === 'text-cyan-500' ? 'bg-cyan-500/10' : config?.color === 'text-emerald-500' ? 'bg-emerald-500/10' : config?.color === 'text-red-500' ? 'bg-red-500/10' : 'bg-muted')}>
                    <Icon className={`h-6 w-6 ${config?.color}`} />
                  </div>
                  <div>
                    <AnimatedNumber value={totalCount} className="text-3xl font-bold leading-none" />
                    {totalTarget > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        de {totalTarget} ({isMultiDay ? `${totalDays} dias × ${dailyTarget}` : `meta: ${dailyTarget}`})
                      </p>
                    )}
                  </div>
                </div>
                {totalTarget > 0 && (
                  <div className="text-right">
                    <AnimatedNumber value={overallPct} suffix="%" className={cn("text-2xl font-bold", pctColor)} />
                    <p className="text-[10px] text-muted-foreground">atingimento</p>
                  </div>
                )}
              </div>

              {totalTarget > 0 && (
                <Progress value={Math.min(overallPct, 100)} className="h-2" />
              )}

              {/* Mini day streak for multi-day */}
              {isMultiDay && dailyTarget > 0 && daySummaries.length > 0 && (
                <div
                  className="flex items-center justify-between p-2.5 rounded-lg border bg-background cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => setHistoryOpen(true)}
                >
                  <div className="flex items-center gap-2">
                    <History className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs font-semibold">Histórico por dia</p>
                      <p className="text-[10px] text-muted-foreground">
                        {metDays}/{totalDays} dias com meta atingida
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Mini indicators (last 7 days max) */}
                    <div className="flex gap-0.5">
                      {daySummaries.slice(0, 7).reverse().map(d => (
                        <div
                          key={d.date.toISOString()}
                          className={cn(
                            "h-3 w-3 rounded-sm",
                            d.goalMet ? "bg-emerald-500" : "bg-red-400"
                          )}
                          title={`${format(d.date, 'dd/MM')} — ${d.count}/${d.target}`}
                        />
                      ))}
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              )}

              {/* Single day goal status */}
              {!isMultiDay && dailyTarget > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  {totalCount >= dailyTarget ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">Meta diária atingida! 🎉</span>
                    </>
                  ) : (
                    <>
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Faltam <strong>{dailyTarget - totalCount}</strong> para a meta</span>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Items list */}
          <ScrollArea className="h-[calc(100vh-420px)] mt-3 -mx-2 px-2">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <Icon className="h-10 w-10 mb-3 opacity-30" />
                <p className="text-sm">Nenhum item encontrado neste período</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {items.map((item, idx) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 p-2.5 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-default animate-fade-in"
                    style={{ animationDelay: `${idx * 30}ms`, animationFillMode: 'backwards' }}
                    onClick={() => {
                      if (item.navigateTo) { onOpenChange(false); navigate(item.navigateTo); }
                    }}
                  >
                    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                      <Icon className={`h-4 w-4 ${config?.color || 'text-muted-foreground'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.title}</p>
                      {item.subtitle && <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {isMultiDay && item.date && (
                        <span className="text-[10px] text-muted-foreground">{format(new Date(item.date), 'dd/MM')}</span>
                      )}
                      {item.badge && (
                        <Badge variant={item.badgeVariant || 'outline'} className="text-[10px]">{item.badge}</Badge>
                      )}
                    </div>
                    {item.navigateTo && <ExternalLink className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* History detail sheet (nested) */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent className="sm:max-w-sm" side="right">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-muted-foreground" />
              Histórico Diário
            </SheetTitle>
          </SheetHeader>

          <div className="mt-3 flex items-center justify-between p-3 rounded-lg border bg-muted/30">
            <div>
              <p className="text-2xl font-bold">{metDays}<span className="text-sm font-normal text-muted-foreground">/{totalDays}</span></p>
              <p className="text-xs text-muted-foreground">dias com meta atingida</p>
            </div>
            <div className="text-right">
              <p className={cn("text-2xl font-bold", totalDays > 0 && (metDays / totalDays) >= 0.7 ? 'text-emerald-500' : (metDays / totalDays) >= 0.4 ? 'text-amber-500' : 'text-red-500')}>
                {totalDays > 0 ? Math.round((metDays / totalDays) * 100) : 0}%
              </p>
              <p className="text-xs text-muted-foreground">consistência</p>
            </div>
          </div>

          <ScrollArea className="h-[calc(100vh-200px)] mt-3 -mx-2 px-2">
            <div className="space-y-1.5">
              {daySummaries.map(day => (
                <div
                  key={day.date.toISOString()}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border transition-colors",
                    day.goalMet
                      ? "bg-emerald-500/5 border-emerald-500/20"
                      : "bg-red-500/5 border-red-500/20"
                  )}
                >
                  <div className={cn(
                    "h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0",
                    day.goalMet ? "bg-emerald-500/20" : "bg-red-500/20"
                  )}>
                    {day.goalMet
                      ? <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      : <X className="h-4 w-4 text-red-600 dark:text-red-400" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {format(day.date, "EEEE, dd/MM", { locale: ptBR })}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <Progress value={Math.min(day.pct, 100)} className="h-1.5 flex-1" />
                      <span className={cn("text-xs font-semibold min-w-[36px] text-right", day.goalMet ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
                        {day.pct}%
                      </span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold">{day.count}</p>
                    <p className="text-[10px] text-muted-foreground">/{day.target}</p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}
