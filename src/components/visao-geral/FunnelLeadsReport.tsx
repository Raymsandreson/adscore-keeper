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
  RefreshCw,
  AlertCircle,
  CalendarDays,
  ArrowRight,
  UserPlus,
  Repeat,
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

interface MovementRow {
  from_stage: string | null;
  to_stage: string;
  changed_at: string;
}

type QuickPeriod = "today" | "week" | "month" | "custom";

const PERIOD_LABELS: Record<QuickPeriod, string> = {
  today: "Hoje",
  week: "Últimos 7 dias",
  month: "Últimos 30 dias",
  custom: "Personalizado",
};

/**
 * Relatório de Leads do funil (usado em Visão Geral → Acidente de Trabalho).
 * - Cadastrados por dia/semana/mês (head-count, sem baixar linhas).
 * - Cadastrados e movimentações num intervalo selecionável no calendário.
 * - Movimentações etapa → etapa agregadas.
 */
export default function FunnelLeadsReport({ boardMatcher }: Props) {
  const { boards, loading: loadingBoards } = useKanbanBoards();

  const board = useMemo<KanbanBoard | null>(() => {
    const matches = boards.filter(
      (b) => b.board_type === "funnel" && boardMatcher.test(b.name),
    );
    return matches.find((b) => (b.stages || []).length > 0) || matches[0] || null;
  }, [boards, boardMatcher]);

  // Contagens fixas de cadastro (dia/semana/mês).
  const [quickCounts, setQuickCounts] = useState<{
    today: number;
    week: number;
    month: number;
  } | null>(null);

  // Intervalo selecionado.
  const [period, setPeriod] = useState<QuickPeriod>("week");
  const [range, setRange] = useState<DateRange | undefined>();
  const [rangeNewLeads, setRangeNewLeads] = useState(0);
  const [movements, setMovements] = useState<MovementRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Intervalo efetivo (início/fim) derivado do período/calendário.
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

  const stageNames = useMemo(() => {
    const map: Record<string, { name: string; color: string }> = {};
    (board?.stages || []).forEach((s) => {
      map[s.id] = { name: s.name, color: s.color || "#6366f1" };
    });
    return map;
  }, [board]);

  const getStageName = useCallback(
    (id: string | null) => (id ? stageNames[id]?.name || "—" : "Novo"),
    [stageNames],
  );
  const getStageColor = useCallback(
    (id: string | null) => (id ? stageNames[id]?.color || "#6b7280" : "#6b7280"),
    [stageNames],
  );

  // Carrega contagens fixas de cadastro (uma vez por board).
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

  // Carrega cadastros + movimentações do intervalo selecionado.
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

        // Cadastrados no período (head-count).
        const newLeadsResp = await db
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("board_id", board.id)
          .gte("created_at", startISO)
          .lte("created_at", endISO);
        if (newLeadsResp.error) throw newLeadsResp.error;

        // Movimentações do board no período (filtra board no servidor via OR).
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

  // Agregações de movimentação.
  const analysis = useMemo(() => {
    const perStage: Record<string, { in: number; out: number }> = {};
    (board?.stages || []).forEach((s) => {
      perStage[s.id] = { in: 0, out: 0 };
    });
    const transitions: Record<
      string,
      { from: string | null; to: string; count: number }
    > = {};

    movements.forEach((m) => {
      if (m.to_stage && perStage[m.to_stage]) perStage[m.to_stage].in++;
      if (m.from_stage && perStage[m.from_stage]) perStage[m.from_stage].out++;
      const key = `${m.from_stage ?? "∅"}→${m.to_stage}`;
      if (!transitions[key]) {
        transitions[key] = { from: m.from_stage, to: m.to_stage, count: 0 };
      }
      transitions[key].count++;
    });

    const transitionList = Object.values(transitions).sort(
      (a, b) => b.count - a.count,
    );
    return { perStage, transitionList, total: movements.length };
  }, [board, movements]);

  const rangeLabel = useMemo(() => {
    if (!effectiveRange) return "Selecione um intervalo";
    const { start, end } = effectiveRange;
    const fmt = (d: Date) => format(d, "dd/MM/yyyy", { locale: ptBR });
    return fmt(start) === fmt(end) ? fmt(start) : `${fmt(start)} — ${fmt(end)}`;
  }, [effectiveRange]);

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

  return (
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
        {/* Cadastrados: dia / semana / mês */}
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
            Leads cadastrados
          </div>
          <div className="grid grid-cols-3 gap-3">
            <MiniKpi label="Hoje" value={quickCounts?.today} />
            <MiniKpi label="Esta semana" value={quickCounts?.week} />
            <MiniKpi label="Este mês" value={quickCounts?.month} />
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
            <Skeleton className="h-40 rounded-lg" />
          </div>
        ) : (
          <>
            {/* Resumo do período */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <UserPlus className="h-4 w-4" />
                  <span className="text-[11px] uppercase tracking-wide">
                    Cadastrados no período
                  </span>
                </div>
                <div className="text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {rangeNewLeads}
                </div>
              </div>
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Repeat className="h-4 w-4" />
                  <span className="text-[11px] uppercase tracking-wide">
                    Movimentações
                  </span>
                </div>
                <div className="text-2xl font-semibold tabular-nums">
                  {analysis.total}
                </div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground -mt-2">
              Período: {rangeLabel}
            </div>

            {/* Movimentação por etapa (entradas/saídas) */}
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                Movimentação por etapa
              </div>
              <div className="space-y-1.5">
                {(board?.stages || []).map((s) => {
                  const mv = analysis.perStage[s.id] || { in: 0, out: 0 };
                  return (
                    <div
                      key={s.id}
                      className="flex items-center justify-between rounded-md border bg-background px-3 py-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ background: s.color || "#6366f1" }}
                        />
                        <span className="text-sm truncate">{s.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge
                          variant="secondary"
                          className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 tabular-nums"
                        >
                          +{mv.in}
                        </Badge>
                        <Badge
                          variant="secondary"
                          className="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 tabular-nums"
                        >
                          −{mv.out}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Transições de → para */}
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                Movimentações etapa → etapa
              </div>
              {analysis.transitionList.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma movimentação no período selecionado.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                  {analysis.transitionList.map((t) => (
                    <div
                      key={`${t.from ?? "∅"}-${t.to}`}
                      className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge
                          variant="outline"
                          className="truncate max-w-[45%]"
                          style={{
                            borderColor: getStageColor(t.from),
                            color: getStageColor(t.from),
                          }}
                        >
                          {getStageName(t.from)}
                        </Badge>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <Badge
                          variant="outline"
                          className="truncate max-w-[45%]"
                          style={{
                            borderColor: getStageColor(t.to),
                            color: getStageColor(t.to),
                          }}
                        >
                          {getStageName(t.to)}
                        </Badge>
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
  );
}

function MiniKpi({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">
        {value === undefined ? (
          <Skeleton className="h-7 w-10" />
        ) : (
          value
        )}
      </div>
    </div>
  );
}
