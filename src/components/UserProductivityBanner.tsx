import { useState, useEffect, useMemo } from 'react';
import { useMyProductivity } from '@/hooks/useMyProductivity';
import { useMyTeamRanking } from '@/hooks/useMyTeamRanking';
import { useAuthContext } from '@/contexts/AuthContext';
import { useLocation } from 'react-router-dom';
import { MemberProductivitySheet } from '@/components/team/MemberProductivitySheet';
import type { UserProductivity } from '@/hooks/useTeamProductivity';
import { startOfDay, endOfDay } from 'date-fns';
import { Progress } from '@/components/ui/progress';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { MetricDetailSheet, type MetricKey } from '@/components/MetricDetailSheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ChevronDown,
  ChevronUp,
  Trophy,
  MessageSquare,
  Send,
  Users,
  Target,
  Phone,
  ListChecks,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowRightLeft,
  Briefcase,
  Medal,
} from 'lucide-react';

const METRICS = [
  { key: 'commentReplies', label: 'Comentários Enviados', icon: MessageSquare, color: 'text-blue-500' },
  { key: 'dmsSent', label: 'DMs', icon: Send, color: 'text-violet-500' },
  { key: 'contactsCreated', label: 'Contatos', icon: Users, color: 'text-teal-500' },
  { key: 'leadsCreated', label: 'Leads', icon: Target, color: 'text-indigo-500' },
  { key: 'callsMade', label: 'Ligações', icon: Phone, color: 'text-green-500' },
  { key: 'stageChanges', label: 'Etapas', icon: ArrowRightLeft, color: 'text-amber-500' },
  { key: 'leadsProgressed', label: 'Leads Progr.', icon: Briefcase, color: 'text-purple-500' },
  { key: 'checklistItemsChecked', label: 'Passos', icon: ListChecks, color: 'text-cyan-500' },
  { key: 'activitiesCompleted', label: 'Ativ. Concl.', icon: CheckCircle2, color: 'text-emerald-500' },
  { key: 'activitiesOverdue', label: 'Atrasadas', icon: AlertTriangle, color: 'text-red-500' },
  { key: 'leadsClosed', label: 'Fechados', icon: Trophy, color: 'text-yellow-500' },
] as const;

// Pages where the banner should NOT be shown
const HIDDEN_ROUTES = ['/dashboard', '/expense-form'];

export function UserProductivityBanner() {
  const { user, profile } = useAuthContext();
  const { data, goals, goalProgress, loading } = useMyProductivity();
  const { ranking, myTeams, selectedTeamId, selectTeam, myPosition, loading: rankingLoading, fetchRanking } = useMyTeamRanking();
  const [expanded, setExpanded] = useState(false);
  const [rankingFetched, setRankingFetched] = useState(false);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [metricSheetOpen, setMetricSheetOpen] = useState(false);
  const [selectedMetricKey, setSelectedMetricKey] = useState<MetricKey | null>(null);
  const location = useLocation();

  const today = useMemo(() => ({ start: startOfDay(new Date()), end: endOfDay(new Date()) }), []);

  const memberForSheet = useMemo<(UserProductivity & { displayName: string }) | null>(() => {
    if (!user) return null;
    return {
      userId: user.id,
      userName: profile?.full_name || null,
      email: user.email || null,
      displayName: profile?.full_name?.split(' ')[0] || 'Você',
      commentReplies: data.commentReplies,
      dmsSent: data.dmsSent,
      contactsCreated: data.contactsCreated,
      leadsCreated: data.leadsCreated,
      leadsClosed: data.leadsClosed,
      leadsProgressed: data.leadsProgressed,
      callsMade: data.callsMade,
      stageChanges: data.stageChanges,
      checklistItemsChecked: data.checklistItemsChecked,
      activitiesCompleted: data.activitiesCompleted,
      activitiesOverdue: data.activitiesOverdue,
      sessionMinutes: data.sessionMinutes,
      totalActions: data.totalActions,
      contactsLinked: 0,
      dmsReceived: 0,
      followupsCreated: 0,
      followupsDone: 0,
      pageVisits: 0,
    };
  }, [user, profile, data]);

  // Reset expanded on navigation
  useEffect(() => {
    setExpanded(false);
  }, [location.pathname]);

  // Fetch ranking only when expanded for the first time
  useEffect(() => {
    if (expanded && !rankingFetched) {
      fetchRanking();
      setRankingFetched(true);
    }
  }, [expanded, rankingFetched, fetchRanking]);

  // Don't show for unauthenticated users or on certain pages
  if (!user || loading || HIDDEN_ROUTES.some(r => location.pathname.startsWith(r))) {
    return null;
  }

  const firstName = profile?.full_name?.split(' ')[0] || 'Usuário';

  const openMetricSheet = (key: MetricKey) => {
    setSelectedMetricKey(key);
    setMetricSheetOpen(true);
  };

  // Key metrics for compact view
  const compactMetrics = [
    { key: 'leadsCreated' as MetricKey, label: 'Leads', value: data.leadsCreated, icon: Target, color: 'text-indigo-500' },
    { key: 'checklistItemsChecked' as MetricKey, label: 'Passos', value: data.checklistItemsChecked, icon: ListChecks, color: 'text-cyan-500' },
    { key: 'stageChanges' as MetricKey, label: 'Etapas', value: data.stageChanges, icon: ArrowRightLeft, color: 'text-amber-500' },
    { key: 'leadsClosed' as MetricKey, label: 'Fechados', value: data.leadsClosed, icon: Trophy, color: 'text-yellow-500' },
    { key: 'contactsCreated' as MetricKey, label: 'Contatos', value: data.contactsCreated, icon: Users, color: 'text-teal-500' },
  ];

  // Goal items for detail view
  const goalItems = [
    { label: 'Comentários Enviados', current: data.commentReplies, target: goals.target_replies },
    { label: 'DMs', current: data.dmsSent, target: goals.target_dms },
    { label: 'Leads', current: data.leadsCreated, target: goals.target_leads },
    { label: 'Tempo', current: data.sessionMinutes, target: goals.target_session_minutes, suffix: 'min' },
  ];

  const progressColor = goalProgress >= 100 ? 'text-green-500' : goalProgress >= 50 ? 'text-amber-500' : 'text-red-500';

  const positionIcon = (pos: number) => {
    if (pos === 1) return '🥇';
    if (pos === 2) return '🥈';
    if (pos === 3) return '🥉';
    return `${pos}º`;
  };

  return (
    <>
    <div className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {/* Compact bar - always visible */}
      <div className="flex items-center gap-3 px-4 py-2">
        {/* User & goal progress */}
        <div className="flex items-center gap-2 min-w-0">
          <Trophy className="h-4 w-4 text-primary flex-shrink-0" />
          <span className="text-sm font-medium truncate">{firstName}</span>
          <Badge variant="outline" className={`text-xs font-bold ${progressColor} flex-shrink-0`}>
            <AnimatedNumber value={goalProgress} suffix="%" />
          </Badge>
          {myPosition && (
            <Badge variant="secondary" className="text-xs font-bold flex-shrink-0">
              {positionIcon(myPosition)}
            </Badge>
          )}
        </div>

        {/* Progress bar */}
        <div className="w-20 flex-shrink-0">
          <Progress value={goalProgress} className="h-2" />
        </div>

        {/* Divider */}
        <div className="h-4 w-px bg-border flex-shrink-0" />

        {/* Compact metrics */}
        <div className="flex items-center gap-3 overflow-x-auto flex-1 min-w-0">
          {compactMetrics.map(m => (
            <div
              key={m.label}
              className="flex items-center gap-1 flex-shrink-0 cursor-pointer hover:bg-muted/50 rounded-md px-1.5 py-0.5 transition-colors"
              onClick={() => openMetricSheet(m.key)}
            >
              <m.icon className={`h-3.5 w-3.5 ${m.color}`} />
              <AnimatedNumber value={m.value} className="text-sm font-semibold" />
              <span className="text-xs text-muted-foreground hidden sm:inline">{m.label}</span>
            </div>
          ))}
        </div>

        {/* Session time */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {data.sessionMinutes >= 60
              ? `${Math.floor(data.sessionMinutes / 60)}h${data.sessionMinutes % 60 > 0 ? ` ${data.sessionMinutes % 60}min` : ''}`
              : `${data.sessionMinutes}min`}
          </span>
        </div>

        {/* Points */}
        <Badge variant="secondary" className="text-xs font-bold flex-shrink-0">
          <AnimatedNumber value={data.totalActions} suffix=" pts" />
        </Badge>

        {/* Expand/collapse */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 flex-shrink-0"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>

      {/* Expanded detail view */}
      {expanded && (
        <div className="px-4 pb-3 border-t">
          <div className="grid grid-cols-3 gap-4 mt-3">
            {/* All metrics */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Métricas de Hoje</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {METRICS.map(m => {
                  const value = data[m.key as keyof typeof data] as number;
                  return (
                    <div key={m.key} className="flex items-center gap-1.5 p-1.5 rounded-md bg-muted/50 cursor-pointer hover:bg-muted transition-colors" onClick={() => openMetricSheet(m.key as MetricKey)}>
                      <m.icon className={`h-3.5 w-3.5 ${m.color} flex-shrink-0`} />
                      <div className="min-w-0">
                        <AnimatedNumber value={value} className="text-sm font-bold leading-none" />
                        <p className="text-[10px] text-muted-foreground truncate">{m.label}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Goal progress */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Meta Diária — <AnimatedNumber value={goalProgress} suffix="%" className={progressColor} />
              </p>
              <div className="space-y-2">
                {goalItems.map(g => {
                  const pct = g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 100;
                  return (
                    <div key={g.label} className="space-y-0.5">
                      <div className="flex justify-between text-xs">
                        <span>{g.label}</span>
                        <span className="font-medium">
                          {g.current}{g.suffix || ''} / {g.target}{g.suffix || ''}
                        </span>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Team Ranking */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Medal className="h-3.5 w-3.5" />
                  Ranking do Time
                </p>
                {myTeams.length > 1 && (
                  <Select value={selectedTeamId || ''} onValueChange={selectTeam}>
                    <SelectTrigger className="h-6 text-[10px] w-auto min-w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {myTeams.map(t => (
                        <SelectItem key={t.teamId} value={t.teamId}>
                          <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.teamColor }} />
                            {t.teamName}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {rankingLoading ? (
                <div className="text-xs text-muted-foreground text-center py-4">Carregando...</div>
              ) : ranking.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-4">
                  Você não está em nenhum time
                </div>
              ) : (
                <div className="space-y-1 max-h-[140px] overflow-y-auto">
                  {ranking.map((entry, idx) => (
                    <div
                      key={entry.userId}
                      className={`flex items-center gap-2 p-1.5 rounded-md text-xs ${
                        entry.isCurrentUser ? 'bg-primary/10 ring-1 ring-primary/20' : 'bg-muted/50'
                      }`}
                    >
                      <span className="w-5 text-center font-bold text-muted-foreground">
                        {positionIcon(idx + 1)}
                      </span>
                      <span className={`flex-1 truncate ${entry.isCurrentUser ? 'font-semibold' : ''}`}>
                        {entry.isCurrentUser ? 'Você' : (entry.userName?.split(' ')[0] || '?')}
                      </span>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span title="Leads">{entry.leadsCreated}L</span>
                        <span title="DMs">{entry.dmsSent}💬</span>
                        <span title="Passos">{entry.checklistItemsChecked}P</span>
                        <span title="Etapas">{entry.stageChanges}E</span>
                        <span title="Ligações">{entry.callsMade}📞</span>
                      </div>
                      <Badge variant="secondary" className="text-[10px] h-4 px-1">
                        {entry.totalPoints} pts
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>

    <MemberProductivitySheet
      member={memberForSheet}
      open={detailSheetOpen}
      onOpenChange={setDetailSheetOpen}
      dateRange={today}
    />
    <MetricDetailSheet
      open={metricSheetOpen}
      onOpenChange={setMetricSheetOpen}
      metricKey={selectedMetricKey}
    />
    </>
  );
}
