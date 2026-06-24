import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarIcon, RefreshCw, Trophy, Users, User as UserIcon, ChevronUp, ChevronDown, Percent, XCircle, Clock, Filter } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useFocusDashboardData, FocusPeriod } from '@/hooks/useFocusDashboardData';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserTeams } from '@/hooks/useUserTeams';
import { usePageState } from '@/hooks/usePageState';
import { ClosedLeadsSheet } from './ClosedLeadsSheet';
import { cn } from '@/lib/utils';

interface FocusDashboardProps {
  onOpenMissingDocs?: () => void;
  onOpenZapsignPending?: () => void;
  onOpenUnanswered?: () => void;
  /** Callback usado pelo sheet de Fechados pra abrir a conversa de um lead. */
  onOpenChat?: (phone: string) => void;
  compact?: boolean;
  /** Lista de usuários (acolhedores) disponíveis para o seletor próprio dos KPIs. */
  users?: { id: string; full_name: string }[];
}

const PERIOD_OPTIONS: { key: FocusPeriod; label: string }[] = [
  { key: 'yesterday', label: 'Ontem' },
  { key: 'today', label: 'Hoje' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mês' },
  { key: 'year', label: 'Ano' },
];

export function FocusDashboard({ onOpenMissingDocs, onOpenZapsignPending, onOpenUnanswered, onOpenChat, compact = false, users = [] }: FocusDashboardProps) {
  const { user } = useAuthContext();
  const { teams } = useUserTeams();
  // Filtro de ACOLHEDOR EXCLUSIVO dos KPIs (não afeta a lista de conversas).
  // 'all' = sem filtro; senão, o user_id escolhido.
  const [kpiAcolhedorId, setKpiAcolhedorId] = usePageState<string>('focus_dashboard_kpi_acolhedor', 'all');
  const data = useFocusDashboardData(kpiAcolhedorId === 'all' ? null : kpiAcolhedorId);

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
        onRefresh={data.refetch}
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

          {data.period !== 'custom' && (
            <span className="text-[11px] text-muted-foreground self-center shrink-0">
              {format(data.range.from, 'dd/MM')} — {format(data.range.to, 'dd/MM')}
            </span>
          )}

          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant={data.period === 'custom' ? 'default' : 'outline'}
                size="sm"
                className="h-10 text-[11px] gap-1.5 shrink-0 self-center"
              >
                <CalendarIcon className="h-3.5 w-3.5" />
                {data.period === 'custom'
                  ? `${format(data.range.from, 'dd/MM')} — ${format(data.range.to, 'dd/MM')}`
                  : 'Personalizado'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
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

          {users.length > 0 && (
            <Select value={kpiAcolhedorId} onValueChange={setKpiAcolhedorId}>
              <SelectTrigger className="h-10 text-[11px] w-[160px] shrink-0 self-center gap-1">
                <Filter className="h-3 w-3 opacity-60" />
                <SelectValue placeholder="Acolhedor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos acolhedores</SelectItem>
                {users.map(u => (
                  <SelectItem key={u.id} value={u.id} className="text-xs">
                    {u.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}




          {kpiCards.map((k) => {
            const Icon = k.icon;
            return (
              <div key={k.label} className="inline-flex items-stretch gap-1 shrink-0">
                <button
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
              </div>
            );
          })}


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

            {data.period !== 'custom' && (
              <span className="text-[11px] text-muted-foreground self-center shrink-0">
                {format(data.range.from, 'dd/MM')} — {format(data.range.to, 'dd/MM')}
              </span>
            )}

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

          </>
        )}
      </div>
    </Card>
  );
}
