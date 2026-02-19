import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Target, Plus, Edit2, Trash2, DollarSign, TrendingUp, Users, Award,
  ChevronDown, ChevronUp, Loader2, UsersRound, LayoutGrid, X, List,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { useTeamProductivity } from '@/hooks/useTeamProductivity';
import { toast } from 'sonner';
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const METRIC_OPTIONS = [
  { value: 'steps', label: 'Passos (checklist)' },
  { value: 'leads_created', label: 'Leads cadastrados' },
  { value: 'leads_progressed', label: 'Leads progredidos' },
  { value: 'deals_closed', label: 'Fechados' },
  { value: 'stages', label: 'Etapas movidas' },
  { value: 'velocity', label: 'Passos/h (velocidade)' },
  { value: 'replies', label: 'Respostas a comentários' },
  { value: 'dms_sent', label: 'DMs enviadas' },
  { value: 'contacts_created', label: 'Contatos criados' },
  { value: 'activities_completed', label: 'Atividades concluídas' },
  { value: 'daily_goal_achievement', label: '% Dias com meta diária atingida' },
];

interface CommissionGoal {
  id: string;
  user_id: string | null;
  team_id: string | null;
  metric_key: string;
  target_value: number;
  period: string;
  period_start: string;
  period_end: string;
  is_active: boolean;
  board_ids: string[];
  tiers: CommissionTier[];
  ote_value: number;
  min_threshold_percent: number;
  calculation_mode: 'proportional' | 'tiered' | 'accelerated';
  accelerator_multiplier: number;
  cap_percent: number;
}

interface CommissionTier {
  id?: string;
  min_percent: number;
  max_percent: number;
  commission_value: number;
}

interface TeamInfo {
  id: string;
  name: string;
  color: string | null;
}

interface ProfileInfo {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

interface TeamMember {
  team_id: string;
  user_id: string;
}

interface BoardInfo {
  id: string;
  name: string;
  color: string;
}

const DEFAULT_TIERS: CommissionTier[] = [
  { min_percent: 0, max_percent: 50, commission_value: 0 },
  { min_percent: 50, max_percent: 80, commission_value: 200 },
  { min_percent: 80, max_percent: 100, commission_value: 400 },
  { min_percent: 100, max_percent: 999, commission_value: 600 },
];

const emptyGoalValues = { target_replies: 20, target_dms: 10, target_leads: 5, target_session_minutes: 60, target_contacts: 5, target_calls: 10, target_activities: 5, target_stage_changes: 10, target_leads_closed: 2, target_checklist_items: 10 };

export function CommissionGoals() {
  const [goals, setGoals] = useState<CommissionGoal[]>([]);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [boards, setBoards] = useState<BoardInfo[]>([]);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<CommissionGoal | null>(null);
  const [expandedGoal, setExpandedGoal] = useState<string | null>(null);
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [memberObjects, setMemberObjects] = useState<Record<string, any[]>>({});
  const [loadingObjects, setLoadingObjects] = useState<string | null>(null);
  const [dailyGoalAchievements, setDailyGoalAchievements] = useState<Record<string, { achieved: number; total: number }>>({});

  // Default daily goals state - keyed by board_id ('global' for no board)
  const [defaultGoalsMap, setDefaultGoalsMap] = useState<Record<string, typeof emptyGoalValues>>({ global: { ...emptyGoalValues } });
  const [selectedDefaultBoard, setSelectedDefaultBoard] = useState('global');
  const [savingDefaults, setSavingDefaults] = useState(false);
  const defaultGoals = defaultGoalsMap[selectedDefaultBoard] || { ...emptyGoalValues };

  // Per-user daily goals state
  const [userDailyGoals, setUserDailyGoals] = useState<Record<string, typeof emptyGoalValues & { target_days?: number[] }>>({});
  const [userGoalsDialogOpen, setUserGoalsDialogOpen] = useState(false);
  const [selectedUserForGoals, setSelectedUserForGoals] = useState('');
  const [editingUserGoals, setEditingUserGoals] = useState<typeof emptyGoalValues>({ ...emptyGoalValues });
  const [editingTargetDays, setEditingTargetDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [savingUserGoals, setSavingUserGoals] = useState(false);

  // Form state
  const [scopeType, setScopeType] = useState<'user' | 'team'>('user');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [metricKey, setMetricKey] = useState('steps');
  const [targetValue, setTargetValue] = useState('');
  const [period, setPeriod] = useState('monthly');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [selectedBoardIds, setSelectedBoardIds] = useState<string[]>([]);
  const [tiers, setTiers] = useState<CommissionTier[]>(DEFAULT_TIERS);
  const [oteValue, setOteValue] = useState('');
  const [minThreshold, setMinThreshold] = useState('0');
  const [calculationMode, setCalculationMode] = useState<'proportional' | 'tiered' | 'accelerated'>('proportional');
  const [acceleratorMultiplier, setAcceleratorMultiplier] = useState('1.5');
  const [capPercent, setCapPercent] = useState('150');

  // Date range for productivity (current month)
  const now = new Date();
  const dateRange = useMemo(() => ({
    start: startOfMonth(now),
    end: endOfMonth(now),
  }), []);

  const { productivity } = useTeamProductivity(dateRange);

  const fetchData = useCallback(async () => {
    try {
      const [goalsRes, teamsRes, profilesRes, membersRes, boardsRes] = await Promise.all([
        supabase.from('commission_goals').select('*').eq('is_active', true).order('created_at', { ascending: false }),
        supabase.from('teams').select('id, name, color').order('name'),
        supabase.from('profiles').select('user_id, full_name, email'),
        supabase.from('team_members').select('team_id, user_id'),
        supabase.from('kanban_boards').select('id, name, color').order('display_order'),
      ]);

      const goalsData = goalsRes.data || [];
      
      // Fetch tiers for all goals
      if (goalsData.length > 0) {
        const { data: tiersData } = await supabase
          .from('commission_tiers')
          .select('*')
          .in('goal_id', goalsData.map(g => g.id))
          .order('min_percent');

        const tiersMap = new Map<string, CommissionTier[]>();
        (tiersData || []).forEach(t => {
          if (!tiersMap.has(t.goal_id)) tiersMap.set(t.goal_id, []);
          tiersMap.get(t.goal_id)!.push(t);
        });

        setGoals(goalsData.map(g => ({
          ...g,
          board_ids: (g as any).board_ids || [],
          tiers: tiersMap.get(g.id) || [],
          ote_value: (g as any).ote_value || 0,
          min_threshold_percent: (g as any).min_threshold_percent || 0,
          calculation_mode: (g as any).calculation_mode || 'proportional',
          accelerator_multiplier: (g as any).accelerator_multiplier || 1.5,
          cap_percent: (g as any).cap_percent || 150,
        })));
      } else {
        setGoals([]);
      }

      setTeams(teamsRes.data || []);
      setBoards(boardsRes.data || []);
      setProfiles(profilesRes.data || []);
      setTeamMembers(membersRes.data || []);
    } catch (err) {
      console.error('Error fetching commission data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Fetch default daily goals
  useEffect(() => {
    supabase.from('workflow_default_goals').select('*').then(({ data }) => {
      if (data && data.length > 0) {
        const map: Record<string, typeof emptyGoalValues> = {};
        data.forEach((d: any) => {
          const key = d.board_id || 'global';
          map[key] = {
            target_replies: d.target_replies,
            target_dms: d.target_dms,
            target_leads: d.target_leads,
            target_session_minutes: d.target_session_minutes,
            target_contacts: d.target_contacts ?? 5,
            target_calls: d.target_calls ?? 10,
            target_activities: d.target_activities ?? 5,
            target_stage_changes: d.target_stage_changes ?? 10,
            target_leads_closed: d.target_leads_closed ?? 2,
            target_checklist_items: d.target_checklist_items ?? 10,
          };
        });
        setDefaultGoalsMap(prev => ({ ...prev, ...map }));
      }
    });
  }, []);

  // Fetch per-user daily goals
  useEffect(() => {
    supabase.from('user_daily_goal_defaults').select('*').then(({ data }) => {
      if (data && data.length > 0) {
        const map: Record<string, typeof emptyGoalValues & { target_days?: number[] }> = {};
        data.forEach((d: any) => {
          map[d.user_id] = {
            target_replies: d.target_replies,
            target_dms: d.target_dms,
            target_leads: d.target_leads,
            target_session_minutes: d.target_session_minutes,
            target_contacts: d.target_contacts ?? 5,
            target_calls: d.target_calls ?? 10,
            target_activities: d.target_activities ?? 5,
            target_stage_changes: d.target_stage_changes ?? 10,
            target_leads_closed: d.target_leads_closed ?? 2,
            target_checklist_items: d.target_checklist_items ?? 10,
            target_days: d.target_days ?? [1, 2, 3, 4, 5],
          };
        });
        setUserDailyGoals(map);
      }
    });
  }, []);

  // Fetch daily goal snapshots for current month
  useEffect(() => {
    const monthStart = format(startOfMonth(now), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(now), 'yyyy-MM-dd');
    supabase.from('daily_goal_snapshots')
      .select('user_id, snapshot_date, achieved')
      .gte('snapshot_date', monthStart)
      .lte('snapshot_date', monthEnd)
      .then(({ data }) => {
        if (data) {
          const map: Record<string, { achieved: number; total: number }> = {};
          data.forEach((d: any) => {
            if (!map[d.user_id]) map[d.user_id] = { achieved: 0, total: 0 };
            map[d.user_id].total++;
            if (d.achieved) map[d.user_id].achieved++;
          });
          setDailyGoalAchievements(map);
        }
      });
  }, []);

  const updateDefaultGoalField = (field: string, value: number) => {
    setDefaultGoalsMap(prev => ({
      ...prev,
      [selectedDefaultBoard]: { ...(prev[selectedDefaultBoard] || emptyGoalValues), [field]: value },
    }));
  };

  const saveDefaultGoals = async () => {
    setSavingDefaults(true);
    try {
      const boardId = selectedDefaultBoard === 'global' ? null : selectedDefaultBoard;
      const payload = { ...defaultGoals, board_id: boardId, updated_at: new Date().toISOString() };
      let query = supabase.from('workflow_default_goals').select('id');
      if (boardId) {
        query = query.eq('board_id', boardId);
      } else {
        query = query.is('board_id', null);
      }
      const { data: existing } = await query.maybeSingle();
      
      if (existing) {
        await supabase.from('workflow_default_goals').update(payload as any).eq('id', existing.id);
      } else {
        await supabase.from('workflow_default_goals').insert(payload as any);
      }
      toast.success('Metas padrão salvas!');
    } catch (err) {
      toast.error('Erro ao salvar metas padrão');
    } finally {
      setSavingDefaults(false);
    }
  };

  const getMetricValue = (userId: string, metricKey: string): number => {
    if (metricKey === 'daily_goal_achievement') {
      const data = dailyGoalAchievements[userId];
      if (!data || data.total === 0) return 0;
      return Math.round((data.achieved / data.total) * 100);
    }
    const p = productivity.find(u => u.userId === userId);
    if (!p) return 0;
    switch (metricKey) {
      case 'steps': return p.checklistItemsChecked;
      case 'leads_created': return p.leadsCreated;
      case 'leads_progressed': return p.leadsProgressed;
      case 'deals_closed': return p.leadsClosed;
      case 'stages': return p.stageChanges;
      case 'velocity': {
        const hours = p.sessionMinutes / 60;
        return hours > 0 ? Math.round((p.checklistItemsChecked / hours) * 10) / 10 : 0;
      }
      case 'replies': return p.commentReplies;
      case 'dms_sent': return p.dmsSent;
      case 'contacts_created': return p.contactsCreated;
      case 'activities_completed': return p.activitiesCompleted;
      default: return 0;
    }
  };

  // Save per-user daily goals
  const saveUserDailyGoals = async () => {
    if (!selectedUserForGoals) { toast.error('Selecione um membro'); return; }
    setSavingUserGoals(true);
    try {
      const payload = { ...editingUserGoals, user_id: selectedUserForGoals, target_days: editingTargetDays } as any;
      const { data: existing } = await supabase
        .from('user_daily_goal_defaults')
        .select('id')
        .eq('user_id', selectedUserForGoals)
        .maybeSingle();
      
      if (existing) {
        await supabase.from('user_daily_goal_defaults').update(payload).eq('id', existing.id);
      } else {
        await supabase.from('user_daily_goal_defaults').insert(payload);
      }
      
      setUserDailyGoals(prev => ({ ...prev, [selectedUserForGoals]: { ...editingUserGoals, target_days: editingTargetDays } }));
      toast.success('Metas diárias do usuário salvas!');
      setUserGoalsDialogOpen(false);
    } catch (err) {
      toast.error('Erro ao salvar metas do usuário');
    } finally {
      setSavingUserGoals(false);
    }
  };

  const openUserGoalsDialog = (userId: string) => {
    setSelectedUserForGoals(userId);
    const existing = userDailyGoals[userId];
    setEditingUserGoals(existing ? { target_replies: existing.target_replies, target_dms: existing.target_dms, target_leads: existing.target_leads, target_session_minutes: existing.target_session_minutes, target_contacts: existing.target_contacts, target_calls: existing.target_calls, target_activities: existing.target_activities, target_stage_changes: existing.target_stage_changes, target_leads_closed: existing.target_leads_closed, target_checklist_items: existing.target_checklist_items } : { ...emptyGoalValues });
    setEditingTargetDays(existing?.target_days ?? [1, 2, 3, 4, 5]);
    setUserGoalsDialogOpen(true);
  };

  const fetchMemberObjects = async (goalId: string, userId: string, metricKey: string, periodStart: string, periodEnd: string) => {
    const key = `${goalId}:${userId}`;
    if (expandedMember === key) {
      setExpandedMember(null);
      return;
    }

    // If already fetched, just expand
    if (memberObjects[key]) {
      setExpandedMember(key);
      return;
    }

    setLoadingObjects(key);
    try {
      const startDate = new Date(periodStart).toISOString();
      const endDate = new Date(periodEnd + 'T23:59:59').toISOString();
      let items: any[] = [];

      switch (metricKey) {
        case 'deals_closed': {
          const { data } = await supabase.from('leads')
            .select('id, lead_name, status, created_at, converted_at')
            .eq('created_by', userId)
            .in('status', ['converted', 'won', 'closed'])
            .gte('created_at', startDate).lte('created_at', endDate)
            .order('created_at', { ascending: false });
          items = (data || []).map(l => ({ id: l.id, label: l.lead_name || 'Sem nome', sublabel: l.status, date: l.converted_at || l.created_at }));
          break;
        }
        case 'leads_created': {
          const { data } = await supabase.from('leads')
            .select('id, lead_name, status, created_at')
            .eq('created_by', userId)
            .gte('created_at', startDate).lte('created_at', endDate)
            .order('created_at', { ascending: false });
          items = (data || []).map(l => ({ id: l.id, label: l.lead_name || 'Sem nome', sublabel: l.status, date: l.created_at }));
          break;
        }
        case 'contacts_created': {
          const { data } = await supabase.from('contacts')
            .select('id, full_name, classification, created_at')
            .eq('created_by', userId)
            .gte('created_at', startDate).lte('created_at', endDate)
            .order('created_at', { ascending: false });
          items = (data || []).map(c => ({ id: c.id, label: c.full_name, sublabel: c.classification, date: c.created_at }));
          break;
        }
        case 'replies': {
          const { data } = await supabase.from('instagram_comments')
            .select('id, author_username, comment_text, replied_at')
            .eq('replied_by', userId)
            .gte('replied_at', startDate).lte('replied_at', endDate)
            .order('replied_at', { ascending: false })
            .limit(50);
          items = (data || []).map(c => ({ id: c.id, label: `@${c.author_username}`, sublabel: (c.comment_text || '').slice(0, 60), date: c.replied_at }));
          break;
        }
        case 'dms_sent': {
          const { data } = await supabase.from('dm_history')
            .select('id, instagram_username, dm_message, created_at')
            .eq('user_id', userId)
            .neq('action_type', 'received')
            .gte('created_at', startDate).lte('created_at', endDate)
            .order('created_at', { ascending: false })
            .limit(50);
          items = (data || []).map(d => ({ id: d.id, label: `@${d.instagram_username}`, sublabel: (d.dm_message || '').slice(0, 60), date: d.created_at }));
          break;
        }
        case 'activities_completed': {
          const { data } = await supabase.from('lead_activities')
            .select('id, title, lead_name, completed_at')
            .eq('completed_by', userId)
            .eq('status', 'concluida')
            .gte('completed_at', startDate).lte('completed_at', endDate)
            .order('completed_at', { ascending: false });
          items = (data || []).map(a => ({ id: a.id, label: a.title, sublabel: a.lead_name, date: a.completed_at }));
          break;
        }
        case 'stages':
        case 'leads_progressed': {
          const { data } = await supabase.from('lead_stage_history')
            .select('id, lead_id, from_stage, to_stage, changed_at')
            .eq('changed_by', userId)
            .gte('changed_at', startDate).lte('changed_at', endDate)
            .order('changed_at', { ascending: false })
            .limit(50);
          items = (data || []).map(s => ({ id: s.id, label: `Lead`, sublabel: `${s.from_stage || '?'} → ${s.to_stage}`, date: s.changed_at }));
          break;
        }
        case 'daily_goal_achievement': {
          const { data } = await supabase.from('daily_goal_snapshots')
            .select('id, snapshot_date, progress_percent, achieved')
            .eq('user_id', userId)
            .gte('snapshot_date', startDate.split('T')[0])
            .lte('snapshot_date', endDate.split('T')[0])
            .order('snapshot_date', { ascending: false });
          items = (data || []).map((s: any) => ({
            id: s.id,
            label: new Date(s.snapshot_date + 'T12:00:00').toLocaleDateString('pt-BR'),
            sublabel: `${s.progress_percent}% ${s.achieved ? '✅' : '❌'}`,
            date: s.snapshot_date,
          }));
          break;
        }
        default:
          items = [];
      }

      setMemberObjects(prev => ({ ...prev, [key]: items }));
      setExpandedMember(key);
    } catch (err) {
      console.error('Error fetching member objects:', err);
      toast.error('Erro ao carregar detalhes');
    } finally {
      setLoadingObjects(null);
    }
  };

  const calculateCommission = (goal: CommissionGoal, percent: number): number => {
    if (percent < goal.min_threshold_percent) return 0;

    switch (goal.calculation_mode) {
      case 'proportional': {
        const cappedPercent = Math.min(percent, goal.cap_percent);
        return (cappedPercent / 100) * goal.ote_value;
      }
      case 'accelerated': {
        const cappedPercent = Math.min(percent, goal.cap_percent);
        if (percent <= 100) {
          return (cappedPercent / 100) * goal.ote_value;
        }
        // Base OTE + accelerated portion above 100%
        const baseOte = goal.ote_value;
        const excessPercent = cappedPercent - 100;
        return baseOte + (excessPercent / 100) * goal.ote_value * goal.accelerator_multiplier;
      }
      case 'tiered': {
        const tier = goal.tiers.find(t => percent >= t.min_percent && percent < t.max_percent);
        return tier?.commission_value || 0;
      }
      default:
        return 0;
    }
  };

  const getMetricLabel = (key: string) => METRIC_OPTIONS.find(m => m.value === key)?.label || key;
  const getUserName = (userId: string) => profiles.find(p => p.user_id === userId)?.full_name || 'Sem nome';
  const getTeamName = (teamId: string) => teams.find(t => t.id === teamId)?.name || 'Time';

  const resetForm = () => {
    setEditingGoal(null);
    setScopeType('user');
    setSelectedUserId('');
    setSelectedTeamId('');
    setMetricKey('steps');
    setTargetValue('');
    setPeriod('monthly');
    setCustomStartDate('');
    setCustomEndDate('');
    setSelectedBoardIds([]);
    setTiers([...DEFAULT_TIERS]);
    setOteValue('');
    setMinThreshold('0');
    setCalculationMode('proportional');
    setAcceleratorMultiplier('1.5');
    setCapPercent('150');
  };

  const handleEdit = (goal: CommissionGoal) => {
    setEditingGoal(goal);
    setScopeType(goal.user_id ? 'user' : 'team');
    setSelectedUserId(goal.user_id || '');
    setSelectedTeamId(goal.team_id || '');
    setMetricKey(goal.metric_key);
    setTargetValue(goal.target_value.toString());
    setPeriod(goal.period);
    setCustomStartDate(goal.period === 'custom' ? goal.period_start : '');
    setCustomEndDate(goal.period === 'custom' ? goal.period_end : '');
    setSelectedBoardIds(goal.board_ids || []);
    setTiers(goal.tiers.length > 0 ? goal.tiers : [...DEFAULT_TIERS]);
    setOteValue(goal.ote_value?.toString() || '');
    setMinThreshold(goal.min_threshold_percent?.toString() || '0');
    setCalculationMode(goal.calculation_mode || 'proportional');
    setAcceleratorMultiplier(goal.accelerator_multiplier?.toString() || '1.5');
    setCapPercent(goal.cap_percent?.toString() || '150');
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!targetValue || Number(targetValue) <= 0) {
      toast.error('Informe um valor válido para a meta');
      return;
    }
    if (scopeType === 'user' && !selectedUserId) {
      toast.error('Selecione um membro');
      return;
    }
    if (scopeType === 'team' && !selectedTeamId) {
      toast.error('Selecione um time');
      return;
    }

    let periodStart: string;
    let periodEnd: string;

    if (period === 'custom') {
      if (!customStartDate || !customEndDate) {
        toast.error('Informe as datas de início e fim');
        return;
      }
      periodStart = customStartDate;
      periodEnd = customEndDate;
    } else if (period === 'weekly') {
      periodStart = format(startOfWeek(now, { locale: ptBR }), 'yyyy-MM-dd');
      periodEnd = format(endOfWeek(now, { locale: ptBR }), 'yyyy-MM-dd');
    } else {
      periodStart = format(startOfMonth(now), 'yyyy-MM-dd');
      periodEnd = format(endOfMonth(now), 'yyyy-MM-dd');
    }

    try {
      let goalId: string;

      const oteFields = {
        ote_value: Number(oteValue) || 0,
        min_threshold_percent: Number(minThreshold) || 0,
        calculation_mode: calculationMode,
        accelerator_multiplier: Number(acceleratorMultiplier) || 1.5,
        cap_percent: Number(capPercent) || 150,
      };

      if (editingGoal) {
        const { error } = await supabase.from('commission_goals').update({
          user_id: scopeType === 'user' ? selectedUserId : null,
          team_id: scopeType === 'team' ? selectedTeamId : null,
          metric_key: metricKey,
          target_value: Number(targetValue),
          period,
          period_start: periodStart,
          period_end: periodEnd,
          board_ids: selectedBoardIds,
          ...oteFields,
        }).eq('id', editingGoal.id);
        if (error) throw error;
        goalId = editingGoal.id;

        // Delete old tiers
        await supabase.from('commission_tiers').delete().eq('goal_id', goalId);
      } else {
        const { data, error } = await supabase.from('commission_goals').insert({
          user_id: scopeType === 'user' ? selectedUserId : null,
          team_id: scopeType === 'team' ? selectedTeamId : null,
          metric_key: metricKey,
          target_value: Number(targetValue),
          period,
          period_start: periodStart,
          period_end: periodEnd,
          board_ids: selectedBoardIds,
          is_active: true,
          ...oteFields,
        }).select('id').single();
        if (error) throw error;
        goalId = data.id;
      }

      // Insert tiers
      const tiersToInsert = tiers.map(t => ({
        goal_id: goalId,
        min_percent: t.min_percent,
        max_percent: t.max_percent,
        commission_value: t.commission_value,
      }));
      const { error: tierError } = await supabase.from('commission_tiers').insert(tiersToInsert);
      if (tierError) throw tierError;

      toast.success(editingGoal ? 'Meta atualizada!' : 'Meta criada!');
      setDialogOpen(false);
      resetForm();
      fetchData();
    } catch (err) {
      console.error('Error saving goal:', err);
      toast.error('Erro ao salvar meta');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from('commission_goals').update({ is_active: false }).eq('id', id);
      if (error) throw error;
      toast.success('Meta removida');
      fetchData();
    } catch (err) {
      toast.error('Erro ao remover');
    }
  };

  const updateTier = (index: number, field: keyof CommissionTier, value: number) => {
    setTiers(prev => prev.map((t, i) => i === index ? { ...t, [field]: value } : t));
  };

  const addTier = () => {
    const last = tiers[tiers.length - 1];
    setTiers(prev => [...prev, { min_percent: last?.max_percent || 0, max_percent: (last?.max_percent || 0) + 50, commission_value: 0 }]);
  };

  const removeTier = (index: number) => {
    if (tiers.length <= 1) return;
    setTiers(prev => prev.filter((_, i) => i !== index));
  };

  // Build summary data: for each goal, compute current value and commission
  const goalSummaries = useMemo(() => {
    return goals.map(goal => {
      if (goal.user_id) {
        const current = getMetricValue(goal.user_id, goal.metric_key);
        const percent = goal.target_value > 0 ? (current / goal.target_value) * 100 : 0;
        const commission = calculateCommission(goal, percent);
        return {
          goal,
          entries: [{ userId: goal.user_id, name: getUserName(goal.user_id), current, percent, commission }],
          totalCommission: commission,
        };
      } else if (goal.team_id) {
        const memberIds = teamMembers.filter(tm => tm.team_id === goal.team_id).map(tm => tm.user_id);
        const entries = memberIds.map(uid => {
          const current = getMetricValue(uid, goal.metric_key);
          const percent = goal.target_value > 0 ? (current / goal.target_value) * 100 : 0;
          const commission = calculateCommission(goal, percent);
          return { userId: uid, name: getUserName(uid), current, percent, commission };
        });
        return {
          goal,
          entries,
          totalCommission: entries.reduce((sum, e) => sum + e.commission, 0),
        };
      }
      return { goal, entries: [], totalCommission: 0 };
    });
  }, [goals, productivity, teamMembers, profiles]);

  const grandTotal = useMemo(() => goalSummaries.reduce((sum, g) => sum + g.totalCommission, 0), [goalSummaries]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-muted-foreground mt-4">Carregando metas...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-semibold flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            Metas & Comissão Variável
          </h3>
          <p className="text-sm text-muted-foreground">
            {format(startOfMonth(now), "MMMM yyyy", { locale: ptBR })} — Comissão total estimada:{' '}
            <span className="font-bold text-primary">R$ {grandTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
          </p>
        </div>
        <Button onClick={() => { resetForm(); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          Nova Meta
        </Button>
      </div>

      {/* Default daily goals config */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            Metas Diárias Padrão
          </CardTitle>
          <CardDescription>
            Valores mínimos aplicados quando não há meta específica cadastrada para o período. Selecione o funil para personalizar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <Label className="text-xs mb-1.5 block">Funil</Label>
            <Select value={selectedDefaultBoard} onValueChange={setSelectedDefaultBoard}>
              <SelectTrigger className="w-full md:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">🌐 Padrão Global (todos os funis)</SelectItem>
                {boards.map(b => (
                  <SelectItem key={b.id} value={b.id}>
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: b.color }} />
                      {b.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Respostas / dia</Label>
              <Input type="number" min={0} value={defaultGoals.target_replies} onChange={e => updateDefaultGoalField('target_replies', Number(e.target.value) || 0)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">DMs / dia</Label>
              <Input type="number" min={0} value={defaultGoals.target_dms} onChange={e => updateDefaultGoalField('target_dms', Number(e.target.value) || 0)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Leads / dia</Label>
              <Input type="number" min={0} value={defaultGoals.target_leads} onChange={e => updateDefaultGoalField('target_leads', Number(e.target.value) || 0)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tempo online (min)</Label>
              <Input type="number" min={0} value={defaultGoals.target_session_minutes} onChange={e => updateDefaultGoalField('target_session_minutes', Number(e.target.value) || 0)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Contatos / dia</Label>
              <Input type="number" min={0} value={defaultGoals.target_contacts} onChange={e => updateDefaultGoalField('target_contacts', Number(e.target.value) || 0)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Ligações / dia</Label>
              <Input type="number" min={0} value={defaultGoals.target_calls} onChange={e => updateDefaultGoalField('target_calls', Number(e.target.value) || 0)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Atividades / dia</Label>
              <Input type="number" min={0} value={defaultGoals.target_activities} onChange={e => updateDefaultGoalField('target_activities', Number(e.target.value) || 0)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Etapas / dia</Label>
              <Input type="number" min={0} value={defaultGoals.target_stage_changes} onChange={e => updateDefaultGoalField('target_stage_changes', Number(e.target.value) || 0)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Fechados / dia</Label>
              <Input type="number" min={0} value={defaultGoals.target_leads_closed} onChange={e => updateDefaultGoalField('target_leads_closed', Number(e.target.value) || 0)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Passos / dia</Label>
              <Input type="number" min={0} value={defaultGoals.target_checklist_items} onChange={e => updateDefaultGoalField('target_checklist_items', Number(e.target.value) || 0)} />
            </div>
          </div>
          <div className="flex justify-end mt-3">
            <Button size="sm" onClick={saveDefaultGoals} disabled={savingDefaults}>
              {savingDefaults ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Salvar Padrão
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Per-user daily goals */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Metas Diárias por Usuário
          </CardTitle>
          <CardDescription>
            Defina metas diárias individuais para cada membro. Quando definida, sobrepõe a meta padrão global.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {profiles.filter(p => p.full_name).map(profile => {
              const hasCustomGoals = !!userDailyGoals[profile.user_id];
              const achievement = dailyGoalAchievements[profile.user_id];
              const achievementPercent = achievement && achievement.total > 0
                ? Math.round((achievement.achieved / achievement.total) * 100) : null;
              const targetDays = userDailyGoals[profile.user_id]?.target_days ?? [1, 2, 3, 4, 5];
              const dayLabels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
              const daysText = targetDays.length === 5 && [1,2,3,4,5].every(d => targetDays.includes(d))
                ? 'Seg–Sex'
                : targetDays.length === 7 ? 'Todos' : targetDays.sort((a,b) => a-b).map(d => dayLabels[d]).join(', ');

              return (
                <div key={profile.user_id} className="flex items-center justify-between p-2 rounded-md border bg-muted/20 hover:bg-muted/40">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-medium">{profile.full_name}</span>
                    {hasCustomGoals ? (
                      <Badge variant="secondary" className="text-[10px]">Meta personalizada</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">Padrão global</Badge>
                    )}
                    <Badge variant="outline" className="text-[10px]">{daysText}</Badge>
                    {achievementPercent !== null && (
                      <Badge variant={achievementPercent >= 80 ? 'default' : achievementPercent >= 50 ? 'secondary' : 'destructive'} className="text-[10px]">
                        {achievementPercent}% dias atingidos
                      </Badge>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => openUserGoalsDialog(profile.user_id)}>
                    <Edit2 className="h-3 w-3 mr-1" /> Configurar
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Target className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Metas ativas</p>
                <p className="text-2xl font-bold">{goals.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <Award className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Metas atingidas (≥100%)</p>
                <p className="text-2xl font-bold">
                  {goalSummaries.reduce((c, g) => c + g.entries.filter(e => e.percent >= 100).length, 0)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <DollarSign className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Comissão total estimada</p>
                <p className="text-2xl font-bold text-primary">
                  R$ {grandTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Goals list */}
      {goals.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Target className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h4 className="font-medium mb-2">Nenhuma meta configurada</h4>
            <p className="text-sm text-muted-foreground mb-4">
              Crie metas com faixas de comissão para acompanhar o desempenho
            </p>
            <Button onClick={() => { resetForm(); setDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" /> Criar Primeira Meta
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {goalSummaries.map(({ goal, entries, totalCommission }) => {
            const isExpanded = expandedGoal === goal.id;
            const scopeLabel = goal.user_id
              ? getUserName(goal.user_id)
              : `Time: ${getTeamName(goal.team_id!)}`;
            const avgPercent = entries.length > 0
              ? entries.reduce((s, e) => s + e.percent, 0) / entries.length : 0;

            return (
              <Card key={goal.id} className="overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                        {goal.team_id ? <UsersRound className="h-4 w-4 text-primary" /> : <Users className="h-4 w-4 text-primary" />}
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-sm truncate">{scopeLabel}</CardTitle>
                        <CardDescription className="text-xs">
                          {getMetricLabel(goal.metric_key)} • Meta: {goal.target_value} • {goal.period === 'weekly' ? 'Semanal' : goal.period === 'custom' ? `${goal.period_start} a ${goal.period_end}` : 'Mensal'}
                          {goal.ote_value > 0 && ` • OTE: R$ ${goal.ote_value.toLocaleString('pt-BR')}`}
                          {goal.min_threshold_percent > 0 && ` • Piso: ${goal.min_threshold_percent}%`}
                          {` • ${goal.calculation_mode === 'proportional' ? 'Proporcional' : goal.calculation_mode === 'accelerated' ? 'Acelerado' : 'Escalonado'}`}
                          {goal.board_ids && goal.board_ids.length > 0 && ` • Funis: ${goal.board_ids.map(bid => boards.find(b => b.id === bid)?.name || '').filter(Boolean).join(', ')}`}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant={avgPercent >= 100 ? 'default' : avgPercent >= 50 ? 'secondary' : 'destructive'}>
                        {Math.round(avgPercent)}%
                      </Badge>
                      <Badge className="bg-amber-500/10 text-amber-700 border-amber-200">
                        R$ {totalCommission.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </Badge>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(goal)}>
                        <Edit2 className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(goal.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setExpandedGoal(isExpanded ? null : goal.id)}>
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <Progress value={Math.min(avgPercent, 100)} className="h-2 mt-3" />
                </CardHeader>

                {isExpanded && (
                  <CardContent className="pt-0 space-y-4">
                    {/* Members table */}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Membro</TableHead>
                          <TableHead className="text-right">Atual</TableHead>
                          <TableHead className="text-right">Meta</TableHead>
                          <TableHead className="text-right">%</TableHead>
                          <TableHead className="text-right">Comissão</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {entries.map(entry => {
                          const memberKey = `${goal.id}:${entry.userId}`;
                          const isMemberExpanded = expandedMember === memberKey;
                          const objects = memberObjects[memberKey] || [];
                          const isLoadingThis = loadingObjects === memberKey;

                          return (
                            <React.Fragment key={entry.userId}>
                              <TableRow 
                                className="cursor-pointer hover:bg-muted/50"
                                onClick={() => fetchMemberObjects(goal.id, entry.userId, goal.metric_key, goal.period_start, goal.period_end)}
                              >
                                <TableCell className="font-medium">
                                  <div className="flex items-center gap-2">
                                    {isLoadingThis ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <List className="h-3 w-3 text-muted-foreground" />
                                    )}
                                    {entry.name}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">{entry.current}</TableCell>
                                <TableCell className="text-right">{goal.target_value}</TableCell>
                                <TableCell className="text-right">
                                  <Badge variant={entry.percent >= 100 ? 'default' : entry.percent >= 50 ? 'secondary' : 'destructive'}>
                                    {Math.round(entry.percent)}%
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right font-semibold">
                                  R$ {entry.commission.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </TableCell>
                              </TableRow>
                              {isMemberExpanded && (
                                <TableRow>
                                  <TableCell colSpan={5} className="p-0">
                                    <div className="bg-muted/30 border-t border-b px-4 py-2 max-h-60 overflow-y-auto">
                                      {objects.length === 0 ? (
                                        <p className="text-xs text-muted-foreground py-2">Nenhum registro encontrado no período.</p>
                                      ) : (
                                        <div className="space-y-1">
                                          <p className="text-[10px] font-medium text-muted-foreground mb-1">
                                            {objects.length} {objects.length === 1 ? 'registro' : 'registros'}
                                          </p>
                                          {objects.map((obj, idx) => (
                                            <div key={obj.id || idx} className="flex items-center justify-between py-1 text-xs border-b border-border/30 last:border-0">
                                              <div className="min-w-0 flex-1">
                                                <span className="font-medium">{obj.label}</span>
                                                {obj.sublabel && (
                                                  <span className="text-muted-foreground ml-2 truncate">{obj.sublabel}</span>
                                                )}
                                              </div>
                                              {obj.date && (
                                                <span className="text-muted-foreground shrink-0 ml-2">
                                                  {new Date(obj.date).toLocaleDateString('pt-BR')}
                                                </span>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>

                    {/* Commission info */}
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">
                        {goal.calculation_mode === 'tiered' ? 'Faixas de comissão:' : 'Configuração OTE:'}
                      </p>
                      {goal.calculation_mode === 'tiered' ? (
                        <div className="flex flex-wrap gap-2">
                          {goal.tiers.map((tier, i) => (
                            <Badge key={i} variant="outline" className="text-xs">
                              {tier.min_percent}%-{tier.max_percent === 999 ? '∞' : tier.max_percent + '%'}: R$ {tier.commission_value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline" className="text-xs">OTE: R$ {goal.ote_value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</Badge>
                          {goal.min_threshold_percent > 0 && <Badge variant="outline" className="text-xs">Piso: {goal.min_threshold_percent}%</Badge>}
                          <Badge variant="outline" className="text-xs">Teto: {goal.cap_percent}%</Badge>
                          {goal.calculation_mode === 'accelerated' && <Badge variant="outline" className="text-xs">Acelerador: {goal.accelerator_multiplier}x</Badge>}
                          <Badge variant="outline" className="text-xs">
                            {goal.calculation_mode === 'proportional' ? 'Proporcional' : 'Com acelerador'}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Dialog for creating/editing goals */}
      <Sheet open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editingGoal ? 'Editar Meta' : 'Nova Meta de Comissão'}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            {/* Scope */}
            <div className="space-y-2">
              <Label>Aplicar para</Label>
              <Tabs value={scopeType} onValueChange={(v) => setScopeType(v as 'user' | 'team')}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="user"><Users className="h-3 w-3 mr-1" /> Membro</TabsTrigger>
                  <TabsTrigger value="team"><UsersRound className="h-3 w-3 mr-1" /> Time</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {scopeType === 'user' ? (
              <div className="space-y-2">
                <Label>Membro</Label>
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {profiles.filter(p => p.full_name).map(p => (
                      <SelectItem key={p.user_id} value={p.user_id}>{p.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Time</Label>
                <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {teams.map(t => (
                      <SelectItem key={t.id} value={t.id}>
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color || '#3b82f6' }} />
                          {t.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Funis (Boards) multi-select */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <LayoutGrid className="h-3 w-3" />
                Funis (opcional)
              </Label>
              <p className="text-xs text-muted-foreground">Selecione os funis para filtrar a métrica. Vazio = todos.</p>
              <div className="space-y-1 max-h-40 overflow-y-auto border rounded-md p-2">
                {boards.map(board => (
                  <label key={board.id} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-muted/50 cursor-pointer">
                    <Checkbox
                      checked={selectedBoardIds.includes(board.id)}
                      onCheckedChange={(checked) => {
                        setSelectedBoardIds(prev =>
                          checked
                            ? [...prev, board.id]
                            : prev.filter(id => id !== board.id)
                        );
                      }}
                    />
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: board.color || '#3b82f6' }} />
                    <span className="text-sm">{board.name}</span>
                  </label>
                ))}
              </div>
              {selectedBoardIds.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedBoardIds.map(bid => {
                    const b = boards.find(x => x.id === bid);
                    return b ? (
                      <Badge key={bid} variant="secondary" className="text-xs gap-1">
                        {b.name}
                        <X className="h-3 w-3 cursor-pointer" onClick={() => setSelectedBoardIds(prev => prev.filter(id => id !== bid))} />
                      </Badge>
                    ) : null;
                  })}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Métrica</Label>
              <Select value={metricKey} onValueChange={setMetricKey}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METRIC_OPTIONS.map(m => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Valor da meta</Label>
                <Input type="number" placeholder="Ex: 50" value={targetValue} onChange={e => setTargetValue(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Período</Label>
                <Select value={period} onValueChange={setPeriod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Semanal</SelectItem>
                    <SelectItem value="monthly">Mensal</SelectItem>
                    <SelectItem value="custom">Personalizado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {period === 'custom' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Data início</Label>
                  <Input type="date" value={customStartDate} onChange={e => setCustomStartDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Data fim</Label>
                  <Input type="date" value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} />
                </div>
              </div>
            )}

            {/* OTE Section */}
            <div className="space-y-3 border-t pt-4">
              <Label className="text-base font-semibold flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Remuneração (OTE)
              </Label>

              <div className="space-y-2">
                <Label>Modo de cálculo</Label>
                <Select value={calculationMode} onValueChange={(v) => setCalculationMode(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="proportional">Proporcional (linear)</SelectItem>
                    <SelectItem value="accelerated">Proporcional com acelerador</SelectItem>
                    <SelectItem value="tiered">Escalonado (faixas fixas)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  {calculationMode === 'proportional' && 'Ganha proporcionalmente ao % atingido. Ex: 80% da meta = 80% do OTE.'}
                  {calculationMode === 'accelerated' && 'Proporcional até 100%, acima aplica multiplicador de aceleração.'}
                  {calculationMode === 'tiered' && 'Valor fixo por faixa de atingimento (faixas configuráveis abaixo).'}
                </p>
              </div>

              {calculationMode !== 'tiered' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Valor OTE (R$)</Label>
                    <Input type="number" placeholder="Ex: 3000" value={oteValue} onChange={e => setOteValue(e.target.value)} />
                    <p className="text-[10px] text-muted-foreground">Quanto ganha ao atingir 100%</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Piso mínimo (%)</Label>
                    <Input type="number" placeholder="Ex: 50" value={minThreshold} onChange={e => setMinThreshold(e.target.value)} />
                    <p className="text-[10px] text-muted-foreground">Abaixo disso, não recebe</p>
                  </div>
                </div>
              )}

              {calculationMode === 'accelerated' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Multiplicador acima de 100%</Label>
                    <Input type="number" step="0.1" placeholder="Ex: 1.5" value={acceleratorMultiplier} onChange={e => setAcceleratorMultiplier(e.target.value)} />
                    <p className="text-[10px] text-muted-foreground">Ex: 1.5x = cada 1% acima vale 1.5%</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Teto máximo (%)</Label>
                    <Input type="number" placeholder="Ex: 150" value={capPercent} onChange={e => setCapPercent(e.target.value)} />
                    <p className="text-[10px] text-muted-foreground">Limite de % para cálculo</p>
                  </div>
                </div>
              )}

              {calculationMode === 'proportional' && (
                <div className="space-y-2">
                  <Label>Teto máximo (%)</Label>
                  <Input type="number" placeholder="Ex: 150" value={capPercent} onChange={e => setCapPercent(e.target.value)} className="max-w-[200px]" />
                  <p className="text-[10px] text-muted-foreground">Limite máximo de % considerado no cálculo</p>
                </div>
              )}

              {/* Tiers - only for tiered mode */}
              {calculationMode === 'tiered' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Faixas de comissão</Label>
                    <Button variant="ghost" size="sm" onClick={addTier}>
                      <Plus className="h-3 w-3 mr-1" /> Faixa
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-3 mb-2">
                      <div className="space-y-2">
                        <Label className="text-xs">Piso mínimo (%)</Label>
                        <Input type="number" placeholder="Ex: 50" value={minThreshold} onChange={e => setMinThreshold(e.target.value)} />
                      </div>
                    </div>
                    {tiers.map((tier, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 rounded-md border bg-muted/30">
                        <div className="flex-1 grid grid-cols-3 gap-2">
                          <div>
                            <p className="text-[10px] text-muted-foreground">De %</p>
                            <Input type="number" className="h-8 text-sm" value={tier.min_percent}
                              onChange={e => updateTier(i, 'min_percent', Number(e.target.value))} />
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground">Até %</p>
                            <Input type="number" className="h-8 text-sm" value={tier.max_percent}
                              onChange={e => updateTier(i, 'max_percent', Number(e.target.value))} />
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground">R$ Comissão</p>
                            <Input type="number" className="h-8 text-sm" value={tier.commission_value}
                              onChange={e => updateTier(i, 'commission_value', Number(e.target.value))} />
                          </div>
                        </div>
                        {tiers.length > 1 && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive shrink-0" onClick={() => removeTier(i)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <SheetFooter className="flex-row justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave}>{editingGoal ? 'Salvar' : 'Criar Meta'}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Per-user daily goals dialog */}
      <Sheet open={userGoalsDialogOpen} onOpenChange={(open) => { setUserGoalsDialogOpen(open); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              Metas Diárias - {profiles.find(p => p.user_id === selectedUserForGoals)?.full_name || 'Usuário'}
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Defina as metas diárias específicas para este usuário. Estas metas sobrepõem o padrão global.
            </p>
            {/* Weekday selector */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">Dias da semana obrigatórios</Label>
              <div className="flex flex-wrap gap-2">
                {[
                  { day: 1, label: 'Seg' },
                  { day: 2, label: 'Ter' },
                  { day: 3, label: 'Qua' },
                  { day: 4, label: 'Qui' },
                  { day: 5, label: 'Sex' },
                  { day: 6, label: 'Sáb' },
                  { day: 0, label: 'Dom' },
                ].map(({ day, label }) => (
                  <label key={day} className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox
                      checked={editingTargetDays.includes(day)}
                      onCheckedChange={(checked) => {
                        setEditingTargetDays(prev =>
                          checked ? [...prev, day] : prev.filter(d => d !== day)
                        );
                      }}
                    />
                    <span className="text-xs">{label}</span>
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">Apenas nesses dias o snapshot de meta será registrado e contabilizado.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Respostas / dia</Label>
                <Input type="number" min={0} value={editingUserGoals.target_replies} onChange={e => setEditingUserGoals(prev => ({ ...prev, target_replies: Number(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">DMs / dia</Label>
                <Input type="number" min={0} value={editingUserGoals.target_dms} onChange={e => setEditingUserGoals(prev => ({ ...prev, target_dms: Number(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Leads / dia</Label>
                <Input type="number" min={0} value={editingUserGoals.target_leads} onChange={e => setEditingUserGoals(prev => ({ ...prev, target_leads: Number(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Tempo online (min)</Label>
                <Input type="number" min={0} value={editingUserGoals.target_session_minutes} onChange={e => setEditingUserGoals(prev => ({ ...prev, target_session_minutes: Number(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Contatos / dia</Label>
                <Input type="number" min={0} value={editingUserGoals.target_contacts} onChange={e => setEditingUserGoals(prev => ({ ...prev, target_contacts: Number(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Ligações / dia</Label>
                <Input type="number" min={0} value={editingUserGoals.target_calls} onChange={e => setEditingUserGoals(prev => ({ ...prev, target_calls: Number(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Atividades / dia</Label>
                <Input type="number" min={0} value={editingUserGoals.target_activities} onChange={e => setEditingUserGoals(prev => ({ ...prev, target_activities: Number(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Etapas / dia</Label>
                <Input type="number" min={0} value={editingUserGoals.target_stage_changes} onChange={e => setEditingUserGoals(prev => ({ ...prev, target_stage_changes: Number(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Fechados / dia</Label>
                <Input type="number" min={0} value={editingUserGoals.target_leads_closed} onChange={e => setEditingUserGoals(prev => ({ ...prev, target_leads_closed: Number(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Passos / dia</Label>
                <Input type="number" min={0} value={editingUserGoals.target_checklist_items} onChange={e => setEditingUserGoals(prev => ({ ...prev, target_checklist_items: Number(e.target.value) || 0 }))} />
              </div>
            </div>
          </div>
          <SheetFooter className="flex-row justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setUserGoalsDialogOpen(false)}>Cancelar</Button>
            <Button onClick={saveUserDailyGoals} disabled={savingUserGoals}>
              {savingUserGoals ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Salvar
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
