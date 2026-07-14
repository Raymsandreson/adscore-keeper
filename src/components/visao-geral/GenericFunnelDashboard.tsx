import { useEffect, useMemo, useState } from "react";
import { db } from "@/integrations/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, AlertCircle, ExternalLink } from "lucide-react";
import { useKanbanBoards, type KanbanBoard } from "@/hooks/useKanbanBoards";
import { Link } from "react-router-dom";
import { useBpcFormLeads } from "@/hooks/useBpcFormLeads";
import { getFunnelSheetConfig } from "@/lib/funnelSheetConfig";
import { FunnelLeadsSidePanel, type FunnelStageFilter } from "./FunnelLeadsSidePanel";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface StageCount {
  id: string;
  name: string;
  color: string;
  count: number;
}

interface Props {
  /** Substring (case-insensitive) used to match the kanban board name. */
  boardMatcher: RegExp;
  /** Display title for this dashboard. */
  title: string;
}

/**
 * Lightweight, on-demand funnel dashboard.
 * - Resolves the kanban board by name match.
 * - Fetches lead counts per stage via head-count queries (no row download).
 */
export default function GenericFunnelDashboard({ boardMatcher, title }: Props) {
  const { boards, loading: loadingBoards } = useKanbanBoards();
  const [stages, setStages] = useState<StageCount[] | null>(null);
  const [total, setTotal] = useState(0);
  const [closedCount, setClosedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [matchedBoard, setMatchedBoard] = useState<KanbanBoard | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [barsReady, setBarsReady] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [stageFilter, setStageFilter] = useState<FunnelStageFilter | null>(null);
  const openPanel = (stage: FunnelStageFilter | null) => {
    setStageFilter(stage);
    setPanelOpen(true);
  };
  const sheetCfg = useMemo(() => getFunnelSheetConfig(matchedBoard?.name), [matchedBoard?.name]);
  const sheetRange = useMemo(
    () => ({ from: new Date("2020-01-01T00:00:00Z"), to: new Date() }),
    [reloadKey],
  );
  const { leads: sheetLeads, loading: sheetLoading } = useBpcFormLeads({
    from: sheetRange.from,
    to: sheetRange.to,
    enabled: !!sheetCfg,
    source: "unificada",
    spreadsheetId: sheetCfg?.spreadsheetId,
  });

  const findDashboardBoard = (items: KanbanBoard[]) => {
    const matches = items.filter((b) => b.board_type === "funnel" && boardMatcher.test(b.name));
    return matches.find((b) => (b.stages || []).length > 0) || matches[0] || null;
  };

  useEffect(() => {
    if (loadingBoards) return;
    const board = findDashboardBoard(boards);
    setMatchedBoard(board);
    if (!board) {
      setLoading(false);
      setError("Funil não encontrado na base. Verifique o nome em Funis de Vendas.");
      return;
    }
    const boardSheetCfg = getFunnelSheetConfig(board.name);
    if (boardSheetCfg && sheetLoading && sheetLeads.length === 0) {
      setLoading(true);
      setError(null);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    setBarsReady(false);
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const stagesArr = board.stages || [];

        if (boardSheetCfg) {
          const firstStageId = stagesArr[0]?.id;
          const sheetPhoneKeys = new Set(
            sheetLeads
              .map((lead) => (lead.phone_normalized || lead.phone_raw || "").replace(/\D/g, "").slice(-8))
              .filter((key) => key.length === 8),
          );
          const byStage: Record<string, number> = {};
          let closed = 0;
          const PAGE = 1000;
          for (let from = 0; ; from += PAGE) {
            const { data, error } = await db
              .from("leads")
              .select("status, lead_phone, lead_status")
              .eq("board_id", board.id)
              .range(from, from + PAGE - 1);
            if (error) throw error;
            const rows = data || [];
            for (const row of rows) {
              const phoneKey = (row.lead_phone || "").replace(/\D/g, "").slice(-8);
              if (!sheetPhoneKeys.has(phoneKey)) continue;
              if (row.lead_status === "closed") closed++;
              if (!row.status || row.status === firstStageId) continue;
              byStage[row.status] = (byStage[row.status] || 0) + 1;
            }
            if (rows.length < PAGE) break;
          }

          if (firstStageId) byStage[firstStageId] = sheetLeads.length;
          const perStage = stagesArr.map((s) => ({
            id: s.id,
            name: s.name,
            color: s.color || "#6366f1",
            count: byStage[s.id] || 0,
          }));

          if (cancelled) return;
          setTotal(sheetLeads.length);
          setClosedCount(closed);
          setStages(perStage);
          timeoutId = setTimeout(() => setBarsReady(true), 60);
          return;
        }

        const closedResp = await db
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("board_id", board.id)
          .eq("lead_status", "closed");
        if (closedResp.error) throw closedResp.error;

        // counts per stage in parallel
        const perStage = await Promise.all(
          stagesArr.map(async (s) => {
            const { count, error } = await db
              .from("leads")
              .select("id", { count: "exact", head: true })
              .eq("board_id", board.id)
              .eq("status", s.id);
            if (error) throw error;
            return {
              id: s.id,
              name: s.name,
              color: s.color || "#6366f1",
              count: count || 0,
            };
          }),
        );
        // "Leads no funil" = soma dos leads distribuídos nas etapas configuradas.
        // Não usar a contagem bruta do board: ela inclui leads em status fora do
        // funil (ex.: google_alerts em noticias/viavel), o que faz o total não
        // bater com as barras nem com os percentuais por etapa.
        const totalInStages = perStage.reduce((acc, s) => acc + s.count, 0);
        if (cancelled) return;
        setTotal(totalInStages);
        setClosedCount(closedResp.count || 0);
        setStages(perStage);
        timeoutId = setTimeout(() => setBarsReady(true), 60);
      } catch (e: any) {
        if (cancelled) return;
        console.error("[GenericFunnelDashboard]", e);
        setError(e?.message || "Falha ao carregar métricas");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [boards, loadingBoards, boardMatcher, reloadKey, sheetLeads, sheetLoading]);

  if (loadingBoards || loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  if (error || !matchedBoard) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="p-6 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
          <div className="space-y-2">
            <div className="font-medium">{title}</div>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
              <RefreshCw className="h-3.5 w-3.5 mr-2" /> Tentar novamente
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const maxCount = Math.max(1, ...(stages || []).map((s) => s.count));
  const conv = total > 0 ? Math.round((closedCount / total) * 1000) / 10 : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Funil</div>
          <h2 className="text-xl font-semibold">{matchedBoard.name}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => openPanel(null)}>
            <ExternalLink className="h-3.5 w-3.5 mr-2" /> Ver leads
          </Button>
          <FunnelLeadsSidePanel
            board={matchedBoard}
            open={panelOpen}
            onOpenChange={(v) => {
              setPanelOpen(v);
              if (!v) setStageFilter(null);
            }}
            stageFilter={stageFilter}
            hideTrigger
          />
          <Button size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw className="h-3.5 w-3.5 mr-2" /> Atualizar
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to={`/leads?board=${matchedBoard.id}`}>
              <ExternalLink className="h-3.5 w-3.5 mr-2" /> Abrir Kanban
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Leads no funil" value={total} />
        <KpiCard label="Fechados" value={closedCount} tone="success" />
        <KpiCard label="Conversão" value={`${conv}%`} tone="primary" />
        <KpiCard label="Etapas" value={(stages || []).length} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Distribuição por etapa</CardTitle>
        </CardHeader>
        <CardContent>
          {(stages || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem etapas configuradas.</p>
          ) : (
            <TooltipProvider delayDuration={150}>
              <div
                className="grid items-end gap-3"
                style={{
                  gridTemplateColumns: `repeat(${stages!.length}, minmax(0, 1fr))`,
                  height: 280,
                }}
              >
                {stages!.map((s) => {
                  const pct = (s.count / maxCount) * 100;
                  const sharePct = total > 0 ? Math.round((s.count / total) * 1000) / 10 : 0;
                  const barHeight = barsReady ? `${Math.max(pct, 2)}%` : "0%";
                  const handleClick = () =>
                    openPanel({ id: s.id, name: s.name, color: s.color });
                  return (
                    <Tooltip key={s.id}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={handleClick}
                          className="h-full flex flex-col items-center justify-end gap-2 min-w-0 cursor-pointer bg-transparent border-0 p-0 rounded-md hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors"
                          title={`Ver leads na etapa "${s.name}"`}
                        >
                          <div className="text-xs font-semibold tabular-nums">{s.count}</div>
                          <div className="w-full flex-1 flex items-end">
                            <div
                              className="w-full rounded-t-md transition-[height] duration-700 ease-out"
                              style={{
                                height: barHeight,
                                background: s.color,
                                minHeight: barsReady ? 4 : 0,
                              }}
                            />
                          </div>
                          <div className="w-full flex flex-col items-center gap-0.5">
                            <div className="flex items-center gap-1 min-w-0 w-full justify-center">
                              <span
                                className="h-2 w-2 rounded-full shrink-0"
                                style={{ background: s.color }}
                              />
                              <span className="text-[11px] truncate text-center">
                                {s.name}
                              </span>
                            </div>
                            <span className="text-[10px] text-muted-foreground tabular-nums">
                              {sharePct}%
                            </span>
                          </div>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" sideOffset={6} className="space-y-1">
                        <div className="font-medium text-sm">{s.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {s.count} leads ({sharePct}% do total)
                        </div>
                        <div className="text-[10px] text-primary">Clique para listar</div>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </TooltipProvider>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "primary" | "success";
}) {
  const color =
    tone === "primary"
      ? "text-primary"
      : tone === "success"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
