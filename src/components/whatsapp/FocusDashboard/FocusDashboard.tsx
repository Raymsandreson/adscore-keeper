import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarIcon, RefreshCw, Trophy, Users, User as UserIcon, FileText, PenTool, MessageCircleOff, Flame, ChevronUp, ChevronDown, Percent, XCircle, TrendingUp, Clock, Filter, AlertTriangle, MessageCircle, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useFocusDashboardData, FocusPeriod } from '@/hooks/useFocusDashboardData';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserTeams } from '@/hooks/useUserTeams';
import { usePageState } from '@/hooks/usePageState';
import { KpiCard } from './KpiCard';
import { FocusActionCard } from './FocusActionCard';
import { CompactRankingCard } from './CompactRankingCard';
import { ClosedLeadsSheet } from './ClosedLeadsSheet';
import { cn } from '@/lib/utils';

interface FocusDashboardProps {
  onOpenMissingDocs?: () => void;
  onOpenZapsignPending?: () => void;
  onOpenUnanswered?: () => void;
  /** Callback usado pelo sheet de Fechados pra abrir a conversa de um lead. */
  onOpenChat?: (phone: string) => void;
  compact?: boolean;
  /** Lista de instâncias disponíveis para o seletor próprio dos KPIs. */
  instances?: { id: string; instance_name: string }[];
}

const PERIOD_OPTIONS: { key: FocusPeriod; label: string }[] = [
  { key: 'yesterday', label: 'Ontem' },
  { key: 'today', label: 'Hoje' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mês' },
  { key: 'year', label: 'Ano' },
];

export function FocusDashboard({ onOpenMissingDocs, onOpenZapsignPending, onOpenUnanswered, onOpenChat, compact = false, instances = [] }: FocusDashboardProps) {
  const { user } = useAuthContext();
  const { teams } = useUserTeams();
  // Filtro de instância EXCLUSIVO dos KPIs (não afeta a lista de conversas).
  // 'all' = sem filtro; senão, o instance_name escolhido.
  const [kpiInstanceName, setKpiInstanceName] = usePageState<string>('focus_dashboard_kpi_instance', 'all');
  const data = useFocusDashboardData(kpiInstanceName === 'all' ? null : kpiInstanceName);
  const [collapsed, setCollapsed] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [closedSheetOpen, setClosedSheetOpen] = useState(false);

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

  if (compact) {
    const dispatchFilter = (filter: string) => {
      window.dispatchEvent(new CustomEvent('wa:set-quick-filter', { detail: { filter } }));
    };
    const kpiCards = [
      {
        label: 'Fechados',
        value: `${data.kpis.closed}/${data.kpis.goal} (${data.kpis.conversion}%)`,
        sub: `${data.kpis.goal} viáveis de ${data.kpis.leadsReceived}`,
        icon: Trophy,
        tone: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200/60 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-300',
        onClick: () => setClosedSheetOpen(true),
      },
      {
        label: 'Inviáveis',
        value: `${data.kpis.unviable} (${data.kpis.unviablePercentage}%)`,
        sub: data.kpis.unviableTopReason ? `Principal: ${data.kpis.unviableTopReason}` : undefined,
        icon: XCircle,
        tone: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200/60 dark:border-amber-900/40 text-amber-700 dark:text-amber-300',
        onClick: () => dispatchFilter('lead_inviavel'),
      },
      { label: 'Docs', value: data.actions.missingDocs, icon: FileText, tone: 'bg-orange-50 dark:bg-orange-950/30 border-orange-200/60 dark:border-orange-900/40 text-orange-700 dark:text-orange-300', onClick: onOpenMissingDocs },
      { label: 'Assinatura', value: data.actions.zapsignPending, icon: PenTool, tone: 'bg-stone-100 dark:bg-stone-900/40 border-stone-300/60 dark:border-stone-700/40 text-stone-700 dark:text-stone-300', onClick: onOpenZapsignPending },
      {
        label: 'Sem resp.',
        value: `${data.actions.unansweredOwedByMe}/${data.actions.unansweredClientGhosted}`,
        sub: data.actions.avgResponseMinutes > 0
          ? `eu/cliente · ⌀ ${data.actions.avgResponseMinutes < 60 ? `${data.actions.avgResponseMinutes}min` : `${(data.actions.avgResponseMinutes / 60).toFixed(1)}h`}`
          : 'eu / cliente',
        icon: MessageCircleOff,
        tone: 'bg-rose-50 dark:bg-rose-950/30 border-rose-200/60 dark:border-rose-900/40 text-rose-700 dark:text-rose-300',
        onClick: onOpenUnanswered,
      },
    ];

    const periodLabel = PERIOD_OPTIONS.find(p => p.key === data.period)?.label || 'Período';

    return (
      <>
      <ClosedLeadsSheet
        open={closedSheetOpen}
        onOpenChange={setClosedSheetOpen}
        closedLeads={data.closedLeads}
        periodLabel={periodLabel}
        onOpenChat={(phone) => onOpenChat?.(phone)}
      />
      <Card className="rounded-none border-x-0 border-t-0 bg-card shrink-0">
        <div className="px-2 py-2 flex items-stretch gap-2 flex-wrap">
          <ToggleGroup
            type="single"
            value={data.period}
            onValueChange={(v) => { if (v) data.setPeriod(v as FocusPeriod); }}
            className="border rounded shrink-0 self-center"
          >
            {PERIOD_OPTIONS.map(p => (
              <ToggleGroupItem key={p.key} value={p.key} className="text-[11px] h-10 px-2">{p.label}</ToggleGroupItem>
            ))}
          </ToggleGroup>

          {instances.length > 0 && (
            <Select value={kpiInstanceName} onValueChange={setKpiInstanceName}>
              <SelectTrigger className="h-10 text-[11px] w-[140px] shrink-0 self-center gap-1">
                <Filter className="h-3 w-3 opacity-60" />
                <SelectValue placeholder="Instância" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todas instâncias</SelectItem>
                {instances.map(inst => (
                  <SelectItem key={inst.id} value={inst.instance_name} className="text-xs">
                    {inst.instance_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}



          {kpiCards.map((k) => {
            const Icon = k.icon;
            return (
              <button
                key={k.label}
                type="button"
                onClick={k.onClick}
                className={cn(
                  'flex flex-col items-start justify-center gap-0.5 px-2.5 py-1.5 rounded-md border min-w-[78px] transition-colors',
                  k.tone,
                  k.onClick && 'hover:brightness-95 cursor-pointer',
                  !k.onClick && 'cursor-default'
                )}
              >
              <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide opacity-80">
                <Icon className="h-3 w-3" />
                {k.label}
              </span>
              <span className="text-base font-bold tabular-nums leading-none">{k.value}</span>
              {k.sub && (
                <span className="text-[10px] opacity-70 leading-none">{k.sub}</span>
              )}
              </button>
            );
          })}

          <CompactRankingCard />

          <div className="flex-1" />
          <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 self-center" onClick={data.refetch} disabled={data.loading}>
            <RefreshCw className={cn('h-4 w-4', data.loading && 'animate-spin')} />
          </Button>
        </div>
      </Card>
      </>
    );
  }


  return (
    <Card className="rounded-none border-x-0 border-t-0 bg-card shrink-0">
      <div className="px-3 md:px-4 py-1.5 flex flex-col gap-1.5">
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
            {/* Linha única ultra-compacta: Leads + Fechados + Conversão + Inviáveis */}
            <Card className="px-2 py-1 border-0 bg-gradient-to-r from-blue-50 via-emerald-50 to-amber-50 dark:from-blue-950/30 dark:via-emerald-950/30 dark:to-amber-950/30">
              <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px]">
                <div className="flex items-center gap-1">
                  <UserIcon className="h-3 w-3 text-blue-700 dark:text-blue-300" />
                  <span className="font-semibold text-blue-700 dark:text-blue-300">Leads</span>
                  <span className="font-bold tabular-nums text-blue-700 dark:text-blue-300">{data.kpis.leadsReceived}</span>
                </div>
                <span className="h-3 w-px bg-border/60" />
                <div className="flex items-center gap-1">
                  <Trophy className="h-3 w-3 text-emerald-700 dark:text-emerald-300" />
                  <span className="font-semibold text-emerald-700 dark:text-emerald-300">Fechados</span>
                  <span className="font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{data.kpis.closed}/{data.kpis.goal}</span>
                </div>
                <span className="h-3 w-px bg-border/60" />
                <div className="flex items-center gap-1">
                  <Percent className="h-3 w-3 text-violet-700 dark:text-violet-300" />
                  <span className="font-semibold text-violet-700 dark:text-violet-300">Conv.</span>
                  <span className="font-bold tabular-nums text-violet-700 dark:text-violet-300">{data.kpis.conversion}%</span>
                </div>
                <span className="h-3 w-px bg-border/60" />
                <div className="flex items-center gap-1 min-w-0">
                  <XCircle className="h-3 w-3 text-amber-700 dark:text-amber-300" />
                  <span className="font-semibold text-amber-700 dark:text-amber-300">Inviáveis</span>
                  <span className="font-bold tabular-nums text-amber-700 dark:text-amber-300">{data.kpis.unviable}</span>
                  {data.kpis.unviableTopReason && (
                    <span className="text-[10px] text-muted-foreground truncate">· {data.kpis.unviableTopReason}</span>
                  )}
                </div>
              </div>
            </Card>

            {/* FOCO AGORA */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wide">
                <Flame className="h-3 w-3" />
                Foco agora
              </div>
              <span className="text-[10px] text-muted-foreground">não muda com o período</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
              {/* Card combinado: Faltam documentos + Pendentes assinatura */}
              <Card className="px-2 py-1.5 border bg-orange-50/60 dark:bg-orange-950/20 border-orange-200/60 dark:border-orange-900/40">
                <div className="grid grid-cols-2 gap-2 divide-x divide-border/40">
                  {/* Faltam documentos */}
                  <div className="pr-2 flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1 text-[11px] font-semibold text-orange-800 dark:text-orange-300">
                        <FileText className="h-3 w-3" /> Faltam docs
                      </div>
                      {data.actions.missingDocs > 0 && (
                        <span className="text-[9px] px-1 py-0 rounded-full bg-orange-600 text-white font-bold flex items-center gap-0.5">
                          <Flame className="h-2.5 w-2.5" /> QUENTE
                        </span>
                      )}
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-lg font-bold tabular-nums leading-none text-orange-800 dark:text-orange-200">{data.actions.missingDocs}</span>
                      <span className="text-[10px] text-muted-foreground truncate">prontos pra fechar</span>
                    </div>
                    <button
                      type="button"
                      onClick={onOpenMissingDocs}
                      className="w-full h-6 text-[10px] rounded bg-orange-600 hover:bg-orange-700 text-white font-medium transition-colors"
                    >
                      Cobrar docs →
                    </button>
                  </div>
                  {/* Pendentes assinatura */}
                  <div className="pl-2 flex flex-col gap-1">
                    <div className="flex items-center gap-1 text-[11px] font-semibold text-stone-800 dark:text-amber-300">
                      <PenTool className="h-3 w-3" /> Pendentes assinatura
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-lg font-bold tabular-nums leading-none text-stone-800 dark:text-amber-200">{data.actions.zapsignPending}</span>
                      <span className="text-[10px] text-muted-foreground truncate">no ZapSign</span>
                    </div>
                    <button
                      type="button"
                      onClick={onOpenZapsignPending}
                      className="w-full h-6 text-[10px] rounded bg-stone-700 hover:bg-stone-800 text-white font-medium transition-colors"
                    >
                      Reenviar / cobrar →
                    </button>
                  </div>
                </div>
              </Card>

              {/* Sem resposta - compacto */}
              <Card className="px-2 py-1.5 border bg-rose-50/60 dark:bg-rose-950/20 border-rose-200/60 dark:border-rose-900/40 flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 text-[11px] font-semibold text-rose-800 dark:text-rose-300">
                    <MessageCircleOff className="h-3 w-3" /> Sem resposta
                  </div>
                  <span className="text-[10px] text-muted-foreground">+30min</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-bold tabular-nums leading-none text-rose-800 dark:text-rose-200">{data.actions.unansweredOwedByMe}</span>
                  <span className="text-[10px] text-muted-foreground">aguardando você</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    +30 <b>{data.actions.unansweredBuckets.plus30}</b> · +4h <b>{data.actions.unansweredBuckets.plus4h}</b> · +24h <b>{data.actions.unansweredBuckets.plus24h}</b>
                  </span>
                </div>
                <div className="flex gap-1">
                  <div className="flex-1 text-center text-[10px] py-0.5 rounded bg-rose-700 text-white font-medium">
                    Eu devo ({data.actions.unansweredOwedByMe})
                  </div>
                  <div className="flex-1 text-center text-[10px] py-0.5 rounded bg-background border font-medium">
                    Cliente sumiu ({data.actions.unansweredClientGhosted})
                  </div>
                  <button
                    type="button"
                    onClick={onOpenUnanswered}
                    className="px-2 text-[10px] rounded bg-rose-600 hover:bg-rose-700 text-white font-medium"
                  >
                    Responder →
                  </button>
                </div>
              </Card>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
