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
import { Loader2, ExternalLink, Target, MessageSquare, Send, Phone, ArrowRightLeft, ListChecks, CheckCircle2, AlertTriangle, Trophy, Users, Briefcase, CalendarIcon, Check, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { startOfDay, endOfDay, format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, eachDayOfInterval, isToday as isTodayFn, subWeeks } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';

export type MetricKey =
  | 'commentReplies' | 'dmsSent' | 'contactsCreated' | 'leadsCreated'
  | 'leadsClosed' | 'leadsProgressed' | 'callsMade' | 'stageChanges'
  | 'checklistItemsChecked' | 'activitiesCompleted' | 'activitiesOverdue';

type PeriodKey = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'this_year' | 'last_x_days' | 'custom';

interface MetricDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metricKey: MetricKey | null;
}

const METRIC_CONFIG: Record<MetricKey, { label: string; icon: React.ElementType; color: string }> = {
  commentReplies: { label: 'Respostas de Comentários', icon: MessageSquare, color: 'text-blue-500' },
  dmsSent: { label: 'DMs Enviadas', icon: Send, color: 'text-violet-500' },
  contactsCreated: { label: 'Contatos Criados', icon: Users, color: 'text-teal-500' },
  leadsCreated: { label: 'Leads Criados', icon: Target, color: 'text-indigo-500' },
  leadsClosed: { label: 'Leads Fechados', icon: Trophy, color: 'text-yellow-500' },
  leadsProgressed: { label: 'Leads com Progresso', icon: Briefcase, color: 'text-purple-500' },
  callsMade: { label: 'Ligações Realizadas', icon: Phone, color: 'text-green-500' },
  stageChanges: { label: 'Mudanças de Etapa', icon: ArrowRightLeft, color: 'text-amber-500' },
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

// Map metric keys to goal target keys
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

export function MetricDetailSheet({ open, onOpenChange, metricKey }: MetricDetailSheetProps) {
  const { user } = useAuthContext();
  const navigate = useNavigate();
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState<PeriodKey>('today');
  const [lastXDays, setLastXDays] = useState(7);
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();
  const [dailyTarget, setDailyTarget] = useState(0);

  // Reset period when opening
  useEffect(() => {
    if (open) setPeriod('today');
  }, [open]);

  const dateRange = useMemo(() => getDateRange(period, lastXDays, customFrom, customTo), [period, lastXDays, customFrom, customTo]);

  const isMultiDay = useMemo(() => {
    return format(dateRange.start, 'yyyy-MM-dd') !== format(dateRange.end, 'yyyy-MM-dd');
  }, [dateRange]);

  useEffect(() => {
    if (!open || !metricKey || !user) return;
    fetchItems(metricKey);
  }, [open, metricKey, user, dateRange]);

  // Fetch daily goal target for this metric
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
        setDailyTarget((userGoal as any)[goalKey]);
        return;
      }

      const { data: defaults } = await supabase.from('workflow_default_goals')
        .select('*').limit(1).maybeSingle();
      
      if (defaults && (defaults as any)[goalKey] != null) {
        setDailyTarget((defaults as any)[goalKey]);
      } else {
        // Hardcoded fallback
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
    if (!user) return;
    setLoading(true);
    setItems([]);

    const startDate = dateRange.start.toISOString();
    const endDate = dateRange.end.toISOString();
    const userId = user.id;

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
          const { data } = await supabase.from('leads').select('id, lead_name, status, created_at')
            .eq('created_by', userId).gte('created_at', startDate).lte('created_at', endDate)
            .order('created_at', { ascending: false });
          result = (data || []).map(l => ({
            id: l.id, title: l.lead_name || 'Sem nome', subtitle: l.status || undefined,
            badge: format(new Date(l.created_at), 'HH:mm'), navigateTo: '/leads',
            date: format(new Date(l.created_at), 'yyyy-MM-dd'),
          }));
          break;
        }
        case 'leadsClosed': {
          const { data } = await supabase.from('leads').select('id, lead_name, status, created_at')
            .eq('created_by', userId).gte('created_at', startDate).lte('created_at', endDate)
            .in('status', ['converted', 'won', 'closed', 'fechado', 'done'])
            .order('created_at', { ascending: false });
          result = (data || []).map(l => ({
            id: l.id, title: l.lead_name || 'Sem nome',
            badge: '✓ Fechado', badgeVariant: 'default' as const, navigateTo: '/leads',
            date: format(new Date(l.created_at), 'yyyy-MM-dd'),
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
            .select('id, instagram_username, dm_message, created_at')
            .eq('user_id', userId).eq('action_type', 'sent')
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
            navigateTo: '/leads',
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
            const { data: leads } = await supabase.from('leads').select('id, lead_name, status').in('id', uniqueLeadIds);
            result = (leads || []).map(l => ({
              id: l.id, title: l.lead_name || 'Sem nome', subtitle: l.status || undefined, navigateTo: '/leads',
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

  // Daily summary for multi-day periods
  const daySummaries = useMemo<DaySummary[]>(() => {
    if (!isMultiDay || dailyTarget === 0) return [];
    const days = eachDayOfInterval({ start: dateRange.start, end: dateRange.end > new Date() ? new Date() : dateRange.end });
    return days.map(day => {
      const dayStr = format(day, 'yyyy-MM-dd');
      const count = items.filter(i => i.date === dayStr).length;
      return { date: day, count, goalMet: count >= dailyTarget, target: dailyTarget };
    }).reverse(); // most recent first
  }, [items, isMultiDay, dailyTarget, dateRange]);

  const metDays = daySummaries.filter(d => d.goalMet).length;
  const totalDays = daySummaries.length;

  const config = metricKey ? METRIC_CONFIG[metricKey] : null;
  const Icon = config?.icon || Target;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {config && <Icon className={`h-5 w-5 ${config.color}`} />}
            {config?.label || 'Detalhes'}
            <Badge variant="secondary" className="ml-auto">{items.length}</Badge>
          </SheetTitle>
        </SheetHeader>

        {/* Period selector */}
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
              <Input
                type="number" min={1} max={365} value={lastXDays}
                onChange={e => setLastXDays(Math.max(1, parseInt(e.target.value) || 7))}
                className="h-8 w-20 text-xs"
              />
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
                  <Calendar mode="single" selected={customFrom} onSelect={setCustomFrom} locale={ptBR} />
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
                  <Calendar mode="single" selected={customTo} onSelect={setCustomTo} locale={ptBR} />
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* Period label */}
          <p className="text-[10px] text-muted-foreground">
            {format(dateRange.start, "dd/MM/yyyy")} — {format(dateRange.end, "dd/MM/yyyy")}
          </p>
        </div>

        {/* Daily goal summary for multi-day */}
        {isMultiDay && dailyTarget > 0 && !loading && daySummaries.length > 0 && (
          <div className="mt-3 p-3 rounded-lg border bg-muted/30 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold">Resumo de Metas Diárias</p>
              <Badge variant={metDays === totalDays ? 'default' : 'secondary'} className="text-[10px]">
                {metDays}/{totalDays} dias atingidos
              </Badge>
            </div>
            <div className="flex flex-wrap gap-1">
              {daySummaries.map(day => (
                <div
                  key={day.date.toISOString()}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border ${
                    day.goalMet
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
                      : 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400'
                  }`}
                  title={`${format(day.date, 'dd/MM')} — ${day.count}/${day.target}`}
                >
                  {day.goalMet ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                  <span>{format(day.date, 'dd/MM')}</span>
                  <span className="opacity-70">{day.count}/{day.target}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <ScrollArea className="h-[calc(100vh-320px)] mt-3 -mx-2 px-2">
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
                    if (item.navigateTo) {
                      onOpenChange(false);
                      navigate(item.navigateTo);
                    }
                  }}
                >
                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                    <Icon className={`h-4 w-4 ${config?.color || 'text-muted-foreground'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.title}</p>
                    {item.subtitle && (
                      <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {isMultiDay && item.date && (
                      <span className="text-[10px] text-muted-foreground">{format(new Date(item.date), 'dd/MM')}</span>
                    )}
                    {item.badge && (
                      <Badge variant={item.badgeVariant || 'outline'} className="text-[10px]">
                        {item.badge}
                      </Badge>
                    )}
                  </div>
                  {item.navigateTo && (
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
