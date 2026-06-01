import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarIcon, RefreshCw, Trophy, Users, User as UserIcon, FileText, PenTool, MessageCircleOff, Flame, ChevronUp, ChevronDown, Percent, XCircle, TrendingUp, Clock, Filter, AlertTriangle, MessageCircle, ExternalLink, Phone, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useFocusDashboardData, FocusPeriod } from '@/hooks/useFocusDashboardData';
import { useBpcFormLeads } from '@/hooks/useBpcFormLeads';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserTeams } from '@/hooks/useUserTeams';
import { usePageState } from '@/hooks/usePageState';
import { KpiCard } from './KpiCard';
import { FocusActionCard } from './FocusActionCard';
import { CompactRankingCard } from './CompactRankingCard';
import { ClosedPodiumCard } from './ClosedPodiumCard';
import { ClosedLeadsSheet } from './ClosedLeadsSheet';
import { BpcFormLeadsSheet } from './BpcFormLeadsSheet';
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
  const [bpcSheetOpen, setBpcSheetOpen] = useState(false);
  const [bpcDefaultTab, setBpcDefaultTab] = useState<'all' | 'to_call' | 'on_wa' | 'unviable'>('all');

  // Leads do formulário Meta (Google Sheet) — independente do token Meta.
  // Quando há filtro de instância, só as abas do operador correspondente são lidas.
  const bpc = useBpcFormLeads({
    from: data.range.from,
    to: data.range.to,
    instanceName: kpiInstanceName === 'all' ? null : kpiInstanceName,
  });

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
        // ⚠️ Card "Viáveis" lê da planilha oficial do Meta (Google Sheets),
        // não depende do token Meta. Mostra total de leads do form / quantos foram marcados inviáveis.
        label: 'Viáveis',
        value: `${bpc.metrics.total}/${bpc.metrics.unviable}`,
        sub: bpc.loading ? 'sincronizando…' : 'total / inviável',
        icon: CheckCircle2,
        tone: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200/60 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-300',
        onClick: () => { setBpcDefaultTab('all'); setBpcSheetOpen(true); },
      },
      {
        // 🔥 Card "Ligar Agora" — leads que preencheram o form Meta mas NÃO mandaram WhatsApp ainda.
        // Esses precisam de ligação imediata.
        label: 'Ligar agora',
        value: bpc.metrics.toCallNow,
        sub: bpc.metrics.toCallNow > 0 ? 'preencheu e sumiu' : 'tudo respondido',
        icon: Phone,
        tone: bpc.metrics.toCallNow > 0
          ? 'bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 animate-pulse'
          : 'bg-muted/40 border-border text-muted-foreground',
        onClick: () => { setBpcDefaultTab('to_call'); setBpcSheetOpen(true); },
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
      <BpcFormLeadsSheet
        open={bpcSheetOpen}
        onOpenChange={setBpcSheetOpen}
        metrics={bpc.metrics}
        leads={bpc.leads}
        loading={bpc.loading}
        defaultTab={bpcDefaultTab}
        onOpenChat={(phone) => onOpenChat?.(phone)}
        onRefresh={bpc.refetch}
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
                {k.label === 'Fechados' && (
                  <ClosedPodiumCard closedLeads={data.closedLeads} onClick={() => setClosedSheetOpen(true)} />
                )}
                {k.label === 'Viáveis' && bpc.byOperator.length > 0 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="flex flex-col items-start justify-center gap-0.5 px-2 py-1.5 rounded-md border border-emerald-200/60 dark:border-emerald-900/40 bg-emerald-50/50 dark:bg-emerald-950/20 hover:brightness-95 cursor-pointer min-w-[64px]"
                        title="Leads por instância (planilha Meta)"
                      >
                        <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70 text-emerald-700 dark:text-emerald-300">
                          Por inst.
                        </span>
                        <div className="flex gap-1 items-baseline">
                          {bpc.byOperator
                            .filter((o) => o.total > 0)
                            .slice(0, 3)
                            .map((o) => (
                              <span key={o.operator} className="text-[10px] tabular-nums text-emerald-700 dark:text-emerald-300">
                                <span className="opacity-60">{o.operator.slice(0, 3)}</span>
                                <span className="font-bold ml-0.5">{o.total}</span>
                              </span>
                            ))}
                          {bpc.byOperator.filter((o) => o.total > 0).length === 0 && (
                            <span className="text-[10px] opacity-60">—</span>
                          )}
                        </div>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-64 p-2">
                      <div className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        Leads por instância
                      </div>
                      <div className="space-y-1">
                        {bpc.byOperator
                          .sort((a, b) => b.total - a.total)
                          .map((o) => (
                            <div
                              key={o.operator}
                              className="flex items-center justify-between text-[11px] px-2 py-1 rounded hover:bg-muted/50"
                            >
                              <span className="font-medium truncate">{o.operator}</span>
                              <div className="flex items-center gap-2 shrink-0 tabular-nums">
                                <span className="text-emerald-700 dark:text-emerald-400 font-bold">{o.total}</span>
                                {o.unviable > 0 && (
                                  <span className="text-amber-600 text-[10px]" title="Inviáveis">⚠️{o.unviable}</span>
                                )}
                                {o.toCallNow > 0 && (
                                  <span className="text-red-600 text-[10px]" title="Ligar agora">📞{o.toCallNow}</span>
                                )}
                              </div>
                            </div>
                          ))}
                        {bpc.byOperator.every((o) => o.total === 0) && (
                          <div className="text-[11px] text-muted-foreground text-center py-2">
                            Sem leads no período.
                          </div>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            );
          })}

          {/* Card: Atividades atrasadas (popover com agrupamento por responsável) */}
          {(() => {
            const overdue = data.overdueActivities || [];
            const byOwner = new Map<string, typeof overdue>();
            overdue.forEach((a) => {
              const k = a.acolhedor || 'Sem responsável';
              const arr = byOwner.get(k) || [];
              arr.push(a);
              byOwner.set(k, arr);
            });
            const owners = Array.from(byOwner.entries()).sort((a, b) => b[1].length - a[1].length);
            const total = overdue.length;
            const tone = total > 0
              ? 'bg-red-50 dark:bg-red-950/30 border-red-200/60 dark:border-red-900/40 text-red-700 dark:text-red-300'
              : 'bg-muted/40 border-border text-muted-foreground';
            return (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'flex flex-col items-start justify-center gap-0.5 px-2.5 py-1.5 rounded-md border min-w-[78px] transition-colors',
                      tone,
                      'hover:brightness-95 cursor-pointer'
                    )}
                  >
                    <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide opacity-80">
                      <AlertTriangle className="h-3 w-3" />
                      Atrasadas
                    </span>
                    <span className="text-base font-bold tabular-nums leading-none">{total}</span>
                    <span className="text-[10px] opacity-70 leading-none">
                      {total === 0 ? 'tudo em dia' : `${owners.length} responsável(is)`}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 p-2 max-h-[70vh] overflow-y-auto">
                  <div className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
                    Atividades atrasadas · {total}
                  </div>
                  {total === 0 ? (
                    <div className="text-xs text-muted-foreground py-3 text-center">Nenhuma atividade atrasada.</div>
                  ) : (
                    <div className="space-y-3">
                      {owners.map(([owner, items]) => (
                        <div key={owner}>
                          <div className="text-[11px] font-semibold text-foreground mb-1 flex items-center justify-between">
                            <span className="truncate" title={owner}>{owner}</span>
                            <span className="text-red-600 tabular-nums shrink-0 ml-2">{items.length}</span>
                          </div>
                          <div className="space-y-1">
                            {items.slice(0, 8).map((a) => {
                              const chatTarget = a.whatsapp_group_jid || a.lead_phone;
                              return (
                                <div
                                  key={a.id}
                                  className="text-[11px] px-2 py-1.5 rounded border border-red-500/30 bg-red-500/5 flex items-center gap-1.5"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="font-medium truncate" title={a.lead_name || ''}>
                                      {a.lead_name || 'Sem nome'}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground truncate" title={a.title || ''}>
                                      {a.title || 'Sem título'}
                                      {a.deadline && ` · ${format(new Date(a.deadline + 'T00:00:00'), 'dd/MM', { locale: ptBR })}`}
                                    </div>
                                  </div>
                                  {chatTarget && onOpenChat && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 w-6 p-0 shrink-0"
                                      title="Abrir conversa"
                                      onClick={() => onOpenChat(chatTarget)}
                                    >
                                      <MessageCircle className="h-3 w-3" />
                                    </Button>
                                  )}
                                </div>
                              );
                            })}
                            {items.length > 8 && (
                              <div className="text-[10px] text-muted-foreground text-center pt-0.5">
                                + {items.length - 8} mais…
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            );
          })()}

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
