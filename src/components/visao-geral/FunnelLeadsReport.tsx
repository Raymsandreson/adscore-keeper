import { useCallback, useEffect, useMemo, useState } from "react";
import { db } from "@/integrations/supabase";
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
} from "lucide-react";
import { useKanbanBoards, type KanbanBoard } from "@/hooks/useKanbanBoards";
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  startOfMonth,
  subDays,
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
 * Excluímos "google_alerts" (itens brutos de notícia auto-importados que ficam
 * parados nas etapas noticias/viavel sem virar cadastro) e demais origens
 * automáticas (whatsapp, referral, etc.).
 */
const CADASTRO_SOURCES = ["Internet", "manual"] as const;

const SOURCE_LABELS: Record<string, string> = {
  Internet: "Notícias",
  manual: "Manual",
};

/**
 * Status especiais que não são colunas do funil (kanban stages) mas aparecem
 * como origem/destino em lead_stage_history. Reutiliza os rótulos canônicos
 * usados em LeadStageHistoryPanel.
 */
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

function humanize(id: string) {
  return id.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

interface MovementRow {
  from_stage: string | null;
  to_stage: string;
  changed_at: string;
}

interface LeadRow {
  id: string;
  lead_name: string | null;
  lead_phone: string | null;
  created_at: string;
  source: string | null;
  status: string | null;
}

type QuickPeriod = "today" | "week" | "month" | "custom";

const PERIOD_LABELS: Record<QuickPeriod, string> = {
  today: "Hoje",
  week: "Últimos 7 dias",
  month: "Últimos 30 dias",
  custom: "Personalizado",
};

/**
 * Relatório de Leads do funil (Visão Geral → Acidente de Trabalho).
 * - Cadastrados por dia/semana/mês + intervalo no calendário (só cadastros reais).
 * - Clique em qualquer número de cadastro → lista os leads correspondentes.
 * - Movimentações etapa → etapa com destino resolvido (inclui status especiais).
 */
export default function FunnelLeadsReport({ boardMatcher }: Props) {
  const { boards, loading: loadingBoards } = useKanbanBoards();

  const board = useMemo<KanbanBoard | null>(() => {
    const matches = boards.filter(
      (b) => b.board_type === "funnel" && boardMatcher.test(b.name),
    );
    return matches.find((b) => (b.stages || []).length > 0) || matches[0] || null;
  }, [boards, boardMatcher]);

  const [quickCounts, setQuickCounts] = useState<{
    today: number;
    week: number;
    month: number;
  } | null>(null);

  const [period, setPeriod] = useState<QuickPeriod>("week");
  const [range, setRange] = useState<DateRange | undefined>();
  const [rangeNewLeads, setRangeNewLeads] = useState(0);
  const [movements, setMovements] = useState<MovementRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Drill-down: lista de leads de um recorte de datas.
  const [drill, setDrill] = useState<{
    from: Date;
    to: Date;
    label: string;
  } | null>(null);

  const effectiveRange = useMemo<{ start: Date; end: Date } | null>(() => {
    const now = new Date();
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
  }, [period, range]);

  const stageMap = useMemo(() => {
    const map: Record<string, { name: string; color: string }> = {};
    (board?.stages || []).forEach((s) => {
      map[s.id] = { name: s.name, color: s.color || "#6366f1" };
    });
    return map;
  }, [board]);

  // Resolve nome/cor de um id que pode ser uma etapa do funil OU um status especial.
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

  // Contagens fixas de cadastro (dia/semana/mês).
  useEffect(() => {
    if (loadingBoards) return;
    if (!board) {
      setLoading(false);
      setError("Funil não encontrado na base. Verifique o nome em Funis de Vendas.");
      return;
    }
    let cancelled = false;
    (async () => {
      const now = new Date();
      const countCreated = async (from: Date) => {
        const { count, error } = await db
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("board_id", board.id)
          .in("source", CADASTRO_SOURCES as unknown as string[])
          .gte("created_at", from.toISOString());
        if (error) throw error;
        return count || 0;
      };
      try {
        const [today, week, month] = await Promise.all([
          countCreated(startOfDay(now)),
          countCreated(startOfWeek(now, { weekStartsOn: 1 })),
          countCreated(startOfMonth(now)),
        ]);
        if (cancelled) return;
        setQuickCounts({ today, week, month });
      } catch (e) {
        if (cancelled) return;
        console.error("[FunnelLeadsReport] quick counts", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [board, loadingBoards, reloadKey]);

  // Cadastros + movimentações do intervalo selecionado.
  useEffect(() => {
    if (loadingBoards) return;
    if (!board || !effectiveRange) {
      if (board) setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const startISO = effectiveRange.start.toISOString();
        const endISO = effectiveRange.end.toISOString();

        const newLeadsResp = await db
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("board_id", board.id)
          .in("source", CADASTRO_SOURCES as unknown as string[])
          .gte("created_at", startISO)
          .lte("created_at", endISO);
        if (newLeadsResp.error) throw newLeadsResp.error;

        const { data: histData, error: histError } = await db
          .from("lead_stage_history")
          .select("from_stage, to_stage, changed_at, from_board_id, to_board_id")
          .gte("changed_at", startISO)
          .lte("changed_at", endISO)
          .or(`to_board_id.eq.${board.id},from_board_id.eq.${board.id}`)
          .order("changed_at", { ascending: false });
        if (histError) throw histError;

        if (cancelled) return;
        setRangeNewLeads(newLeadsResp.count || 0);
        setMovements(
          (histData || []).map((h) => ({
            from_stage: h.from_stage,
            to_stage: h.to_stage,
            changed_at: h.changed_at,
          })),
        );
      } catch (e) {
        if (cancelled) return;
        console.error("[FunnelLeadsReport] range", e);
        setError(e instanceof Error ? e.message : "Falha ao carregar relatório");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [board, loadingBoards, effectiveRange, reloadKey]);

  // Transições agregadas (de → para), maiores primeiro.
  const transitions = useMemo(() => {
    const acc: Record<
      string,
      { from: string | null; to: string; count: number }
    > = {};
    movements.forEach((m) => {
      const key = `${m.from_stage ?? "∅"}→${m.to_stage}`;
      if (!acc[key]) acc[key] = { from: m.from_stage, to: m.to_stage, count: 0 };
      acc[key].count++;
    });
    return Object.values(acc).sort((a, b) => b.count - a.count);
  }, [movements]);

  const rangeLabel = useMemo(() => {
    if (!effectiveRange) return "Selecione um intervalo";
    const { start, end } = effectiveRange;
    const fmt = (d: Date) => format(d, "dd/MM/yyyy", { locale: ptBR });
    return fmt(start) === fmt(end) ? fmt(start) : `${fmt(start)} — ${fmt(end)}`;
  }, [effectiveRange]);

  const openDrill = (from: Date, to: Date, label: string) =>
    setDrill({ from, to, label });

  if (loadingBoards) {
    return <Skeleton className="h-64 rounded-lg" />;
  }

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

  const now = new Date();

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
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
          </Button>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Cadastros: dia / semana / mês (clicáveis) */}
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
              Leads cadastrados
            </div>
            <div className="grid grid-cols-3 gap-3">
              <ClickKpi
                label="Hoje"
                value={quickCounts?.today}
                onClick={() =>
                  openDrill(startOfDay(now), endOfDay(now), "cadastrados hoje")
                }
              />
              <ClickKpi
                label="Esta semana"
                value={quickCounts?.week}
                onClick={() =>
                  openDrill(
                    startOfWeek(now, { weekStartsOn: 1 }),
                    endOfDay(now),
                    "cadastrados esta semana",
                  )
                }
              />
              <ClickKpi
                label="Este mês"
                value={quickCounts?.month}
                onClick={() =>
                  openDrill(
                    startOfMonth(now),
                    endOfDay(now),
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
                  onClick={() =>
                    effectiveRange &&
                    openDrill(
                      effectiveRange.start,
                      effectiveRange.end,
                      `cadastrados · ${rangeLabel}`,
                    )
                  }
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
                      {rangeNewLeads}
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
                    {movements.length}
                  </div>
                </div>
              </div>
              <div className="text-xs text-muted-foreground -mt-2">
                Período: {rangeLabel}
              </div>

              {/* Transições de → para */}
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                  Movimentações etapa → etapa
                </div>
                {transitions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma movimentação no período selecionado.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                    {transitions.map((t) => (
                      <div
                        key={`${t.from ?? "∅"}-${t.to}`}
                        className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <StageBadge
                            label={resolveName(t.from)}
                            color={resolveColor(t.from)}
                          />
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <StageBadge
                            label={resolveName(t.to)}
                            color={resolveColor(t.to)}
                          />
                        </div>
                        <span className="font-semibold tabular-nums shrink-0">
                          {t.count}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <LeadListSheet
        board={board}
        drill={drill}
        onClose={() => setDrill(null)}
        stageMap={stageMap}
        resolveName={resolveName}
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

function LeadListSheet({
  board,
  drill,
  onClose,
  stageMap,
  resolveName,
}: {
  board: KanbanBoard | null;
  drill: { from: Date; to: Date; label: string } | null;
  onClose: () => void;
  stageMap: Record<string, { name: string; color: string }>;
  resolveName: (id: string | null) => string;
}) {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!drill || !board) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await db
          .from("leads")
          .select("id, lead_name, lead_phone, created_at, source, status")
          .eq("board_id", board.id)
          .in("source", CADASTRO_SOURCES as unknown as string[])
          .gte("created_at", drill.from.toISOString())
          .lte("created_at", drill.to.toISOString())
          .order("created_at", { ascending: false });
        if (error) throw error;
        if (!cancelled) setLeads((data || []) as LeadRow[]);
      } catch (e) {
        console.error("[LeadListSheet]", e);
        if (!cancelled) setLeads([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [drill, board]);

  return (
    <Sheet open={!!drill} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b space-y-1">
          <SheetTitle className="text-base capitalize">
            {drill?.label || "Leads"}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {loading
              ? "Carregando..."
              : `${leads.length} lead${leads.length === 1 ? "" : "s"} — mais recentes primeiro.`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {loading && leads.length === 0 ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-14 rounded-md bg-muted/40 animate-pulse" />
              ))}
            </div>
          ) : leads.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Nenhum cadastro nesse período.
            </div>
          ) : (
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
                        <div className="text-xs text-muted-foreground truncate">
                          {phone}
                        </div>
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
                        <span className="text-[10px] text-muted-foreground">
                          🕒{" "}
                          {format(new Date(l.created_at), "dd/MM HH:mm", {
                            locale: ptBR,
                          })}
                        </span>
                      </div>
                    </div>
                    {digits && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() =>
                          window.open(`https://wa.me/${digits}`, "_blank")
                        }
                        title="Abrir no WhatsApp"
                      >
                        <MessageCircle className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
