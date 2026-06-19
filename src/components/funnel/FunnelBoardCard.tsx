import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { LayoutGrid, Users, ArrowRight, Settings, Maximize2, Minimize2, Target, CheckCircle2, CalendarIcon, ExternalLink, X } from "lucide-react";
import { db as supabase } from "@/integrations/supabase";
import { useQuery } from "@tanstack/react-query";
import { StageFunnelChart } from "@/components/kanban/StageFunnelChart";
import { useBpcFormLeads } from "@/hooks/useBpcFormLeads";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { KanbanBoard } from "@/hooks/useKanbanBoards";

type DateField = "created_at" | "updated_at";
type RangePreset = "today" | "7d" | "30d" | "all" | "custom";

interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
}

function computeRange(preset: RangePreset, custom?: { from?: Date; to?: Date }): { from: Date | null; to: Date | null } {
  const now = new Date();
  if (preset === "all") return { from: null, to: null };
  if (preset === "today") {
    const f = new Date(now); f.setHours(0, 0, 0, 0);
    const t = new Date(now); t.setHours(23, 59, 59, 999);
    return { from: f, to: t };
  }
  if (preset === "7d") {
    const f = new Date(now); f.setDate(f.getDate() - 6); f.setHours(0, 0, 0, 0);
    return { from: f, to: now };
  }
  if (preset === "30d") {
    const f = new Date(now); f.setDate(f.getDate() - 29); f.setHours(0, 0, 0, 0);
    return { from: f, to: now };
  }
  return { from: custom?.from ?? null, to: custom?.to ?? null };
}

const isBpcFunnel = (name: string) => /bpc|autis/i.test(name);

interface FunnelBoardCardProps {
  board: KanbanBoard;
  expanded: boolean;
  onToggleExpand: () => void;
  onOpenKanban: () => void;
  onOpenTeam: () => void;
  onEdit: () => void;
  onOpenBpcSheet?: () => void;
}

export function FunnelBoardCard({
  board,
  expanded,
  onToggleExpand,
  onOpenKanban,
  onOpenTeam,
  onEdit,
}: FunnelBoardCardProps) {
  const navigate = useNavigate();
  const [dateField, setDateField] = useState<DateField>("created_at");
  const [rangePreset, setRangePreset] = useState<RangePreset>("all");
  const [customRange, setCustomRange] = useState<{ from?: Date; to?: Date }>({});

  const { from: fromDate, to: toDate } = useMemo(
    () => computeRange(rangePreset, customRange),
    [rangePreset, customRange.from?.getTime(), customRange.to?.getTime()]
  );
  const dateFilter = useMemo(
    () => ({ field: dateField, from: fromDate?.toISOString() ?? null, to: toDate?.toISOString() ?? null }),
    [dateField, fromDate, toDate]
  );

  const isBpc = isBpcFunnel(board.name);

  // Non-BPC: per-board lead counts
  const { data: counts } = useQuery({
    queryKey: ["funnel-board-counts", board.id, dateFilter],
    queryFn: async () => {
      let q = supabase.from("leads").select("status").eq("board_id", board.id);
      if (dateFilter.from) q = q.gte(dateFilter.field, dateFilter.from);
      if (dateFilter.to) q = q.lte(dateFilter.field, dateFilter.to);
      const { data, error } = await q;
      if (error) throw error;
      const byStage: Record<string, number> = {};
      for (const lead of data || []) {
        byStage[lead.status] = (byStage[lead.status] || 0) + 1;
      }
      return { total: (data || []).length, byStage };
    },
    enabled: true,
  });






  // Objetivos (expandido)
  const { data: objectiveData } = useQuery({
    queryKey: ["funnel-objectives", board.id],
    queryFn: async () => {
      const { data: links } = await supabase
        .from("checklist_stage_links")
        .select("stage_id, checklist_template_id, display_order")
        .eq("board_id", board.id)
        .order("display_order");
      if (!links?.length) return null;
      const templateIds = [...new Set(links.map(l => l.checklist_template_id))];
      const { data: templates } = await supabase
        .from("checklist_templates")
        .select("id, name")
        .in("id", templateIds);
      const { data: instances } = await supabase
        .from("lead_checklist_instances")
        .select("checklist_template_id, stage_id, items, is_completed")
        .eq("board_id", board.id);
      const templateMap = new Map(templates?.map(t => [t.id, t.name]) || []);
      const result: Record<string, { templateId: string; templateName: string; totalItems: number; completedItems: number; totalInstances: number; completedInstances: number }[]> = {};
      for (const link of links) {
        if (!result[link.stage_id]) result[link.stage_id] = [];
        const related = instances?.filter(
          i => i.checklist_template_id === link.checklist_template_id && i.stage_id === link.stage_id
        ) || [];
        let totalItems = 0, completedItems = 0;
        for (const inst of related) {
          const items = (inst.items as unknown as ChecklistItem[]) || [];
          totalItems += items.length;
          completedItems += items.filter(i => i.checked).length;
        }
        result[link.stage_id].push({
          templateId: link.checklist_template_id,
          templateName: templateMap.get(link.checklist_template_id) || "Objetivo",
          totalItems,
          completedItems,
          totalInstances: related.length,
          completedInstances: related.filter(i => i.is_completed).length,
        });
      }
      return result;
    },
    enabled: expanded,
  });

  const totalLeads = counts?.total || 0;
  const stageData = counts?.byStage || {};

  return (
    <Card className={cn("border-border/50 hover:shadow-md transition-all group", expanded && "lg:col-span-2")}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2 min-w-0">
            <LayoutGrid className="h-4 w-4 text-primary shrink-0" />
            <span className="truncate">{board.name}</span>
          </CardTitle>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="secondary" className="text-xs">
              <Users className="h-3 w-3 mr-1" />
              {totalLeads} leads
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onToggleExpand}
              title={expanded ? "Reduzir" : "Expandir"}
            >
              {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        {board.description && (
          <CardDescription className="text-xs line-clamp-1">{board.description}</CardDescription>
        )}

        {/* Filtro de data por board */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2">
          <Select value={dateField} onValueChange={(v) => setDateField(v as DateField)}>
            <SelectTrigger className="h-7 w-[150px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created_at">📥 Cadastro</SelectItem>
              <SelectItem value="updated_at">🔄 Atualização</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-0.5 rounded-md border bg-background p-0.5">
            {([
              { v: "today", l: "Hoje" },
              { v: "7d", l: "7d" },
              { v: "30d", l: "30d" },
              { v: "all", l: "Tudo" },
            ] as { v: RangePreset; l: string }[]).map(opt => (
              <Button
                key={opt.v}
                size="sm"
                variant={rangePreset === opt.v ? "default" : "ghost"}
                className="h-6 px-2 text-[11px]"
                onClick={() => setRangePreset(opt.v)}
              >
                {opt.l}
              </Button>
            ))}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant={rangePreset === "custom" ? "default" : "ghost"}
                  className="h-6 px-2 text-[11px] gap-1"
                >
                  <CalendarIcon className="h-3 w-3" />
                  {rangePreset === "custom" && customRange.from
                    ? `${format(customRange.from, "dd/MM", { locale: ptBR })}${customRange.to ? ` - ${format(customRange.to, "dd/MM", { locale: ptBR })}` : ""}`
                    : "Período"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="range"
                  selected={{ from: customRange.from, to: customRange.to }}
                  onSelect={(r) => {
                    setCustomRange({ from: r?.from, to: r?.to });
                    setRangePreset("custom");
                  }}
                  locale={ptBR}
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {isBpc ? (
          <div className="space-y-3">
            <StageFunnelChart board={board} leadsPerStage={stageData} dateFilter={dateFilter} />
            <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold flex items-center gap-1.5">
                  <LayoutGrid className="h-3.5 w-3.5 text-primary" />
                  Painel detalhado BPC
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                  Métricas da planilha + filtros por acolhedor (multi).
                </p>
              </div>
              <Button
                size="sm"
                className="shrink-0 h-8 text-xs"
                onClick={() => navigate(`/sales-funnels/bpc/${board.id}`)}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                Abrir
              </Button>
            </div>
          </div>
        ) : (
          <StageFunnelChart board={board} leadsPerStage={stageData} dateFilter={dateFilter} />
        )}

        {expanded && objectiveData && board.stages?.length > 0 && (
          <div className="border-t border-border/50 pt-3 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Target className="h-4 w-4 text-primary" />
              Detalhamento por Objetivo
            </div>
            <div className="space-y-3">
              {board.stages.map(stage => {
                const stageObjectives = objectiveData[stage.id];
                if (!stageObjectives?.length) return null;
                return (
                  <div key={stage.id} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
                      <span className="text-xs font-medium text-foreground">{stage.name}</span>
                      <span className="text-[10px] text-muted-foreground">({stageData[stage.id] || 0} leads)</span>
                    </div>
                    <div className="ml-5 space-y-1.5">
                      {stageObjectives.map(obj => {
                        const pct = obj.totalItems > 0 ? Math.round((obj.completedItems / obj.totalItems) * 100) : 0;
                        return (
                          <div key={obj.templateId} className="flex items-center gap-3 p-2 rounded-md bg-muted/30">
                            <CheckCircle2 className={cn("h-3.5 w-3.5 shrink-0", pct === 100 ? "text-primary" : "text-muted-foreground")} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[11px] font-medium truncate">{obj.templateName}</span>
                                <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                                  {obj.completedItems}/{obj.totalItems} passos · {obj.completedInstances}/{obj.totalInstances} concluídos
                                </span>
                              </div>
                              <Progress value={pct} className="h-1.5" />
                            </div>
                            <Badge variant="outline" className="text-[10px] px-1.5 font-mono shrink-0">{pct}%</Badge>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {expanded && objectiveData === null && (
          <div className="border-t border-border/50 pt-3 text-center text-xs text-muted-foreground py-4">
            Nenhum objetivo configurado para este funil
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" className="text-xs" onClick={onOpenTeam}>
            <Users className="h-3.5 w-3.5 mr-1.5" />
            Equipe
          </Button>
          <Button variant="outline" size="sm" className="text-xs" onClick={onEdit}>
            <Settings className="h-3.5 w-3.5 mr-1.5" />
            Editar
          </Button>
          <Button variant="default" size="sm" className="text-xs" onClick={onOpenKanban}>
            <LayoutGrid className="h-3.5 w-3.5 mr-1.5" />
            Abrir Kanban
            <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
