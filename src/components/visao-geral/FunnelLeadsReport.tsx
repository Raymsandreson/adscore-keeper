import { useCallback, useEffect, useMemo, useState } from "react";
import { db, authClient } from "@/integrations/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  RefreshCw,
  AlertCircle,
  CalendarDays,
  ArrowRight,
  UserPlus,
  Repeat,
  ChevronRight,
  MessageCircle,
  Users,
} from "lucide-react";
import { useKanbanBoards, type KanbanBoard } from "@/hooks/useKanbanBoards";
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  startOfMonth,
  subDays,
  min as minDate,
  max as maxDate,
  format,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";

interface Props {
  /** Substring (case-insensitive) used to match the kanban board name. */
  boardMatcher: RegExp;
}

/**
 * Origens que contam como cadastro genuíno de caso trabalhista:
 *   - "Internet" → lead veio de Notícias e completou o fluxo "Cadastrar Caso Viável".
 *   - "manual"   → cadastrado diretamente na aba de Leads.
 * Excluímos "google_alerts" (itens brutos de notícia auto-importados) e demais
 * origens automáticas (whatsapp, referral, etc.).
 */
const CADASTRO_SOURCES = ["Internet", "manual"] as const;

const SOURCE_LABELS: Record<string, string> = {
  Internet: "Notícias",
  manual: "Manual",
};

/** Status especiais (desfechos) que não são colunas do funil. */
const STATUS_LABELS: Record<string, string> = {
  new: "Novo",
  active: "Ativo",
  open: "Aberto",
  in_progress: "Em andamento",
  no_response: "Sem resposta",
  closed: "Fechado",
  refused: "Recusado",
  inviavel: "Inviável",
  unviable: "Inviável",
  lost: "Perdido",
  not_interested: "Sem interesse",
  cancelled: "Cancelado",
};

const STATUS_COLORS: Record<string, string> = {
  new: "#3b82f6",
  active: "#3b82f6",
  open: "#3b82f6",
  in_progress: "#8b5cf6",
  no_response: "#64748b",
  closed: "#22c55e",
  refused: "#ef4444",
  inviavel: "#f59e0b",
  unviable: "#f59e0b",
  lost: "#ef4444",
  not_interested: "#ef4444",
  cancelled: "#a855f7",
};

const SEM_ACOLHEDOR = "— sem acolhedor —";

function humanize(id: string) {
  return id.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

interface LeadRow {
  id: string;
  lead_name: string | null;
  lead_phone: string | null;
  created_at: string;
  source: string | null;
  status: string | null;
  acolhedor: string | null;
}

interface Movement {
  id: string;
  lead_id: string;
  from_stage: string | null;
  to_stage: string;
  changed_at: string;
  changed_by: string | null;
  lead_name: string;
  acolhedor: string | null;
  source: string | null;
  changed_by_name: string;
}

type QuickPeriod = "today" | "week" | "month" | "custom";

const PERIOD_LABELS: Record<QuickPeriod, string> = {
  today: "Hoje",
  week: "Últimos 7 dias",
  month: "Últimos 30 dias",
  custom: "Personalizado",
};

type DrillState =
  | { title: string; kind: "lead"; leads: LeadRow[] }
  | { title: string; kind: "movement"; movements: Movement[] }
  | null;

export default function FunnelLeadsReport({ boardMatcher }: Props) {
  const { boards, loading: loadingBoards } = useKanbanBoards();

  const board = useMemo<KanbanBoard | null>(() => {
    const matches = boards.filter(
      (b) => b.board_type === "funnel" && boardMatcher.test(b.name),
    );
    return matches.find((b) => (b.stages || []).length > 0) || matches[0] || null;
  }, [boards, boardMatcher]);

  const [period, setPeriod] = useState<QuickPeriod>("week");
  const [range, setRange] = useState<DateRange | undefined>();

  // Filtros (aplicados client-side; não disparam refetch).
  const [fAcolhedor, setFAcolhedor] = useState<string>("todos");
  const [fOrigem, setFOrigem] = useState<string>("todas");

  // Dados brutos.
  const [allLeads, setAllLeads] = useState<LeadRow[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [drill, setDrill] = useState<DrillState>(null);

  const now = useMemo(() => {
    void reloadKey; // re-avalia "agora" ao clicar em atualizar
    return new Date();
  }, [reloadKey]);

  const anchors = useMemo(() => {
    const today = startOfDay(now);
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const monthStart = startOfMonth(now);
    return { today, weekStart, monthStart };
  }, [now]);

  const effectiveRange = useMemo<{ start: Date; end: Date } | null>(() => {
    switch (period) {
      case "today":
        return { start: startOfDay(now), end: endOfDay(now) };
      case "week":
        return { start: startOfDay(subDays(now, 6)), end: endOfDay(now) };
      case "month":
        return { start: startOfDay(subDays(now, 29)), end: endOfDay(now) };
      case "custom":
        if (range?.from) {
          return {
            start: startOfDay(range.from),
            end: endOfDay(range.to || range.from),
          };
        }
        return null;
    }
  }, [period, range, now]);

  const stageMap = useMemo(() => {
    const map: Record<string, { name: string; color: string }> = {};
    (board?.stages || []).forEach((s) => {
      map[s.id] = { name: s.name, color: s.color || "#6366f1" };
    });
    return map;
  }, [board]);

  const resolveName = useCallback(
    (id: string | null) => {
      if (!id) return "Novo";
      return stageMap[id]?.name || STATUS_LABELS[id] || humanize(id);
    },
    [stageMap],
  );
  const resolveColor = useCallback(
    (id: string | null) => {
      if (!id) return "#6b7280";
      return stageMap[id]?.color || STATUS_COLORS[id] || "#6b7280";
    },
    [stageMap],
  );

  // ---- Fetch de dados brutos (cadastros + movimentações) ----
  useEffect(() => {
    if (loadingBoards) return;
    if (!board) {
      setLoading(false);
      setError("Funil não encontrado na base. Verifique o nome em Funis de Vendas.");
      return;
    }
    if (!effectiveRange) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Janela de cadastros = cobre os cards fixos (hoje/semana/mês) e o intervalo.
        const fetchStart = minDate([
          anchors.monthStart,
          anchors.weekStart,
          effectiveRange.start,
        ]);
        const fetchEnd = maxDate([now, effectiveRange.end]);

        const { data: leadsData, error: leadsErr } = await db
          .from("leads")
          .select("id, lead_name, lead_phone, created_at, source, status, acolhedor")
          .eq("board_id", board.id)
          .in("source", CADASTRO_SOURCES as unknown as string[])
          .gte("created_at", fetchStart.toISOString())
          .lte("created_at", fetchEnd.toISOString())
          .order("created_at", { ascending: false });
        if (leadsErr) throw leadsErr;

        // Movimentações do board no intervalo.
        const { data: histData, error: histErr } = await db
          .from("lead_stage_history")
          .select("id, lead_id, from_stage, to_stage, changed_at, changed_by, from_board_id, to_board_id")
          .gte("changed_at", effectiveRange.start.toISOString())
          .lte("changed_at", effectiveRange.end.toISOString())
          .or(`to_board_id.eq.${board.id},from_board_id.eq.${board.id}`)
          .order("changed_at", { ascending: false });
        if (histErr) throw histErr;

        const hist = histData || [];

        // Enriquecer movimentações: lead (nome/acolhedor/source) e autor da marcação.
        const leadIds = [...new Set(hist.map((h) => h.lead_id).filter(Boolean))];
        const leadInfo: Record<
          string,
          { name: string; acolhedor: string | null; source: string | null }
        > = {};
        if (leadIds.length > 0) {
          const { data: ml } = await db
            .from("leads")
            .select("id, lead_name, acolhedor, source")
            .in("id", leadIds);
          type MlRow = {
            id: string;
            lead_name: string | null;
            acolhedor: string | null;
            source: string | null;
          };
          ((ml || []) as MlRow[]).forEach((l) => {
            leadInfo[l.id] = {
              name: l.lead_name || "Sem nome",
              acolhedor: l.acolhedor,
              source: l.source,
            };
          });
        }

        const userIds = [...new Set(hist.map((h) => h.changed_by).filter(Boolean))] as string[];
        const userNames: Record<string, string> = {};
        if (userIds.length > 0) {
          const { data: profs } = await authClient
            .from("profiles")
            .select("user_id, full_name, email")
            .in("user_id", userIds);
          type ProfRow = {
            user_id: string;
            full_name: string | null;
            email: string | null;
          };
          ((profs || []) as ProfRow[]).forEach((p) => {
            userNames[p.user_id] = p.full_name || p.email || "Usuário";
          });
        }

        const enriched: Movement[] = hist.map((h) => ({
          id: h.id,
          lead_id: h.lead_id,
          from_stage: h.from_stage,
          to_stage: h.to_stage,
          changed_at: h.changed_at,
          changed_by: h.changed_by,
          lead_name: leadInfo[h.lead_id]?.name || "Lead removido",
          acolhedor: leadInfo[h.lead_id]?.acolhedor ?? null,
          source: leadInfo[h.lead_id]?.source ?? null,
          changed_by_name: h.changed_by
            ? userNames[h.changed_by] || "Usuário"
            : "Sistema",
        }));

        if (cancelled) return;
        setAllLeads((leadsData || []) as LeadRow[]);
        setMovements(enriched);
      } catch (e) {
        if (cancelled) return;
        console.error("[FunnelLeadsReport]", e);
        setError(e instanceof Error ? e.message : "Falha ao carregar relatório");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [board, loadingBoards, effectiveRange, anchors, now, reloadKey]);

  // ---- Filtros ----
  const passLead = useCallback(
    (l: { acolhedor: string | null; source: string | null }) => {
      if (fAcolhedor !== "todos" && (l.acolhedor || SEM_ACOLHEDOR) !== fAcolhedor)
        return false;
      if (fOrigem !== "todas" && l.source !== fOrigem) return false;
      return true;
    },
    [fAcolhedor, fOrigem],
  );

  const acolhedorOptions = useMemo(() => {
    const set = new Set<string>();
    allLeads.forEach((l) => set.add(l.acolhedor || SEM_ACOLHEDOR));
    movements.forEach((m) => set.add(m.acolhedor || SEM_ACOLHEDOR));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [allLeads, movements]);

  const leadsFiltered = useMemo(
    () => allLeads.filter(passLead),
    [allLeads, passLead],
  );
  const movementsFiltered = useMemo(
    () => movements.filter(passLead),
    [movements, passLead],
  );

  const inWindow = useCallback(
    (l: LeadRow, start: Date, end: Date) => {
      const t = new Date(l.created_at).getTime();
      return t >= start.getTime() && t <= end.getTime();
    },
    [],
  );

  const quick = useMemo(() => {
    const count = (start: Date) =>
      leadsFiltered.filter((l) => inWindow(l, start, now)).length;
    return {
      today: count(anchors.today),
      week: count(anchors.weekStart),
      month: count(anchors.monthStart),
    };
  }, [leadsFiltered, anchors, now, inWindow]);

  const rangeLeads = useMemo(() => {
    if (!effectiveRange) return [];
    return leadsFiltered.filter((l) =>
      inWindow(l, effectiveRange.start, effectiveRange.end),
    );
  }, [leadsFiltered, effectiveRange, inWindow]);

  // Cadastros por acolhedor no período.
  const byAcolhedor = useMemo(() => {
    const acc: Record<string, number> = {};
    rangeLeads.forEach((l) => {
      const k = l.acolhedor || SEM_ACOLHEDOR;
      acc[k] = (acc[k] || 0) + 1;
    });
    return Object.entries(acc)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [rangeLeads]);

  // Transições agregadas.
  const transitions = useMemo(() => {
    const acc: Record<
      string,
      { from: string | null; to: string; items: Movement[] }
    > = {};
    movementsFiltered.forEach((m) => {
      const key = `${m.from_stage ?? "∅"}→${m.to_stage}`;
      if (!acc[key]) acc[key] = { from: m.from_stage, to: m.to_stage, items: [] };
      acc[key].items.push(m);
    });
    return Object.values(acc).sort((a, b) => b.items.length - a.items.length);
  }, [movementsFiltered]);

  const rangeLabel = useMemo(() => {
    if (!effectiveRange) return "Selecione um intervalo";
    const { start, end } = effectiveRange;
    const fmt = (d: Date) => format(d, "dd/MM/yyyy", { locale: ptBR });
    return fmt(start) === fmt(end) ? fmt(start) : `${fmt(start)} — ${fmt(end)}`;
  }, [effectiveRange]);

  const openLeadDrill = (leads: LeadRow[], title: string) =>
    setDrill({ kind: "lead", leads, title });
  const openMovDrill = (movs: Movement[], title: string) =>
    setDrill({ kind: "movement", movements: movs, title });

  if (loadingBoards) return <Skeleton className="h-64 rounded-lg" />;

  if (error && !board) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="p-6 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
          <div className="text-sm">{error}</div>
        </CardContent>
      </Card>
    );
  }

  const filtersActive = fAcolhedor !== "todos" || fOrigem !== "todas";

  return (
    <>
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" />
            Relatório de Leads
          </CardTitle>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Filtros */}
          <div className="flex flex-wrap items-center gap-2">
            <Select value={fAcolhedor} onValueChange={setFAcolhedor}>
              <SelectTrigger className="h-8 w-[190px] text-xs">
                <SelectValue placeholder="Acolhedor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos" className="text-xs">
                  Todos os acolhedores
                </SelectItem>
                {acolhedorOptions.map((a) => (
                  <SelectItem key={a} value={a} className="text-xs">
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={fOrigem} onValueChange={setFOrigem}>
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue placeholder="Origem" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas" className="text-xs">
                  Todas as origens
                </SelectItem>
                <SelectItem value="manual" className="text-xs">
                  Manual (aba)
                </SelectItem>
                <SelectItem value="Internet" className="text-xs">
                  Notícias
                </SelectItem>
              </SelectContent>
            </Select>
            {filtersActive && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs"
                onClick={() => {
                  setFAcolhedor("todos");
                  setFOrigem("todas");
                }}
              >
                Limpar
              </Button>
            )}
          </div>

          {/* Cadastros: dia / semana / mês (clicáveis) */}
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
              Leads cadastrados
            </div>
            <div className="grid grid-cols-3 gap-3">
              <ClickKpi
                label="Hoje"
                value={loading ? undefined : quick.today}
                onClick={() =>
                  openLeadDrill(
                    leadsFiltered.filter((l) => inWindow(l, anchors.today, now)),
                    "cadastrados hoje",
                  )
                }
              />
              <ClickKpi
                label="Esta semana"
                value={loading ? undefined : quick.week}
                onClick={() =>
                  openLeadDrill(
                    leadsFiltered.filter((l) => inWindow(l, anchors.weekStart, now)),
                    "cadastrados esta semana",
                  )
                }
              />
              <ClickKpi
                label="Este mês"
                value={loading ? undefined : quick.month}
                onClick={() =>
                  openLeadDrill(
                    leadsFiltered.filter((l) => inWindow(l, anchors.monthStart, now)),
                    "cadastrados este mês",
                  )
                }
              />
            </div>
          </div>

          {/* Seletor de período + calendário */}
          <div className="flex flex-wrap items-center gap-2">
            {(["today", "week", "month"] as QuickPeriod[]).map((p) => (
              <Button
                key={p}
                size="sm"
                variant={period === p ? "default" : "outline"}
                onClick={() => setPeriod(p)}
              >
                {PERIOD_LABELS[p]}
              </Button>
            ))}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant={period === "custom" ? "default" : "outline"}
                  className="gap-2"
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  {period === "custom" ? rangeLabel : "Intervalo"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  selected={range}
                  onSelect={(r) => {
                    setRange(r);
                    setPeriod("custom");
                  }}
                  numberOfMonths={2}
                  locale={ptBR}
                  disabled={{ after: new Date() }}
                />
              </PopoverContent>
            </Popover>
          </div>

          {error && board ? (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" /> {error}
            </div>
          ) : loading ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Skeleton className="h-20 rounded-lg" />
                <Skeleton className="h-20 rounded-lg" />
              </div>
              <Skeleton className="h-32 rounded-lg" />
            </div>
          ) : (
            <>
              {/* Resumo do período */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => openLeadDrill(rangeLeads, `cadastrados · ${rangeLabel}`)}
                  className="group text-left rounded-lg border p-4 hover:border-primary/40 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <UserPlus className="h-4 w-4" />
                    <span className="text-[11px] uppercase tracking-wide">
                      Cadastrados no período
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {rangeLeads.length}
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </button>
                <div className="rounded-lg border p-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Repeat className="h-4 w-4" />
                    <span className="text-[11px] uppercase tracking-wide">
                      Movimentações
                    </span>
                  </div>
                  <div className="text-2xl font-semibold tabular-nums">
                    {movementsFiltered.length}
                  </div>
                </div>
              </div>
              <div className="text-xs text-muted-foreground -mt-2">
                Período: {rangeLabel}
              </div>

              {/* Cadastros por acolhedor */}
              {byAcolhedor.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" /> Cadastros por acolhedor
                  </div>
                  <div className="space-y-1.5">
                    {byAcolhedor.map((a) => (
                      <button
                        key={a.name}
                        type="button"
                        onClick={() =>
                          openLeadDrill(
                            rangeLeads.filter(
                              (l) => (l.acolhedor || SEM_ACOLHEDOR) === a.name,
                            ),
                            `${a.name} · ${rangeLabel}`,
                          )
                        }
                        className="w-full group flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm hover:border-primary/40 hover:bg-muted/40 transition-colors"
                      >
                        <span className="truncate text-left">{a.name}</span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          <span className="font-semibold tabular-nums">{a.count}</span>
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Transições de → para (clicáveis) */}
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                  Movimentações etapa → etapa
                </div>
                <p className="text-[11px] text-muted-foreground mb-2 -mt-1">
                  Destinos como "Sem resposta", "Fechado" ou "Inviável" são desfechos do
                  lead, não colunas do funil.
                </p>
                {transitions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma movimentação no período selecionado.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                    {transitions.map((t) => (
                      <button
                        key={`${t.from ?? "∅"}-${t.to}`}
                        type="button"
                        onClick={() =>
                          openMovDrill(
                            t.items,
                            `${resolveName(t.from)} → ${resolveName(t.to)}`,
                          )
                        }
                        className="w-full group flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm hover:bg-muted transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <StageBadge label={resolveName(t.from)} color={resolveColor(t.from)} />
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <StageBadge label={resolveName(t.to)} color={resolveColor(t.to)} />
                        </div>
                        <span className="flex items-center gap-1.5 shrink-0">
                          <span className="font-semibold tabular-nums">
                            {t.items.length}
                          </span>
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <DrillSheet
        drill={drill}
        onClose={() => setDrill(null)}
        stageMap={stageMap}
        resolveName={resolveName}
        resolveColor={resolveColor}
      />
    </>
  );
}

function ClickKpi({
  label,
  value,
  onClick,
}: {
  label: string;
  value?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={value === undefined}
      className="group text-left rounded-lg border p-3 hover:border-primary/40 hover:bg-muted/40 transition-colors disabled:cursor-default disabled:hover:bg-transparent"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">
        {value === undefined ? <Skeleton className="h-7 w-10" /> : value}
      </div>
    </button>
  );
}

function StageBadge({ label, color }: { label: string; color: string }) {
  return (
    <Badge
      variant="outline"
      className="truncate max-w-[45%]"
      style={{ borderColor: color, color }}
    >
      {label}
    </Badge>
  );
}

function fmtPhone(p?: string | null) {
  if (!p) return null;
  const d = p.replace(/\D/g, "");
  if (d.length >= 17) return "Grupo WhatsApp";
  if (d.length === 13 && d.startsWith("55"))
    return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return p;
}

function DrillSheet({
  drill,
  onClose,
  stageMap,
  resolveName,
  resolveColor,
}: {
  drill: DrillState;
  onClose: () => void;
  stageMap: Record<string, { name: string; color: string }>;
  resolveName: (id: string | null) => string;
  resolveColor: (id: string | null) => string;
}) {
  // Mais recentes primeiro (descendente), independente da ordem de entrada.
  const leads =
    drill?.kind === "lead"
      ? [...drill.leads].sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )
      : [];
  const movs =
    drill?.kind === "movement"
      ? [...drill.movements].sort(
          (a, b) =>
            new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime(),
        )
      : [];
  const count =
    drill?.kind === "lead"
      ? leads.length
      : drill?.kind === "movement"
        ? movs.length
        : 0;

  return (
    <Sheet open={!!drill} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b space-y-1">
          <SheetTitle className="text-base capitalize">{drill?.title || "Detalhe"}</SheetTitle>
          <SheetDescription className="text-xs">
            {count} {drill?.kind === "movement" ? "movimentação" : "lead"}
            {count === 1 ? "" : "s"} — mais recentes primeiro.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {count === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Nada para exibir.
            </div>
          ) : drill?.kind === "lead" ? (
            <ol className="divide-y">
              {leads.map((l, idx) => {
                const digits = (l.lead_phone || "").replace(/\D/g, "");
                const phone = fmtPhone(l.lead_phone);
                const stageColor = l.status
                  ? stageMap[l.status]?.color || "#64748b"
                  : "#64748b";
                return (
                  <li
                    key={l.id}
                    className="px-4 py-2.5 flex items-start gap-3 hover:bg-muted/40 transition-colors"
                  >
                    <span className="text-[10px] text-muted-foreground tabular-nums pt-1 shrink-0">
                      #{idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">
                        {l.lead_name || "Sem nome"}
                      </div>
                      {phone && (
                        <div className="text-xs text-muted-foreground truncate">{phone}</div>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {l.status && (
                          <Badge
                            variant="outline"
                            className="text-[10px] h-5"
                            style={{ borderColor: stageColor, color: stageColor }}
                          >
                            {resolveName(l.status)}
                          </Badge>
                        )}
                        {l.source && (
                          <Badge variant="secondary" className="text-[10px] h-5">
                            {SOURCE_LABELS[l.source] || l.source}
                          </Badge>
                        )}
                        {l.acolhedor && (
                          <span className="text-[10px] text-muted-foreground">
                            👤 {l.acolhedor}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          🕒 {format(new Date(l.created_at), "dd/MM HH:mm", { locale: ptBR })}
                        </span>
                      </div>
                    </div>
                    {digits && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => window.open(`https://wa.me/${digits}`, "_blank")}
                        title="Abrir no WhatsApp"
                      >
                        <MessageCircle className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : drill?.kind === "movement" ? (
            <ol className="divide-y">
              {movs.map((m, idx) => (
                <li key={m.id || idx} className="px-4 py-2.5 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{m.lead_name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {format(new Date(m.changed_at), "dd/MM HH:mm", { locale: ptBR })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <StageBadge label={resolveName(m.from_stage)} color={resolveColor(m.from_stage)} />
                    <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    <StageBadge label={resolveName(m.to_stage)} color={resolveColor(m.to_stage)} />
                  </div>
                  <div className="flex flex-wrap gap-x-3 text-[10px] text-muted-foreground">
                    <span>✍️ {m.changed_by_name}</span>
                    {m.acolhedor && <span>👤 {m.acolhedor}</span>}
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
