import { useState, useMemo, useCallback, useEffect } from 'react';
import { CorridaMalucaDialog } from '@/components/instagram/CorridaMalucaDialog';
import { MemberProductivitySheet } from './MemberProductivitySheet';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import {
  BarChart3,
  Trophy,
  Clock,
  MessageSquare,
  Send,
  Users,
  Target,
  TrendingUp,
  Loader2,
  Shield,
  Calendar,
  User,
  ArrowRightLeft,
  Eye,
  CheckCircle2,
  Phone,
  UserPlus,
  Link2,
  ClipboardList,
  ListChecks,
  Settings2,
  UsersRound,
  Activity,
} from 'lucide-react';
import { useTeamProductivity } from '@/hooks/useTeamProductivity';
import { useUserRole } from '@/hooks/useUserRole';
import { subDays, format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfDay, endOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
} from 'recharts';

type DateRangeOption = 'today' | 'yesterday' | '7d' | '14d' | '30d' | 'week' | 'month';

export function TeamProductivityDashboard() {
  const { isAdmin, loading: roleLoading } = useUserRole();
  const [dateRangeOption, setDateRangeOption] = useState<DateRangeOption>('today');
  const [selectedMember, setSelectedMember] = useState<any>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const allMetrics = useMemo(() => [
    { key: 'commentReplies', label: 'comentários', color: 'text-blue-600', corridaKey: 'comments_count' },
    { key: 'dmsSent', label: 'DMs', color: 'text-violet-600', corridaKey: 'mentions_count' },
    { key: 'contactsCreated', label: 'contatos', color: 'text-teal-600', corridaKey: 'contacts_created' },
    { key: 'leadsCreated', label: 'leads', color: 'text-indigo-600', corridaKey: 'leads_created' },
    { key: 'callsMade', label: 'ligações', color: 'text-green-600', corridaKey: 'calls_made' },
    { key: 'stageChanges', label: 'fases', color: 'text-amber-600', corridaKey: 'stage_changes' },
    { key: 'leadsProgressed', label: 'leads progr.', color: 'text-purple-600', corridaKey: 'leads_progressed' },
    { key: 'checklistItemsChecked', label: 'passos', color: 'text-cyan-600', corridaKey: 'checklist_items' },
    { key: 'activitiesCompleted', label: 'ativ. concluídas', color: 'text-emerald-600', corridaKey: 'activities_completed' },
    { key: 'activitiesOverdue', label: 'atrasadas', color: 'text-red-600', corridaKey: 'activities_overdue' },
    { key: 'leadsClosed', label: 'fechados', color: 'text-rose-600', corridaKey: 'leads_closed' },
    { key: 'sessionMinutes', label: 'tempo', color: 'text-orange-600', corridaKey: 'session_minutes' },
    { key: 'velocity', label: 'passos/h', color: 'text-pink-600', corridaKey: 'velocity' },
  ] as const, []);

  const defaultVisibleMetrics = ['checklistItemsChecked', 'leadsCreated', 'leadsProgressed', 'leadsClosed', 'stageChanges', 'velocity'];
  const [visibleMetrics, setVisibleMetrics] = useState<string[]>(defaultVisibleMetrics);
  const [visibleUsers, setVisibleUsers] = useState<string[]>([]);
  const [usersInitialized, setUsersInitialized] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('all');
  const [teams, setTeams] = useState<{ id: string; name: string; color: string | null }[]>([]);
  const [teamMembers, setTeamMembers] = useState<{ team_id: string; user_id: string; evaluated_metrics: string[] }[]>([]);
  const [routinesByUser, setRoutinesByUser] = useState<Record<string, { activity_type: string; start_hour: number; start_minute: number; end_hour: number; end_minute: number }[]>>({});
  const [activityTypeLabels, setActivityTypeLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    const fetchTeams = async () => {
      const [teamsRes, membersRes, routinesRes, typesRes] = await Promise.all([
        supabase.from('teams').select('id, name, color').order('name'),
        supabase.from('team_members').select('team_id, user_id, evaluated_metrics'),
        supabase.from('user_timeblock_settings').select('user_id, activity_type, start_hour, start_minute, end_hour, end_minute'),
        supabase.from('activity_types').select('key, label').eq('is_active', true),
      ]);
      setTeams(teamsRes.data || []);
      setTeamMembers((membersRes.data || []).map(m => ({
        ...m,
        evaluated_metrics: (m.evaluated_metrics as string[]) || [],
      })));

      // Group routines by user
      const grouped: Record<string, typeof routinesRes.data> = {};
      (routinesRes.data || []).forEach(r => {
        if (!grouped[r.user_id]) grouped[r.user_id] = [];
        grouped[r.user_id]!.push(r);
      });
      // Sort each user's routines by start time
      Object.values(grouped).forEach(arr => arr!.sort((a, b) => (a.start_hour * 60 + (a.start_minute || 0)) - (b.start_hour * 60 + (b.start_minute || 0))));
      setRoutinesByUser(grouped as any);

      // Map activity type keys to labels
      const labels: Record<string, string> = {};
      (typesRes.data || []).forEach(t => { labels[t.key] = t.label; });
      setActivityTypeLabels(labels);
    };
    fetchTeams();
  }, []);

  const toggleMetric = useCallback((key: string) => {
    setVisibleMetrics(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  }, []);

  const toggleUser = useCallback((userId: string) => {
    setVisibleUsers(prev =>
      prev.includes(userId) ? prev.filter(u => u !== userId) : [...prev, userId]
    );
  }, []);

  const dateRange = useMemo(() => {
    const now = new Date();
    const yesterday = subDays(now, 1);
    switch (dateRangeOption) {
      case 'today':
        return { start: startOfDay(now), end: endOfDay(now) };
      case 'yesterday':
        return { start: startOfDay(yesterday), end: endOfDay(yesterday) };
      case '7d':
        return { start: subDays(now, 7), end: now };
      case '14d':
        return { start: subDays(now, 14), end: now };
      case '30d':
        return { start: subDays(now, 30), end: now };
      case 'week':
        return { start: startOfWeek(now, { locale: ptBR }), end: endOfWeek(now, { locale: ptBR }) };
      case 'month':
        return { start: startOfMonth(now), end: endOfMonth(now) };
      default:
        return { start: startOfDay(now), end: endOfDay(now) };
    }
  }, [dateRangeOption]);

  const { productivity, timeline, dailyMetrics, sessions, summary, loading } = useTeamProductivity(dateRange);

  // Initialize visible users when productivity data loads
  const allUsers = useMemo(() => productivity.map(p => ({
    userId: p.userId,
    displayName: p.userName || p.email?.split('@')[0] || 'Usuário',
  })), [productivity]);

  // Auto-select all users on first load
  useMemo(() => {
    if (!usersInitialized && allUsers.length > 0) {
      setVisibleUsers(allUsers.map(u => u.userId));
      setUsersInitialized(true);
    }
  }, [allUsers, usersInitialized]);

  // Get user IDs for selected team
  const teamFilteredUserIds = useMemo(() => {
    if (selectedTeamId === 'all') return null;
    return teamMembers.filter(tm => tm.team_id === selectedTeamId).map(tm => tm.user_id);
  }, [selectedTeamId, teamMembers]);

  // Sync visible metrics when a team is selected based on evaluated_metrics
  const metricKeyMap: Record<string, string> = useMemo(() => ({
    replies: 'commentReplies',
    dms: 'dmsSent',
    leads: 'leadsCreated',
    session_minutes: 'sessionMinutes',
    contacts: 'contactsCreated',
    calls: 'callsMade',
    activities: 'activitiesCompleted',
    stage_changes: 'stageChanges',
    leads_closed: 'leadsClosed',
    checklist_items: 'checklistItemsChecked',
  }), []);

  useEffect(() => {
    if (selectedTeamId === 'all') {
      setVisibleMetrics(defaultVisibleMetrics);
      return;
    }
    const membersOfTeam = teamMembers.filter(tm => tm.team_id === selectedTeamId);
    if (membersOfTeam.length === 0) return;
    // Union of all evaluated_metrics across team members
    const evaluatedKeys = new Set<string>();
    membersOfTeam.forEach(m => {
      (m.evaluated_metrics || []).forEach(k => evaluatedKeys.add(k));
    });
    if (evaluatedKeys.size === 0) return;
    // Map team metric keys to dashboard metric keys
    const mapped = Array.from(evaluatedKeys)
      .map(k => metricKeyMap[k])
      .filter(Boolean);
    if (mapped.length > 0) {
      setVisibleMetrics(mapped);
    }
  }, [selectedTeamId, teamMembers, metricKeyMap]);

  if (roleLoading || loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">
            Apenas administradores podem ver o dashboard de produtividade
          </p>
        </CardContent>
      </Card>
    );
  }

  // Prepare ranking data (filtered by visible users AND team)
  const rankingData = productivity
    .filter(p => visibleUsers.includes(p.userId))
    .filter(p => !teamFilteredUserIds || teamFilteredUserIds.includes(p.userId))
    .map((p, index) => {
      const sessionHours = p.sessionMinutes / 60;
      const velocity = sessionHours > 0 ? Math.round((p.checklistItemsChecked / sessionHours) * 10) / 10 : 0;
      const safeTotalActions = Math.max(0, Number(p.totalActions) || 0);
      return {
        ...p,
        totalActions: safeTotalActions,
        velocity,
        position: index + 1,
        displayName: p.userName || p.email?.split('@')[0] || 'Usuário',
      };
    });

  // Prepare chart data
  const comparisonData = productivity.map(p => ({
    name: p.userName || p.email?.split('@')[0] || 'Usuário',
    respostas: p.commentReplies,
    dms: p.dmsSent,
    contatos: p.contactsCreated,
    fases: p.stageChanges,
    ligacoes: p.callsMade,
    passos: p.checklistItemsChecked,
  }));

  const getActionTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      comment_reply: 'Respondeu comentário',
      dm_sent: 'Enviou DM',
      dm_copied: 'Copiou DM',
      lead_created: 'Criou lead',
      lead_moved: 'Moveu lead',
      lead_updated: 'Atualizou lead',
      contact_created: 'Criou contato',
      contact_updated: 'Atualizou contato',
      contact_classified: 'Classificou contato',
      follow_requested: 'Solicitou seguir',
      workflow_session_start: 'Iniciou sessão',
      workflow_session_end: 'Finalizou sessão',
      page_visit: 'Visitou página',
      login: 'Entrou no sistema',
      logout: 'Saiu do sistema',
      button_click: 'Clicou em botão',
      form_submit: 'Enviou formulário',
      filter_applied: 'Aplicou filtro',
      export_data: 'Exportou dados',
      search_performed: 'Realizou busca',
    };
    return labels[type] || type;
  };

  const getEndReasonLabel = (reason: string | null) => {
    if (!reason) return 'Ativa';
    const labels: Record<string, string> = {
      logout: 'Logout',
      inactivity: 'Inatividade',
      tab_close: 'Fechou aba',
      session_expired: 'Sessão expirada',
      new_session: 'Nova sessão',
    };
    return labels[reason] || reason;
  };

  const getEndReasonColor = (reason: string | null) => {
    if (!reason) return 'bg-green-100 text-green-700';
    const colors: Record<string, string> = {
      logout: 'bg-blue-100 text-blue-700',
      inactivity: 'bg-yellow-100 text-yellow-700',
      tab_close: 'bg-orange-100 text-orange-700',
      session_expired: 'bg-red-100 text-red-700',
      new_session: 'bg-gray-100 text-gray-700',
    };
    return colors[reason] || 'bg-gray-100 text-gray-700';
  };

  const getActionTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      comment_reply: 'bg-blue-100 text-blue-700',
      dm_sent: 'bg-violet-100 text-violet-700',
      dm_copied: 'bg-purple-100 text-purple-700',
      lead_created: 'bg-green-100 text-green-700',
      lead_moved: 'bg-yellow-100 text-yellow-700',
      contact_created: 'bg-teal-100 text-teal-700',
      follow_requested: 'bg-orange-100 text-orange-700',
      workflow_session_start: 'bg-emerald-100 text-emerald-700',
      workflow_session_end: 'bg-red-100 text-red-700',
      page_visit: 'bg-sky-100 text-sky-700',
      login: 'bg-green-100 text-green-700',
      logout: 'bg-gray-100 text-gray-700',
    };
    return colors[type] || 'bg-gray-100 text-gray-700';
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '-';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}min`;
    }
    return `${minutes}min`;
  };

  const formatMinutesToHours = (totalMinutes: number) => {
    if (!totalMinutes) return '0min';
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) {
      return `${hours}h ${minutes}min`;
    }
    return `${minutes}min`;
  };

  // Summary stats
  const totalReplies = productivity.reduce((sum, p) => sum + p.commentReplies, 0);
  const totalDms = productivity.reduce((sum, p) => sum + p.dmsSent, 0);
  const totalContacts = productivity.reduce((sum, p) => sum + p.contactsCreated, 0);
  const totalMinutes = productivity.reduce((sum, p) => sum + p.sessionMinutes, 0);
  const totalCalls = productivity.reduce((sum, p) => sum + p.callsMade, 0);
  const totalChecklists = productivity.reduce((sum, p) => sum + p.checklistItemsChecked, 0);
  const totalActivitiesCompleted = productivity.reduce((sum, p) => sum + p.activitiesCompleted, 0);
  const totalActivitiesOverdue = productivity.reduce((sum, p) => sum + p.activitiesOverdue, 0);

  return (
    <div className="space-y-6">
      {/* Header with date filter */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6" />
            Produtividade da Equipe
          </h2>
          <p className="text-muted-foreground text-sm">
            Acompanhe o desempenho de cada membro
          </p>
        </div>
        <Select value={dateRangeOption} onValueChange={(v) => setDateRangeOption(v as DateRangeOption)}>
          <SelectTrigger className="w-44">
            <Calendar className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Hoje</SelectItem>
            <SelectItem value="yesterday">Ontem</SelectItem>
            <SelectItem value="7d">Últimos 7 dias</SelectItem>
            <SelectItem value="14d">Últimos 14 dias</SelectItem>
            <SelectItem value="30d">Últimos 30 dias</SelectItem>
            <SelectItem value="week">Esta semana</SelectItem>
            <SelectItem value="month">Este mês</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-blue-100 text-blue-700"><MessageSquare className="h-4 w-4" /></div>
              <div><p className="text-xl font-bold">{totalReplies}</p><p className="text-[10px] text-muted-foreground">Comentários</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-violet-100 text-violet-700"><Send className="h-4 w-4" /></div>
              <div><p className="text-xl font-bold">{totalDms}</p><p className="text-[10px] text-muted-foreground">DMs enviadas</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-teal-100 text-teal-700"><UserPlus className="h-4 w-4" /></div>
              <div><p className="text-xl font-bold">{totalContacts}</p><p className="text-[10px] text-muted-foreground">Contatos</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-indigo-100 text-indigo-700"><Target className="h-4 w-4" /></div>
              <div><p className="text-xl font-bold">{productivity.reduce((sum, p) => sum + p.leadsCreated, 0)}</p><p className="text-[10px] text-muted-foreground">Leads</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-green-100 text-green-700"><Phone className="h-4 w-4" /></div>
              <div><p className="text-xl font-bold">{totalCalls}</p><p className="text-[10px] text-muted-foreground">Ligações</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-amber-100 text-amber-700"><ArrowRightLeft className="h-4 w-4" /></div>
              <div><p className="text-xl font-bold">{summary.totalStageChanges}</p><p className="text-[10px] text-muted-foreground">Fases</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-cyan-100 text-cyan-700"><ListChecks className="h-4 w-4" /></div>
              <div><p className="text-xl font-bold">{totalChecklists}</p><p className="text-[10px] text-muted-foreground">Passos</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-rose-100 text-rose-700"><CheckCircle2 className="h-4 w-4" /></div>
              <div><p className="text-xl font-bold">{summary.totalLeadsClosed}</p><p className="text-[10px] text-muted-foreground">Fechados</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-indigo-100 text-indigo-700"><ClipboardList className="h-4 w-4" /></div>
              <div><p className="text-xl font-bold">{summary.totalFollowups}</p><p className="text-[10px] text-muted-foreground">Follow-ups</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-orange-100 text-orange-700"><Clock className="h-4 w-4" /></div>
              <div><p className="text-xl font-bold">{Math.round(totalMinutes / 60)}h</p><p className="text-[10px] text-muted-foreground">Tempo</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-100 text-emerald-700"><CheckCircle2 className="h-4 w-4" /></div>
              <div><p className="text-xl font-bold">{totalActivitiesCompleted}</p><p className="text-[10px] text-muted-foreground">Atv Concluídas</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className={`p-1.5 rounded-lg ${totalActivitiesOverdue > 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}><Clock className="h-4 w-4" /></div>
              <div><p className={`text-xl font-bold ${totalActivitiesOverdue > 0 ? 'text-red-600' : ''}`}>{totalActivitiesOverdue}</p><p className="text-[10px] text-muted-foreground">Atv Atrasadas</p></div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="ranking" className="space-y-4">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="ranking" className="gap-2">
            <Trophy className="h-4 w-4" />
            Ranking
          </TabsTrigger>
          <TabsTrigger value="sessions" className="gap-2">
            <Clock className="h-4 w-4" />
            Sessões
          </TabsTrigger>
          <TabsTrigger value="chart" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Gráfico
          </TabsTrigger>
          <TabsTrigger value="timeline" className="gap-2">
            <Users className="h-4 w-4" />
            Timeline
          </TabsTrigger>
          <TabsTrigger value="evolution" className="gap-2">
            <TrendingUp className="h-4 w-4" />
            Evolução
          </TabsTrigger>
          <TabsTrigger value="realtime" className="gap-2">
            <Activity className="h-4 w-4" />
            Ao Vivo
          </TabsTrigger>
        </TabsList>

        {/* Ranking Tab */}
        <TabsContent value="ranking">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Trophy className="h-5 w-5 text-yellow-500" />
                   Ranking de Produtividade
                  </CardTitle>
                  <CardDescription>
                    Ordenado por pontuação total (soma das métricas selecionadas)
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {teams.length > 0 && (
                    <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
                      <SelectTrigger className="w-40 h-9 text-sm">
                        <UsersRound className="h-4 w-4 mr-1" />
                        <SelectValue placeholder="Time" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os times</SelectItem>
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
                  )}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2">
                        <Users className="w-4 h-4" />
                        Membros ({visibleUsers.length}/{allUsers.length})
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-3 bg-popover" align="end">
                      <p className="text-sm font-medium mb-2">Membros visíveis</p>
                      <div className="space-y-2">
                        {allUsers.map(u => (
                          <label key={u.userId} className="flex items-center gap-2 cursor-pointer text-sm">
                            <Checkbox
                              checked={visibleUsers.includes(u.userId)}
                              onCheckedChange={() => toggleUser(u.userId)}
                            />
                            <span>{u.displayName}</span>
                          </label>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2">
                        <Settings2 className="w-4 h-4" />
                        Métricas ({visibleMetrics.length})
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-3 bg-popover" align="end">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-medium">Métricas visíveis</p>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs px-2"
                          onClick={() => {
                            if (visibleMetrics.length === allMetrics.length) {
                              setVisibleMetrics([]);
                            } else {
                              setVisibleMetrics(allMetrics.map(m => m.key));
                            }
                          }}
                        >
                          {visibleMetrics.length === allMetrics.length ? 'Desmarcar tudo' : 'Selecionar tudo'}
                        </Button>
                      </div>
                      <div className="space-y-2">
                        {allMetrics.map(m => (
                          <label key={m.key} className="flex items-center gap-2 cursor-pointer text-sm">
                            <Checkbox
                              checked={visibleMetrics.includes(m.key)}
                              onCheckedChange={() => toggleMetric(m.key)}
                            />
                            <span>{m.label}</span>
                          </label>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <CorridaMalucaDialog
                    rankings={rankingData.map(m => {
                      const entry: any = {
                        username: m.displayName,
                        total_points: m.totalActions,
                        rank_position: m.position,
                        badge_level: m.position <= 3 ? ['gold', 'silver', 'bronze'][m.position - 1] : 'none',
                      };
                      // Only include metrics that are visible
                      const metricToCorridaMap: Record<string, { key: string; memberKey: string }> = {
                        commentReplies: { key: 'comments_count', memberKey: 'commentReplies' },
                        dmsSent: { key: 'mentions_count', memberKey: 'dmsSent' },
                        contactsCreated: { key: 'contacts_created', memberKey: 'contactsCreated' },
                        leadsCreated: { key: 'leads_created', memberKey: 'leadsCreated' },
                        callsMade: { key: 'calls_made', memberKey: 'callsMade' },
                        stageChanges: { key: 'stage_changes', memberKey: 'stageChanges' },
                        leadsProgressed: { key: 'leads_progressed', memberKey: 'leadsProgressed' },
                        checklistItemsChecked: { key: 'checklist_items', memberKey: 'checklistItemsChecked' },
                        leadsClosed: { key: 'leads_closed', memberKey: 'leadsClosed' },
                        activitiesCompleted: { key: 'activities_completed', memberKey: 'activitiesCompleted' },
                        activitiesOverdue: { key: 'activities_overdue', memberKey: 'activitiesOverdue' },
                        sessionMinutes: { key: 'session_minutes', memberKey: 'sessionMinutes' },
                        velocity: { key: 'velocity', memberKey: 'velocity' },
                      };
                      visibleMetrics.forEach(vk => {
                        const mapping = metricToCorridaMap[vk];
                        if (mapping) {
                          entry[mapping.key] = (m as any)[mapping.memberKey];
                        }
                      });
                      return entry;
                    })}
                    weekStart={dateRange.start}
                    weekEnd={dateRange.end}
                    memberContexts={rankingData.map(m => {
                      const userTeams = teamMembers
                        .filter(tm => tm.user_id === m.userId)
                        .map(tm => teams.find(t => t.id === tm.team_id)?.name)
                        .filter(Boolean) as string[];
                      const userRoutine = (routinesByUser[m.userId] || [])
                        .map(r => {
                          const label = activityTypeLabels[r.activity_type] || r.activity_type;
                          const fmt = (h: number, min: number) => `${String(h).padStart(2,'0')}:${String(min || 0).padStart(2,'0')}`;
                          return `${fmt(r.start_hour, r.start_minute)}-${fmt(r.end_hour, r.end_minute)} ${label}`;
                        });
                      return {
                        username: m.displayName,
                        teams: userTeams,
                        routine: userRoutine,
                      };
                    })}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {rankingData.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Nenhuma atividade registrada no período
                </div>
              ) : (
                <div className="space-y-3">
                  {rankingData.map((member) => (
                    <div
                      key={member.userId}
                      className="flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => { setSelectedMember(member); setSheetOpen(true); }}
                    >
                      <div className={`
                        w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg
                        ${member.position === 1 ? 'bg-yellow-100 text-yellow-700' : ''}
                        ${member.position === 2 ? 'bg-gray-200 text-gray-700' : ''}
                        ${member.position === 3 ? 'bg-orange-100 text-orange-700' : ''}
                        ${member.position > 3 ? 'bg-muted text-muted-foreground' : ''}
                      `}>
                        {member.position}
                      </div>

                      <div className="flex-1">
                        <p className="font-medium">{member.displayName}</p>
                        <p className="text-xs text-muted-foreground">{member.email}</p>
                      </div>

                      <div className={`grid gap-2 text-sm`} style={{ gridTemplateColumns: `repeat(${visibleMetrics.length}, minmax(0, 1fr))` }}>
                        {allMetrics.filter(m => visibleMetrics.includes(m.key)).map(metric => {
                          const value = metric.key === 'sessionMinutes'
                            ? formatMinutesToHours((member as any)[metric.key])
                            : metric.key === 'velocity'
                            ? `${(member as any)[metric.key]}/h`
                            : (member as any)[metric.key];
                          const isOverdue = metric.key === 'activitiesOverdue' && (member as any)[metric.key] > 0;
                          return (
                            <div key={metric.key} className="text-center">
                              <p className={`font-semibold ${isOverdue ? 'text-red-600' : metric.color}`}>{value}</p>
                              <p className="text-[10px] text-muted-foreground">{metric.label}</p>
                            </div>
                          );
                        })}
                      </div>

                      <Badge variant="outline" className="ml-4">
                        {Math.max(0, member.totalActions || 0)} pts
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sessions Tab */}
        <TabsContent value="sessions">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Histórico de Sessões
              </CardTitle>
              <CardDescription>
                Entradas, saídas e tempo de uso no sistema
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px] pr-4">
                {sessions.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Nenhuma sessão registrada no período
                  </div>
                ) : (
                  <div className="space-y-3">
                    {sessions.map((session) => (
                      <div
                        key={session.id}
                        className="flex items-start gap-3 p-4 rounded-lg border bg-card"
                      >
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <User className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">
                              {session.user_name || session.user_email?.split('@')[0] || 'Usuário'}
                            </span>
                            <Badge className={`text-xs ${getEndReasonColor(session.end_reason)}`}>
                              {getEndReasonLabel(session.end_reason)}
                            </Badge>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3 text-sm">
                            <div>
                              <p className="text-xs text-muted-foreground">Entrada</p>
                              <p className="font-medium">
                                {format(new Date(session.started_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Saída</p>
                              <p className="font-medium">
                                {session.ended_at 
                                  ? format(new Date(session.ended_at), "dd/MM/yyyy HH:mm", { locale: ptBR })
                                  : 'Ainda ativo'
                                }
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Duração</p>
                              <p className="font-medium text-primary">
                                {formatDuration(session.duration_seconds)}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Última atividade</p>
                              <p className="font-medium">
                                {format(new Date(session.last_activity_at), "HH:mm", { locale: ptBR })}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Chart Tab */}
        <TabsContent value="chart">
          <Card>
            <CardHeader>
              <CardTitle>Comparativo por Membro</CardTitle>
            </CardHeader>
            <CardContent>
              {comparisonData.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Nenhuma atividade registrada no período
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={comparisonData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="respostas" fill="#3b82f6" name="Respostas" />
                    <Bar dataKey="dms" fill="#8b5cf6" name="DMs" />
                    <Bar dataKey="contatos" fill="#14b8a6" name="Contatos" />
                    <Bar dataKey="ligacoes" fill="#22c55e" name="Ligações" />
                    <Bar dataKey="fases" fill="#f59e0b" name="Fases" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Timeline Tab */}
        <TabsContent value="timeline">
          <Card>
            <CardHeader>
              <CardTitle>Timeline de Ações</CardTitle>
              <CardDescription>
                Últimas 100 ações registradas
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px] pr-4">
                {timeline.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Nenhuma atividade registrada no período
                  </div>
                ) : (
                  <div className="space-y-3">
                    {timeline.map((activity) => (
                      <div
                        key={activity.id}
                        className="flex items-start gap-3 p-3 rounded-lg border bg-card"
                      >
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <User className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">
                              {activity.user_name || activity.user_email?.split('@')[0] || 'Usuário'}
                            </span>
                            <Badge className={`text-xs ${getActionTypeColor(activity.action_type)}`}>
                              {getActionTypeLabel(activity.action_type)}
                            </Badge>
                          </div>
                          {activity.metadata && Object.keys(activity.metadata).length > 0 && (
                            <p className="text-xs text-muted-foreground mt-1 truncate">
                              {JSON.stringify(activity.metadata).slice(0, 100)}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            {format(new Date(activity.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Evolution Tab */}
        <TabsContent value="evolution">
          <Card>
            <CardHeader>
              <CardTitle>Evolução Diária</CardTitle>
            </CardHeader>
            <CardContent>
              {dailyMetrics.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Nenhuma atividade registrada no período
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={400}>
                  <LineChart data={dailyMetrics}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="date" 
                      tickFormatter={(value) => format(new Date(value), 'dd/MM')}
                    />
                    <YAxis />
                    <Tooltip 
                      labelFormatter={(value) => format(new Date(value), "dd/MM/yyyy", { locale: ptBR })}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="replies" stroke="#3b82f6" name="Respostas" strokeWidth={2} />
                    <Line type="monotone" dataKey="dms" stroke="#8b5cf6" name="DMs" strokeWidth={2} />
                    <Line type="monotone" dataKey="contacts" stroke="#14b8a6" name="Contatos" strokeWidth={2} />
                    <Line type="monotone" dataKey="stageChanges" stroke="#f59e0b" name="Fases" strokeWidth={2} />
                    <Line type="monotone" dataKey="followups" stroke="#6366f1" name="Follow-ups" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Realtime Tab */}
        <TabsContent value="realtime">
          <RealTimeActivityFeed />
        </TabsContent>
      </Tabs>

      <MemberProductivitySheet
        member={selectedMember}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        dateRange={dateRange}
      />
    </div>
  );
}
