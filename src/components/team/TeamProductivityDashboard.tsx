import { useState, useMemo } from 'react';
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
} from 'lucide-react';
import { useTeamProductivity } from '@/hooks/useTeamProductivity';
import { useUserRole } from '@/hooks/useUserRole';
import { subDays, format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
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

type DateRangeOption = '7d' | '14d' | '30d' | 'week' | 'month';

export function TeamProductivityDashboard() {
  const { isAdmin, loading: roleLoading } = useUserRole();
  const [dateRangeOption, setDateRangeOption] = useState<DateRangeOption>('7d');

  const dateRange = useMemo(() => {
    const now = new Date();
    switch (dateRangeOption) {
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
        return { start: subDays(now, 7), end: now };
    }
  }, [dateRangeOption]);

  const { productivity, timeline, dailyMetrics, sessions, summary, loading } = useTeamProductivity(dateRange);

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

  // Prepare ranking data
  const rankingData = productivity.map((p, index) => ({
    ...p,
    position: index + 1,
    displayName: p.userName || p.email?.split('@')[0] || 'Usuário',
  }));

  // Prepare chart data
  const comparisonData = productivity.map(p => ({
    name: p.userName || p.email?.split('@')[0] || 'Usuário',
    respostas: p.replies,
    dms: p.dmsSent,
    leads: p.leadsCreated,
    tempo: p.sessionMinutes,
    conversoes: p.stageConversions,
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

  // Summary stats
  const totalReplies = productivity.reduce((sum, p) => sum + p.replies, 0);
  const totalDms = productivity.reduce((sum, p) => sum + p.dmsSent, 0);
  const totalLeads = productivity.reduce((sum, p) => sum + p.leadsCreated, 0);
  const totalMinutes = productivity.reduce((sum, p) => sum + p.sessionMinutes, 0);

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
          <SelectTrigger className="w-40">
            <Calendar className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Últimos 7 dias</SelectItem>
            <SelectItem value="14d">Últimos 14 dias</SelectItem>
            <SelectItem value="30d">Últimos 30 dias</SelectItem>
            <SelectItem value="week">Esta semana</SelectItem>
            <SelectItem value="month">Este mês</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 text-blue-700">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalReplies}</p>
                <p className="text-xs text-muted-foreground">Respostas</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-violet-100 text-violet-700">
                <Send className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalDms}</p>
                <p className="text-xs text-muted-foreground">DMs</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 text-green-700">
                <Target className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalLeads}</p>
                <p className="text-xs text-muted-foreground">Leads</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-100 text-orange-700">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{Math.round(totalMinutes / 60)}h</p>
                <p className="text-xs text-muted-foreground">Tempo total</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100 text-amber-700">
                <ArrowRightLeft className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summary.totalStageConversions}</p>
                <p className="text-xs text-muted-foreground">Conversões</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-sky-100 text-sky-700">
                <Eye className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summary.totalPageVisits}</p>
                <p className="text-xs text-muted-foreground">Visitas</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summary.totalGoalsAchieved}</p>
                <p className="text-xs text-muted-foreground">Metas</p>
              </div>
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
        </TabsList>

        {/* Ranking Tab */}
        <TabsContent value="ranking">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-yellow-500" />
                Ranking de Produtividade
              </CardTitle>
              <CardDescription>
                Ordenado por total de ações realizadas
              </CardDescription>
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
                      className="flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
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

                      <div className="flex gap-3 text-sm flex-wrap">
                        <div className="text-center">
                          <p className="font-semibold text-blue-600">{member.replies}</p>
                          <p className="text-xs text-muted-foreground">respostas</p>
                        </div>
                        <div className="text-center">
                          <p className="font-semibold text-violet-600">{member.dmsSent}</p>
                          <p className="text-xs text-muted-foreground">DMs</p>
                        </div>
                        <div className="text-center">
                          <p className="font-semibold text-green-600">{member.leadsCreated}</p>
                          <p className="text-xs text-muted-foreground">leads</p>
                        </div>
                        <div className="text-center">
                          <p className="font-semibold text-amber-600">{member.stageConversions}</p>
                          <p className="text-xs text-muted-foreground">conversões</p>
                        </div>
                        <div className="text-center">
                          <p className="font-semibold text-sky-600">{member.pageVisits}</p>
                          <p className="text-xs text-muted-foreground">visitas</p>
                        </div>
                        <div className="text-center">
                          <p className="font-semibold text-orange-600">{member.sessionMinutes}min</p>
                          <p className="text-xs text-muted-foreground">tempo</p>
                        </div>
                      </div>

                      <Badge variant="outline" className="ml-4">
                        {member.totalActions} ações
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
                    <Bar dataKey="leads" fill="#22c55e" name="Leads" />
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
                    <Line type="monotone" dataKey="leads" stroke="#22c55e" name="Leads" strokeWidth={2} />
                    <Line type="monotone" dataKey="conversions" stroke="#f59e0b" name="Conversões" strokeWidth={2} />
                    <Line type="monotone" dataKey="goals" stroke="#10b981" name="Metas" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
