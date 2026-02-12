import { useState } from 'react';
import { useMyProductivity } from '@/hooks/useMyProductivity';
import { useAuthContext } from '@/contexts/AuthContext';
import { useLocation } from 'react-router-dom';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
} from 'lucide-react';

const METRICS = [
  { key: 'commentReplies', label: 'Respostas', icon: MessageSquare, color: 'text-blue-500' },
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
  const [expanded, setExpanded] = useState(false);
  const location = useLocation();

  // Don't show for unauthenticated users or on certain pages
  if (!user || loading || HIDDEN_ROUTES.some(r => location.pathname.startsWith(r))) {
    return null;
  }

  const firstName = profile?.full_name?.split(' ')[0] || 'Usuário';

  // Key metrics for compact view
  const compactMetrics = [
    { label: 'Leads', value: data.leadsCreated, icon: Target, color: 'text-indigo-500' },
    { label: 'Passos', value: data.checklistItemsChecked, icon: ListChecks, color: 'text-cyan-500' },
    { label: 'Etapas', value: data.stageChanges, icon: ArrowRightLeft, color: 'text-amber-500' },
    { label: 'Fechados', value: data.leadsClosed, icon: Trophy, color: 'text-yellow-500' },
    { label: 'Contatos', value: data.contactsCreated, icon: Users, color: 'text-teal-500' },
  ];

  // Goal items for detail view
  const goalItems = [
    { label: 'Respostas', current: data.commentReplies, target: goals.target_replies },
    { label: 'DMs', current: data.dmsSent, target: goals.target_dms },
    { label: 'Leads', current: data.leadsCreated, target: goals.target_leads },
    { label: 'Tempo', current: data.sessionMinutes, target: goals.target_session_minutes, suffix: 'min' },
  ];

  const progressColor = goalProgress >= 100 ? 'text-green-500' : goalProgress >= 50 ? 'text-amber-500' : 'text-red-500';

  return (
    <div className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {/* Compact bar - always visible */}
      <div className="flex items-center gap-3 px-4 py-2">
        {/* User & goal progress */}
        <div className="flex items-center gap-2 min-w-0">
          <Trophy className="h-4 w-4 text-primary flex-shrink-0" />
          <span className="text-sm font-medium truncate">{firstName}</span>
          <Badge variant="outline" className={`text-xs font-bold ${progressColor} flex-shrink-0`}>
            {goalProgress}%
          </Badge>
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
            <div key={m.label} className="flex items-center gap-1 flex-shrink-0">
              <m.icon className={`h-3.5 w-3.5 ${m.color}`} />
              <span className="text-sm font-semibold">{m.value}</span>
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
          {data.totalActions} pts
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
          <div className="grid grid-cols-2 gap-4 mt-3">
            {/* All metrics */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Métricas de Hoje</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {METRICS.map(m => {
                  const value = data[m.key as keyof typeof data] as number;
                  return (
                    <div key={m.key} className="flex items-center gap-1.5 p-1.5 rounded-md bg-muted/50">
                      <m.icon className={`h-3.5 w-3.5 ${m.color} flex-shrink-0`} />
                      <div className="min-w-0">
                        <p className="text-sm font-bold leading-none">{value}</p>
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
                Meta Diária — <span className={progressColor}>{goalProgress}%</span>
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
          </div>
        </div>
      )}
    </div>
  );
}
