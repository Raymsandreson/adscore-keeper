import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CalendarIcon, RefreshCw, Trophy, Users, User as UserIcon, FileText, PenTool, MessageCircleOff, Flame, ChevronUp, ChevronDown, Percent, XCircle, TrendingUp, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useFocusDashboardData, FocusPeriod } from '@/hooks/useFocusDashboardData';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserTeams } from '@/hooks/useUserTeams';
import { KpiCard } from './KpiCard';
import { FocusActionCard } from './FocusActionCard';
import { cn } from '@/lib/utils';

interface FocusDashboardProps {
  onOpenMissingDocs?: () => void;
  onOpenZapsignPending?: () => void;
  onOpenUnanswered?: () => void;
}

const PERIOD_OPTIONS: { key: FocusPeriod; label: string }[] = [
  { key: 'yesterday', label: 'Ontem' },
  { key: 'today', label: 'Hoje' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mês' },
  { key: 'year', label: 'Ano' },
];

export function FocusDashboard({ onOpenMissingDocs, onOpenZapsignPending, onOpenUnanswered }: FocusDashboardProps) {
  const { user } = useAuthContext();
  const { teams } = useUserTeams();
  const data = useFocusDashboardData();
  const [collapsed, setCollapsed] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const initials = useMemo(() => {
    const name = (user?.user_metadata as any)?.full_name || user?.email || '?';
    return String(name).split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase().slice(0, 2);
  }, [user]);

  const displayName = useMemo(() => {
    const name = (user?.user_metadata as any)?.full_name || user?.email?.split('@')[0] || 'Você';
    if (data.scope === 'team') {
      const teamName = teams[0]?.name;
      return teamName ? `${teamName} · visão do time` : 'Equipe · visão do time';
    }
    return `${name} · visão pessoal`;
  }, [user, data.scope, teams]);

  return (
    <Card className="rounded-none border-x-0 border-t-0 bg-card shrink-0">
      <div className="px-3 md:px-4 py-2.5 flex flex-col gap-2.5">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            <Avatar className="h-9 w-9 ring-2 ring-primary/20">
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{displayName}</div>
              <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {data.loading ? 'Atualizando…' : `Atualizado ${format(new Date(), 'HH:mm', { locale: ptBR })}`}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {teams.length > 0 && (
              <Tabs value={data.scope} onValueChange={(v) => data.setScope(v as any)}>
                <TabsList className="h-8">
                  <TabsTrigger value="personal" className="text-xs h-7 gap-1"><UserIcon className="h-3 w-3" />Pessoal</TabsTrigger>
                  <TabsTrigger value="team" className="text-xs h-7 gap-1"><Users className="h-3 w-3" />Equipe</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
            <ToggleGroup
              type="single"
              value={data.period}
              onValueChange={(v) => { if (v) data.setPeriod(v as FocusPeriod); }}
              className="border rounded-md"
            >
              {PERIOD_OPTIONS.map(p => (
                <ToggleGroupItem key={p.key} value={p.key} className="text-[11px] h-8 px-2.5">{p.label}</ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant={data.period === 'custom' ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 text-[11px] gap-1.5"
                >
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {data.period === 'custom'
                    ? `${format(data.range.from, 'dd/MM')} — ${format(data.range.to, 'dd/MM')}`
                    : 'Personalizado'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="range"
                  selected={{ from: data.range.from, to: data.range.to }}
                  onSelect={(r) => {
                    if (r?.from && r?.to) {
                      data.setRange({ from: r.from, to: r.to });
                      setDatePickerOpen(false);
                    }
                  }}
                  numberOfMonths={2}
                  locale={ptBR}
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={data.refetch} disabled={data.loading}>
              <RefreshCw className={cn('h-3.5 w-3.5', data.loading && 'animate-spin')} />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Expandir' : 'Colapsar'}>
              {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        {!collapsed && (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <KpiCard
                tone="blue"
                icon={<UserIcon className="h-3.5 w-3.5" />}
                label="Leads"
                value={data.kpis.leadsReceived}
                unit="recebidos"
                hint={data.kpis.leadsReceivedDelta !== '—' && (
                  <span className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 font-medium">
                    <TrendingUp className="h-3 w-3" />{data.kpis.leadsReceivedDelta}
                  </span>
                )}
              />
              <KpiCard
                tone="green"
                icon={<Trophy className="h-3.5 w-3.5" />}
                label="Fechados"
                value={data.kpis.closed}
                unit={`/ ${data.kpis.goal}`}
                progress={data.kpis.goalProgress}
                hint={`Meta ${data.kpis.goal}`}
              />
              <KpiCard
                tone="purple"
                icon={<Percent className="h-3.5 w-3.5" />}
                label="Conversão"
                value={`${data.kpis.conversion}%`}
                hint={
                  <>
                    {data.kpis.closed} de {data.kpis.leadsReceived}
                    {data.kpis.conversionDelta !== '—' && (
                      <span className="ml-1 text-violet-600 dark:text-violet-400 font-medium">↗ {data.kpis.conversionDelta}</span>
                    )}
                  </>
                }
              />
              <KpiCard
                tone="amber"
                icon={<XCircle className="h-3.5 w-3.5" />}
                label="Inviáveis"
                value={data.kpis.unviable}
                unit="descartados"
                hint={data.kpis.unviableTopReason ? `Top: ${data.kpis.unviableTopReason}` : '—'}
              />
            </div>

            {/* FOCO AGORA */}
            <div className="flex items-center justify-between mt-1">
              <div className="flex items-center gap-1.5 text-xs font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wide">
                <Flame className="h-3.5 w-3.5" />
                Foco agora
              </div>
              <span className="text-[10px] text-muted-foreground">não muda com o período</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <FocusActionCard
                icon={<FileText className="h-3.5 w-3.5 text-orange-700 dark:text-orange-400" />}
                title="Faltam documentos"
                badge={data.actions.missingDocs > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-600 text-white font-bold flex items-center gap-1">
                    <Flame className="h-3 w-3" /> QUENTE
                  </span>
                )}
                value={data.actions.missingDocs}
                unit="leads prontos pra fechar"
                hint={data.actions.missingDocsHint}
                ctaLabel="Cobrar documentos"
                ctaTone="orange"
                onClick={onOpenMissingDocs}
              />
              <FocusActionCard
                icon={<PenTool className="h-3.5 w-3.5 text-stone-700 dark:text-amber-400" />}
                title="Pendentes de assinatura"
                value={data.actions.zapsignPending}
                unit="no ZapSign"
                hint={data.actions.zapsignPendingHint}
                ctaLabel="Reenviar / cobrar"
                ctaTone="olive"
                onClick={onOpenZapsignPending}
              />
              <FocusActionCard
                icon={<MessageCircleOff className="h-3.5 w-3.5 text-rose-700 dark:text-rose-400" />}
                title="Sem resposta"
                badge={<span className="text-[10px] text-muted-foreground">+30min</span>}
                value={data.actions.unansweredOwedByMe}
                unit="aguardando você"
                hint={
                  <span className="text-[10px]">
                    +30min <b>{data.actions.unansweredBuckets.plus30}</b> · +4h <b>{data.actions.unansweredBuckets.plus4h}</b> · +24h <b>{data.actions.unansweredBuckets.plus24h}</b>
                  </span>
                }
                extra={
                  <div className="flex gap-1 -mt-1">
                    <div className="flex-1 text-center text-[10px] py-1 px-1.5 rounded bg-rose-700 text-white font-medium">
                      Eu devo ({data.actions.unansweredOwedByMe})
                    </div>
                    <div className="flex-1 text-center text-[10px] py-1 px-1.5 rounded bg-background border font-medium">
                      Cliente sumiu ({data.actions.unansweredClientGhosted})
                    </div>
                  </div>
                }
                ctaLabel="Responder agora"
                ctaTone="red"
                onClick={onOpenUnanswered}
              />
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
