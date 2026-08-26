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
import { LayoutGrid, Users, ArrowRight, Settings, Maximize2, Minimize2, Target, CheckCircle2, CalendarIcon, ExternalLink, X, GitBranch, Scale, Trash2, Archive, ArchiveRestore, Wallet } from "lucide-react";
import { WorkflowVisualizationDialog } from "@/components/workflow/WorkflowVisualizationDialog";
import { db } from "@/integrations/supabase";
import { useQuery } from "@tanstack/react-query";
import { StageFunnelChart, type BoardViewMode } from "@/components/kanban/StageFunnelChart";
import { useBpcFormLeads } from "@/hooks/useBpcFormLeads";
import { buildBpcAcolhedorFilter, leadMatchesFilter } from "@/lib/bpcPhoneMatch";
import { getFunnelSheetConfig } from "@/lib/funnelSheetConfig";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { KanbanBoard } from "@/hooks/useKanbanBoards";

export type BoardType = "funnel" | "workflow";

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

interface BoardCardProps {
  board: KanbanBoard;
  /**
   * Só troca rótulo. Funil (comercial) e POP (processual) têm exatamente as
   * mesmas funcionalidades — a diferença é de qual time o quadro é.
   */
  boardType: BoardType;
  /**
   * Densidade do card, escolhida uma vez para a página inteira (ver BoardsList).
   * lista = linha compacta · grade = card resumido · funil = card completo com
   * gráfico e filtro de data.
   */
  variant?: BoardViewMode;
  /** Total já contado pela listagem — evita refazer a query em lista/grade. */
  totalOverride?: number;
  expanded: boolean;
  onToggleExpand: () => void;
  onOpenKanban: () => void;
  onOpenTeam: () => void;
  onEdit: () => void;
  onOpenProcesses?: () => void;
  /** Carteira do POP (marcos × dinheiro × tempo) — só faz sentido em POP. */
  onOpenCarteira?: () => void;
  /** Conciliação dos acordos do POP. Ausente = o tipo de quadro não tem acordo. */
  onOpenConciliacao?: () => void;
  processCount?: number;
  onDelete?: () => void;
  /** Quadro arquivado: card esmaecido, badge "Arquivado" e ação de desarquivar. */
  archived?: boolean;
  onToggleArchive?: () => void;
}

export function BoardCard({
  board,
  boardType,
  variant = "funil",
  totalOverride,
  expanded,
  onToggleExpand,
  onOpenKanban,
  onOpenTeam,
  onEdit,
  onOpenProcesses,
  onOpenCarteira,
  onOpenConciliacao,
  processCount = 0,
  onDelete,
  archived = false,
  onToggleArchive,
}: BoardCardProps) {
  const navigate = useNavigate();
  const isPop = boardType === "workflow";
  const typeLabel = isPop ? "POP" : "funil";
  // POP é populado por PROCESSO (lead_processes.workflow_id); funil, por LEAD.
  const unitLabel = isPop ? "processos" : "leads";
  // Só o card completo carrega gráfico, filtro de data e prévia de planilha.
  // Em lista/grade nada disso é exibido, então nada disso é consultado.
  const isFull = variant === "funil";
  const [showVisualization, setShowVisualization] = useState(false);
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

  const sheetCfg = useMemo(() => getFunnelSheetConfig(board.name), [board.name]);
  const isBpc = !!sheetCfg;

  // Acolhedores (multi-select) — só pra prévia dos quadros com planilha
  const ALWAYS_SHOW_ACOLHEDORES = useMemo(() => ["Karolyne", "Edilan"], []);
  const [selectedAcolhedores, setSelectedAcolhedores] = useState<string[]>([]);
  const noAcolhedorFilter = selectedAcolhedores.length === 0;
  const toggleAcolhedor = (n: string) =>
    setSelectedAcolhedores(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n]);

  // Planilha (só carrega em quadros com sheet configurada)
  const bpcRange = useMemo(() => ({
    from: fromDate ?? new Date("2020-01-01T00:00:00Z"),
    to: toDate ?? new Date(),
  }), [fromDate, toDate]);
  const { leads: bpcLeads } = useBpcFormLeads({
    from: bpcRange.from,
    to: bpcRange.to,
    enabled: isBpc && isFull,
    source: "unificada",
    spreadsheetId: sheetCfg?.spreadsheetId,
  });

  const allAcolhedores = useMemo(() => {
    const set = new Set<string>();
    for (const l of bpcLeads) {
      const op = (l.operator || "").trim();
      if (op) set.add(op);
    }
    for (const a of ALWAYS_SHOW_ACOLHEDORES) set.add(a);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [bpcLeads, ALWAYS_SHOW_ACOLHEDORES]);

  const bpcFilter = useMemo(() => {
    if (!isBpc || noAcolhedorFilter) {
      return { phoneKeys: null as Set<string> | null, matchedLeadCount: 0, validPhoneCount: 0, droppedNoPhone: 0 };
    }
    return buildBpcAcolhedorFilter({ selected: selectedAcolhedores, leads: bpcLeads });
  }, [isBpc, noAcolhedorFilter, selectedAcolhedores, bpcLeads]);

  // Aviso silencioso quando o filtro está ativo mas a planilha ainda não retornou
  // (evita "0 leads" enganoso durante o carregamento)
  const filterPending = isBpc && !noAcolhedorFilter && (!bpcLeads || bpcLeads.length === 0);

  // Per-board lead counts (refiltra client-side por acolhedor quando BPC)
  const { data: counts } = useQuery({
    queryKey: ["board-lead-counts", board.id, dateFilter],
    queryFn: async () => {
      // Paginação para evitar o cap de 1000 linhas do PostgREST em quadros grandes
      const PAGE = 1000;
      const all: Array<{ status: string; lead_phone: string | null }> = [];
      for (let from = 0; ; from += PAGE) {
        let q = db
          .from("leads")
          .select("status, lead_phone")
          .eq("board_id", board.id)
          .range(from, from + PAGE - 1);
        if (dateFilter.from) q = q.gte(dateFilter.field, dateFilter.from);
        if (dateFilter.to) q = q.lte(dateFilter.field, dateFilter.to);
        const { data, error } = await q;
        if (error) throw error;
        const rows = (data || []) as Array<{ status: string; lead_phone: string | null }>;
        all.push(...rows);
        if (rows.length < PAGE) break;
      }
      return all;
    },
    enabled: !isPop && isFull,
  });

  // POP conta processo, não lead — o badge do cabeçalho segue essa unidade.
  const { data: processTotal } = useQuery({
    queryKey: ["board-process-total", board.id, dateFilter],
    queryFn: async () => {
      let q = db
        .from("lead_processes")
        .select("id", { count: "exact", head: true })
        .eq("workflow_id", board.id)
        .is("deleted_at", null);
      if (dateFilter.from) q = q.gte(dateFilter.field, dateFilter.from);
      if (dateFilter.to) q = q.lte(dateFilter.field, dateFilter.to);
      const { count, error } = await q;
      if (error) throw error;
      return count || 0;
    },
    enabled: isPop && isFull,
  });

  const filteredCounts = useMemo(() => {
    const rows = counts || [];
    const byStage: Record<string, number> = {};
    let total = 0;
    // Filtro ativo mas planilha ainda carregando → não zera nada, devolve dados brutos
    const skipFilter = filterPending || !bpcFilter.phoneKeys;
    for (const r of rows) {
      if (!skipFilter && !leadMatchesFilter(r.lead_phone, bpcFilter)) continue;
      const status = r.status || "—";
      byStage[status] = (byStage[status] || 0) + 1;
      total++;
    }
    return { total, byStage };
  }, [counts, bpcFilter, filterPending]);

  // Objetivos (expandido)
  const { data: objectiveData } = useQuery({
    queryKey: ["board-objectives", board.id],
    queryFn: async () => {
      const { data: links } = await db
        .from("checklist_stage_links")
        .select("stage_id, checklist_template_id, display_order")
        .eq("board_id", board.id)
        .order("display_order");
      if (!links?.length) return null;
      const templateIds = [...new Set(links.map(l => l.checklist_template_id))];
      const { data: templates } = await db
        .from("checklist_templates")
        .select("id, name")
        .in("id", templateIds);
      const { data: instances } = await db
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

  const totalItems = isFull
    ? (isPop ? (processTotal || 0) : filteredCounts.total)
    : (totalOverride ?? 0);
  const stageData = filteredCounts.byStage;

  // Mesmas ações em qualquer densidade — lista/grade não perdem funcionalidade.
  const acoes = (
    <div className="flex flex-wrap justify-end gap-2 pt-1">
      <Button variant="outline" size="sm" className="text-xs" onClick={() => setShowVisualization(true)}>
        <GitBranch className="h-3.5 w-3.5 mr-1.5" />
        Fluxograma
      </Button>
      {onOpenProcesses && (
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={onOpenProcesses}
          title={`Ver processos vinculados a este ${typeLabel}`}
        >
          <Scale className="h-3.5 w-3.5 mr-1.5" />
          Processos
          {processCount > 0 && (
            <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px] leading-4">
              {processCount}
            </Badge>
          )}
        </Button>
      )}
      {onOpenCarteira && (
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={onOpenCarteira}
          title="Visão geral da carteira: processos por marco, tempo em cada um, valores por estágio financeiro, índice de sucesso e custo"
        >
          <Wallet className="h-3.5 w-3.5 mr-1.5" />
          Carteira
        </Button>
      )}
      {onOpenConciliacao && (
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={onOpenConciliacao}
          title="Conferir se o honorário lançado bate com os 30% do contrato em cada acordo homologado"
        >
          <Scale className="h-3.5 w-3.5 mr-1.5" />
          Conciliar
        </Button>
      )}
      <Button variant="outline" size="sm" className="text-xs" onClick={onOpenTeam}>
        <Users className="h-3.5 w-3.5 mr-1.5" />
        Equipe
      </Button>
      <Button variant="outline" size="sm" className="text-xs" onClick={onEdit}>
        <Settings className="h-3.5 w-3.5 mr-1.5" />
        Editar
      </Button>
      {onToggleArchive && (
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={onToggleArchive}
          title={archived
            ? `Voltar a exibir este ${typeLabel} nas listas e seleções`
            : `Ocultar este ${typeLabel} das listas e seleções sem apagar nada`}
        >
          {archived
            ? <ArchiveRestore className="h-3.5 w-3.5 mr-1.5" />
            : <Archive className="h-3.5 w-3.5 mr-1.5" />}
          {archived ? "Desarquivar" : "Arquivar"}
        </Button>
      )}
      {onDelete && (
        <Button
          variant="outline"
          size="sm"
          className="text-xs text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
          Excluir
        </Button>
      )}
      <Button variant="default" size="sm" className="text-xs" onClick={onOpenKanban}>
        <LayoutGrid className="h-3.5 w-3.5 mr-1.5" />
        Abrir Kanban
        <ArrowRight className="h-3 w-3 ml-1" />
      </Button>
    </div>
  );

  const archivedBadge = archived ? (
    <Badge variant="outline" className="text-[10px] shrink-0 text-muted-foreground gap-1">
      <Archive className="h-2.5 w-2.5" />
      Arquivado
    </Badge>
  ) : null;

  const dialogos = (
    <WorkflowVisualizationDialog
      board={board}
      open={showVisualization}
      onOpenChange={setShowVisualization}
      onEdit={onEdit}
    />
  );

  // ─── LISTA: uma linha por quadro, sem gráfico e sem filtro de data ───
  if (variant === "lista") {
    return (
      <>
        <div className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border/50 bg-card p-3 hover:shadow-sm transition-shadow",
          archived && "opacity-60"
        )}>
          <LayoutGrid className="h-4 w-4 text-primary shrink-0" />
          <div className="flex-1 min-w-[180px]">
            <div className="text-sm font-semibold truncate">{board.name}</div>
            {board.description && (
              <div className="text-[11px] text-muted-foreground line-clamp-1">{board.description}</div>
            )}
          </div>
          {archivedBadge}
          <Badge variant="secondary" className="text-xs shrink-0">
            {isPop ? <Scale className="h-3 w-3 mr-1" /> : <Users className="h-3 w-3 mr-1" />}
            {totalItems} {unitLabel}
          </Badge>
          <Badge variant="outline" className="text-[10px] shrink-0">
            {board.stages?.length || 0} etapas
          </Badge>
          {acoes}
        </div>
        {dialogos}
      </>
    );
  }

  // ─── GRADE: card resumido, etapas como chips ───
  if (variant === "grade") {
    return (
      <>
        <Card className={cn("border-border/50 hover:shadow-md transition-all", archived && "opacity-60")}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 min-w-0">
                <LayoutGrid className="h-4 w-4 text-primary shrink-0" />
                <span className="truncate">{board.name}</span>
              </CardTitle>
              <div className="flex items-center gap-1.5 shrink-0">
                {archivedBadge}
                <Badge variant="secondary" className="text-xs shrink-0">
                  {isPop ? <Scale className="h-3 w-3 mr-1" /> : <Users className="h-3 w-3 mr-1" />}
                  {totalItems}
                </Badge>
              </div>
            </div>
            {board.description && (
              <CardDescription className="text-xs line-clamp-1">{board.description}</CardDescription>
            )}
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div className="flex flex-wrap gap-1">
              {(board.stages || []).map(stage => (
                <span
                  key={stage.id}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground max-w-full"
                  title={stage.name}
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
                  <span className="truncate">{stage.name}</span>
                </span>
              ))}
              {!board.stages?.length && (
                <span className="text-[11px] text-muted-foreground">Nenhuma etapa configurada</span>
              )}
            </div>
            {acoes}
          </CardContent>
        </Card>
        {dialogos}
      </>
    );
  }

  // ─── FUNIL: card completo ───
  return (
    <Card className={cn("border-border/50 hover:shadow-md transition-all group", expanded && "lg:col-span-2", archived && "opacity-60")}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2 min-w-0">
            <LayoutGrid className="h-4 w-4 text-primary shrink-0" />
            <span className="truncate">{board.name}</span>
          </CardTitle>
          <div className="flex items-center gap-2 shrink-0">
            {archivedBadge}
            <Badge variant="secondary" className="text-xs">
              {isPop ? <Scale className="h-3 w-3 mr-1" /> : <Users className="h-3 w-3 mr-1" />}
              {totalItems} {unitLabel}
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
            {/* Filtro de acolhedor (multi-select) */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1.5">
                    <Users className="h-3 w-3 text-muted-foreground" />
                    {noAcolhedorFilter
                      ? "Todos acolhedores"
                      : `${selectedAcolhedores.length} selecionado${selectedAcolhedores.length > 1 ? "s" : ""}`}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[240px] p-2" align="start">
                  <div className="flex items-center justify-between px-1 pb-1.5 mb-1 border-b">
                    <span className="text-[11px] font-medium">Acolhedores</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[10px]"
                      onClick={() => setSelectedAcolhedores([])}
                      disabled={noAcolhedorFilter}
                    >
                      Limpar
                    </Button>
                  </div>
                  <div className="max-h-[240px] overflow-y-auto space-y-0.5">
                    <label className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-muted/60 cursor-pointer text-[11px]">
                      <Checkbox
                        checked={selectedAcolhedores.includes("__none__")}
                        onCheckedChange={() => toggleAcolhedor("__none__")}
                      />
                      <span className="text-muted-foreground italic">Sem acolhedor</span>
                    </label>
                    {allAcolhedores.map(name => (
                      <label
                        key={name}
                        className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-muted/60 cursor-pointer text-[11px]"
                      >
                        <Checkbox
                          checked={selectedAcolhedores.includes(name)}
                          onCheckedChange={() => toggleAcolhedor(name)}
                        />
                        <span className="truncate">{name}</span>
                      </label>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              {!noAcolhedorFilter && selectedAcolhedores.map(s => (
                <Badge key={s} variant="secondary" className="text-[10px] gap-1 pr-1 h-6">
                  {s === "__none__" ? "sem acolhedor" : s}
                  <button
                    type="button"
                    onClick={() => toggleAcolhedor(s)}
                    className="hover:bg-muted-foreground/20 rounded-sm p-0.5"
                    aria-label={`Remover ${s}`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </Badge>
              ))}
              {filterPending && (
                <span className="text-[10px] text-muted-foreground italic">
                  Carregando planilha…
                </span>
              )}
              {!noAcolhedorFilter && !filterPending && bpcFilter.phoneKeys && bpcFilter.validPhoneCount === 0 && (
                <span className="text-[10px] text-amber-600">
                  Nenhum telefone válido pra esses acolhedores
                </span>
              )}
            </div>

            <StageFunnelChart board={board} leadsPerStage={stageData} dateFilter={dateFilter} boardType={boardType} viewMode="funil" />

            <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold flex items-center gap-1.5">
                  <LayoutGrid className="h-3.5 w-3.5 text-primary" />
                  {sheetCfg?.panelTitle ?? "Painel detalhado"}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                  Tabela completa + métricas da planilha.
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
          <StageFunnelChart board={board} leadsPerStage={stageData} dateFilter={dateFilter} boardType={boardType} viewMode="funil" />
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
                      <span className="text-[10px] text-muted-foreground">({stageData[stage.id] || 0} {unitLabel})</span>
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
            Nenhum objetivo configurado para este {typeLabel}
          </div>
        )}

        {acoes}
      </CardContent>

      <WorkflowVisualizationDialog
        board={board}
        open={showVisualization}
        onOpenChange={setShowVisualization}
        onEdit={onEdit}
      />
    </Card>
  );
}
