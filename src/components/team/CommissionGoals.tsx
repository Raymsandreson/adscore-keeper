import { useState, useEffect, useMemo, useCallback } from 'react';
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
  ChevronDown, ChevronUp, Loader2, UsersRound, LayoutGrid, X,
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

        setGoals(goalsData.map(g => ({ ...g, board_ids: (g as any).board_ids || [], tiers: tiersMap.get(g.id) || [] })));
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

  const getMetricValue = (userId: string, metricKey: string): number => {
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

  const getCommissionForPercent = (goalTiers: CommissionTier[], percent: number): number => {
    const tier = goalTiers.find(t => percent >= t.min_percent && percent < t.max_percent);
    return tier?.commission_value || 0;
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
        const commission = getCommissionForPercent(goal.tiers, percent);
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
          const commission = getCommissionForPercent(goal.tiers, percent);
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
                        {entries.map(entry => (
                          <TableRow key={entry.userId}>
                            <TableCell className="font-medium">{entry.name}</TableCell>
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
                        ))}
                      </TableBody>
                    </Table>

                    {/* Tiers display */}
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">Faixas de comissão:</p>
                      <div className="flex flex-wrap gap-2">
                        {goal.tiers.map((tier, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {tier.min_percent}%-{tier.max_percent === 999 ? '∞' : tier.max_percent + '%'}: R$ {tier.commission_value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </Badge>
                        ))}
                      </div>
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

            {/* Tiers */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Faixas de comissão</Label>
                <Button variant="ghost" size="sm" onClick={addTier}>
                  <Plus className="h-3 w-3 mr-1" /> Faixa
                </Button>
              </div>
              <div className="space-y-2">
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
          </div>
          <SheetFooter className="flex-row justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave}>{editingGoal ? 'Salvar' : 'Criar Meta'}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
