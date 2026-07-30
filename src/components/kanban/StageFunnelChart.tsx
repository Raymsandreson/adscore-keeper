import { useMemo, useState, lazy, Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { TrendingDown, TrendingUp, Filter, AlertTriangle, CheckCircle2, XCircle, Ban, Loader2, ShieldOff, PlayCircle, Target } from 'lucide-react';
import { KanbanBoard } from '@/hooks/useKanbanBoards';
import { cn } from '@/lib/utils';
import { db } from '@/integrations/supabase';
import { useQuery } from '@tanstack/react-query';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import type { LeadProcess } from '@/hooks/useLeadProcesses';

const ProcessDetailSheet = lazy(() => import('@/components/cases/ProcessDetailSheet'));

interface ConversionAlert {
  fromStage: string;
  toStage: string;
  currentRate: number;
  threshold: number;
  severity: 'warning' | 'critical';
}

/** Como as fases são desenhadas. Lista é o padrão — o funil polui o card. */
export type BoardViewMode = 'lista' | 'grade' | 'funil';

interface StageFunnelChartProps {
  board: KanbanBoard;
  /** Contagem por fase. Ignorado quando boardType='workflow' (POP conta processo). */
  leadsPerStage: Record<string, number>;
  conversionAlerts?: ConversionAlert[];
  dateFilter?: { field: "created_at" | "updated_at"; from: string | null; to: string | null };
  /**
   * Funil (comercial) conta LEAD e usa o vocabulário de lead_status.
   * POP (processual) conta PROCESSO e usa os resultados cadastrados no próprio
   * POP (kanban_boards.settings.resultados).
   */
  boardType?: 'funnel' | 'workflow';
  viewMode?: BoardViewMode;
}

type StatusFilter = 'closed' | 'refused' | 'inviavel' | 'cancelled' | 'blocked' | 'active' | 'stage' | string;

interface PopResultado {
  id: string;
  label: string;
  marco?: string | null;
}

interface SummaryTile {
  key: string;
  label: string;
  count: number;
  /** classes tailwind: [fundo, hover, texto] */
  tone: [string, string, string];
  icon: typeof CheckCircle2;
  /** resultado esperado do POP (= sucesso) */
  expected?: boolean;
}

const PAGE = 1000;

export function StageFunnelChart({
  board,
  leadsPerStage,
  conversionAlerts = [],
  dateFilter,
  boardType = 'funnel',
  viewMode = 'funil',
}: StageFunnelChartProps) {
  const isPop = boardType === 'workflow';
  const unit = isPop ? 'processos' : 'leads';
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<StatusFilter | null>(null);
  const [activeStageId, setActiveStageId] = useState<string | null>(null);
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null);
  const [selectedProcess, setSelectedProcess] = useState<LeadProcess | null>(null);

  // ─── Vocabulário de resultado do POP (cadastrado no próprio POP) ───
  const popConfig = useMemo(() => {
    if (!isPop) return null;
    const s = (board as unknown as { settings?: {
      resultados?: PopResultado[];
      resultado_esperado_ids?: string[] | null;
      resultado_esperado_id?: string | null;
    } }).settings;
    const resultados = Array.isArray(s?.resultados) ? s!.resultados! : [];
    const esperados = new Set<string>([
      ...(Array.isArray(s?.resultado_esperado_ids) ? s!.resultado_esperado_ids! : []),
      ...(s?.resultado_esperado_id ? [s.resultado_esperado_id] : []),
    ]);
    return { resultados, esperados };
  }, [board, isPop]);

  // ─── Funil: contagem por lead_status (Externo) ───
  const { data: leadStatusCounts } = useQuery({
    queryKey: ['funnel-status-counts', board.id, dateFilter],
    queryFn: async () => {
      const counts = { closed: 0, refused: 0, inviavel: 0, cancelled: 0, blocked: 0, active: 0 };
      const isOpenLeadStatus = (status?: string | null) =>
        !status || ['no_response', 'in_progress', 'active', 'novo', 'new', 'open'].includes(status);
      for (let from = 0; ; from += PAGE) {
        let q = db
          .from('leads')
          .select('lead_status, is_blocked')
          .eq('board_id', board.id)
          .range(from, from + PAGE - 1);
        if (dateFilter?.from) q = q.gte(dateFilter.field, dateFilter.from);
        if (dateFilter?.to) q = q.lte(dateFilter.field, dateFilter.to);
        const { data, error } = await q;
        if (error) throw error;
        const rows = (data || []) as Array<{ lead_status: string | null; is_blocked: boolean | null }>;
        for (const l of rows) {
          if (l.is_blocked) { counts.blocked++; continue; }
          if (l.lead_status === 'closed') counts.closed++;
          else if (l.lead_status === 'refused') counts.refused++;
          else if (l.lead_status === 'inviavel') counts.inviavel++;
          else if (l.lead_status === 'cancelled') counts.cancelled++;
          else if (isOpenLeadStatus(l.lead_status)) counts.active++;
        }
        if (rows.length < PAGE) break;
      }
      return counts;
    },
    enabled: !isPop,
  });

  // ─── POP: contagem por resultado atingido e por fase, em cima de processo ───
  const { data: popData } = useQuery({
    queryKey: ['pop-process-counts', board.id, dateFilter],
    queryFn: async () => {
      const byResultado: Record<string, number> = {};
      const byStage: Record<string, number> = {};
      let semResultado = 0;
      let total = 0;
      for (let from = 0; ; from += PAGE) {
        let q = db
          .from('lead_processes')
          .select('resultado_atingido_id, workflow_stage_id')
          .eq('workflow_id', board.id)
          .is('deleted_at', null)
          .range(from, from + PAGE - 1);
        if (dateFilter?.from) q = q.gte(dateFilter.field, dateFilter.from);
        if (dateFilter?.to) q = q.lte(dateFilter.field, dateFilter.to);
        const { data, error } = await q;
        if (error) throw error;
        const rows = (data || []) as Array<{ resultado_atingido_id: string | null; workflow_stage_id: string | null }>;
        for (const p of rows) {
          total++;
          if (p.resultado_atingido_id) byResultado[p.resultado_atingido_id] = (byResultado[p.resultado_atingido_id] || 0) + 1;
          else semResultado++;
          if (p.workflow_stage_id) byStage[p.workflow_stage_id] = (byStage[p.workflow_stage_id] || 0) + 1;
        }
        if (rows.length < PAGE) break;
      }
      return { byResultado, byStage, semResultado, total };
    },
    enabled: isPop,
  });

  // ─── Lista de status exibida no rodapé ───
  const summaryTiles = useMemo<SummaryTile[]>(() => {
    if (isPop) {
      const tiles: SummaryTile[] = [{
        key: 'sem_resultado',
        label: 'Em andamento',
        count: popData?.semResultado || 0,
        tone: ['bg-primary/10', 'hover:bg-primary/20', 'text-primary'],
        icon: PlayCircle,
      }];
      for (const r of popConfig?.resultados || []) {
        const expected = popConfig?.esperados.has(r.id);
        tiles.push({
          key: r.id,
          label: r.label,
          count: popData?.byResultado[r.id] || 0,
          tone: expected
            ? ['bg-green-500/10', 'hover:bg-green-500/20', 'text-green-600']
            : ['bg-muted', 'hover:bg-muted/80', 'text-muted-foreground'],
          icon: expected ? CheckCircle2 : XCircle,
          expected,
        });
      }
      return tiles;
    }
    return [
      { key: 'active', label: 'Andamento', count: leadStatusCounts?.active || 0, tone: ['bg-primary/10', 'hover:bg-primary/20', 'text-primary'], icon: PlayCircle },
      { key: 'closed', label: 'Fechados', count: leadStatusCounts?.closed || 0, tone: ['bg-green-500/10', 'hover:bg-green-500/20', 'text-green-600'], icon: CheckCircle2 },
      { key: 'refused', label: 'Recusados', count: leadStatusCounts?.refused || 0, tone: ['bg-destructive/10', 'hover:bg-destructive/20', 'text-destructive'], icon: XCircle },
      { key: 'inviavel', label: 'Inviáveis', count: leadStatusCounts?.inviavel || 0, tone: ['bg-orange-500/10', 'hover:bg-orange-500/20', 'text-orange-600'], icon: Ban },
      { key: 'cancelled', label: 'Cancelamentos', count: leadStatusCounts?.cancelled || 0, tone: ['bg-purple-500/10', 'hover:bg-purple-500/20', 'text-purple-600'], icon: Ban },
      { key: 'blocked', label: 'Bloqueados', count: leadStatusCounts?.blocked || 0, tone: ['bg-muted', 'hover:bg-muted/80', 'text-muted-foreground'], icon: ShieldOff },
    ];
  }, [isPop, popConfig, popData, leadStatusCounts]);

  /** POP sem nenhum resultado preenchido: dizer isso é mais útil que um mural de zeros. */
  const popSemResultadoAlgum = isPop && !!popData && popData.total > 0
    && Object.keys(popData.byResultado).length === 0;
  const popSemFaseAlguma = isPop && !!popData && popData.total > 0
    && Object.keys(popData.byStage).length === 0;

  // ─── Drill-down ───
  const { data: sheetLeads, isLoading: sheetLoading } = useQuery({
    queryKey: ['funnel-sheet-leads', board.id, activeFilter, activeStageId, dateFilter],
    queryFn: async () => {
      let query = db
        .from('leads')
        .select('id, lead_name, created_at, lead_status, status')
        .eq('board_id', board.id)
        .order('created_at', { ascending: false });

      if (activeFilter === 'stage' && activeStageId) {
        query = query.eq('status', activeStageId);
      } else if (activeFilter === 'blocked') {
        query = query.eq('is_blocked', true);
      } else if (activeFilter === 'active') {
        query = query.in('lead_status', ['no_response', 'in_progress', 'active', 'novo', 'new', 'open']).eq('is_blocked', false);
      } else if (activeFilter) {
        query = query.eq('lead_status', activeFilter);
      }

      if (dateFilter?.from) query = query.gte(dateFilter.field, dateFilter.from);
      if (dateFilter?.to) query = query.lte(dateFilter.field, dateFilter.to);

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: sheetOpen && !!activeFilter && !isPop,
  });

  const { data: sheetProcesses, isLoading: sheetProcLoading } = useQuery({
    queryKey: ['pop-sheet-processes', board.id, activeFilter, activeStageId, dateFilter],
    queryFn: async () => {
      let query = db
        .from('lead_processes')
        .select('*')
        .eq('workflow_id', board.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (activeFilter === 'stage' && activeStageId) {
        query = query.eq('workflow_stage_id', activeStageId);
      } else if (activeFilter === 'sem_resultado') {
        query = query.is('resultado_atingido_id', null);
      } else if (activeFilter) {
        query = query.eq('resultado_atingido_id', activeFilter);
      }

      if (dateFilter?.from) query = query.gte(dateFilter.field, dateFilter.from);
      if (dateFilter?.to) query = query.lte(dateFilter.field, dateFilter.to);

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as LeadProcess[];
    },
    enabled: sheetOpen && !!activeFilter && isPop,
  });

  const { data: editingLead } = useQuery({
    queryKey: ['lead-for-edit', editingLeadId],
    queryFn: async () => {
      if (!editingLeadId) return null;
      const { data, error } = await db.from('leads').select('*').eq('id', editingLeadId).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!editingLeadId,
  });

  // ─── Fases ───
  const stageCounts = useMemo(
    () => (isPop ? (popData?.byStage || {}) : leadsPerStage),
    [isPop, popData, leadsPerStage],
  );

  const funnelData = useMemo(() => {
    if (!board?.stages?.length) return [];
    return board.stages.map((stage, index) => {
      const count = stageCounts[stage.id] || 0;
      const previousCount = index > 0 ? (stageCounts[board.stages[index - 1].id] || 0) : count;
      const conversionRate = previousCount > 0 ? Math.round((count / previousCount) * 100) : 100;
      const dropOffRate = previousCount > 0 ? Math.round(((previousCount - count) / previousCount) * 100) : 0;
      return {
        id: stage.id, name: stage.name, value: count, color: stage.color,
        conversionRate, dropOffRate, isFirst: index === 0, previousCount,
      };
    });
  }, [board, stageCounts]);

  const maxValue = useMemo(() => Math.max(...funnelData.map(s => s.value), 1), [funnelData]);
  const totalStageItems = funnelData.reduce((s, f) => s + f.value, 0);

  const overallConversion = useMemo(() => {
    if (isPop) {
      const total = popData?.total || 0;
      if (!total || !popConfig) return 0;
      let atingidos = 0;
      for (const id of popConfig.esperados) atingidos += popData?.byResultado[id] || 0;
      return Math.round((atingidos / total) * 100);
    }
    const base = funnelData[0]?.value || 0;
    return base > 0 && leadStatusCounts ? Math.round((leadStatusCounts.closed / base) * 100) : 0;
  }, [isPop, popData, popConfig, funnelData, leadStatusCounts]);

  const openSheet = (filter: StatusFilter, stageId?: string) => {
    setActiveFilter(filter);
    setActiveStageId(stageId || null);
    setSheetOpen(true);
  };

  const getSheetTitle = () => {
    if (activeFilter === 'stage' && activeStageId) {
      const stage = board.stages?.find(s => s.id === activeStageId);
      return `${isPop ? 'Processos' : 'Leads'} em: ${stage?.name || activeStageId}`;
    }
    const tile = summaryTiles.find(t => t.key === activeFilter);
    if (tile) return `${isPop ? 'Processos' : 'Leads'}: ${tile.label}`;
    return isPop ? 'Processos' : 'Leads';
  };

  if (!board?.stages?.length) return null;

  const titulo = isPop ? 'Andamento do POP' : 'Funil de Conversão';
  const subtitulo = isPop
    ? 'Processos por fase e por resultado cadastrado neste POP'
    : 'Visualização do fluxo de leads entre estágios';

  return (
    <>
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {isPop ? <Target className="h-4 w-4 text-primary shrink-0" /> : <Filter className="h-4 w-4 text-primary shrink-0" />}
              <CardTitle className="text-sm font-medium truncate">{titulo}</CardTitle>
            </div>
            <Badge variant="outline" className="text-xs shrink-0">
              {overallConversion}% {isPop ? 'no resultado esperado' : 'conversão total'}
            </Badge>
          </div>
          <CardDescription className="text-xs">{subtitulo}</CardDescription>
        </CardHeader>
        <CardContent className="pt-2 space-y-3">
          {/* ─── Fases ─── */}
          {popSemFaseAlguma ? (
            <p className="text-[11px] text-muted-foreground bg-muted/40 rounded-md p-2.5 leading-relaxed">
              Nenhum processo deste POP tem fase registrada ainda. A fase é definida na
              ficha do processo — enquanto isso, as etapas abaixo ficam zeradas.
            </p>
          ) : totalStageItems === 0 ? (
            <p className="text-[11px] text-muted-foreground bg-muted/40 rounded-md p-2.5">
              Nenhum {unit.slice(0, -1)} nas etapas deste quadro no período selecionado.
            </p>
          ) : viewMode === 'lista' ? (
            /* LISTA — compacta, sem barras coloridas grandes */
            <div className="space-y-1">
              {funnelData.map(stage => {
                const pct = totalStageItems > 0 ? Math.round((stage.value / totalStageItems) * 100) : 0;
                return (
                  <div
                    key={stage.id}
                    className="flex items-center gap-2.5 px-1.5 py-1 rounded-md hover:bg-muted/40 cursor-pointer transition-colors"
                    onClick={() => openSheet('stage', stage.id)}
                  >
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
                    <span className="text-xs flex-1 min-w-0 truncate">{stage.name}</span>
                    <Progress value={pct} className="h-1.5 w-16 shrink-0" />
                    <span className="text-xs font-semibold tabular-nums w-10 text-right shrink-0">{stage.value}</span>
                  </div>
                );
              })}
            </div>
          ) : viewMode === 'grade' ? (
            /* GRADE — blocos lado a lado */
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {funnelData.map(stage => (
                <div
                  key={stage.id}
                  className="rounded-md border p-2 cursor-pointer hover:bg-muted/40 transition-colors min-w-0"
                  onClick={() => openSheet('stage', stage.id)}
                >
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
                    <span className="text-[10px] text-muted-foreground truncate">{stage.name}</span>
                  </div>
                  <div className="text-lg font-bold tabular-nums mt-0.5">{stage.value}</div>
                </div>
              ))}
            </div>
          ) : (
            /* FUNIL — visualização original */
            <div className="space-y-1.5">
              {funnelData.map((stage, index) => {
                const widthPercent = Math.max(12, (stage.value / maxValue) * 100);
                const hasAlert = index > 0 && conversionAlerts.some(
                  a => a.fromStage === funnelData[index - 1].name && a.toStage === stage.name
                );
                return (
                  <div key={stage.id}>
                    {index > 0 && (
                      <div className="flex items-center justify-center py-0.5">
                        <span className={cn(
                          "text-[10px] flex items-center gap-0.5",
                          hasAlert ? "text-destructive font-medium" : stage.dropOffRate > 0 ? "text-muted-foreground" : "text-green-600"
                        )}>
                          {hasAlert && <AlertTriangle className="h-2.5 w-2.5" />}
                          {stage.dropOffRate > 0 ? (
                            <><TrendingDown className="h-2.5 w-2.5" /> -{stage.dropOffRate}%</>
                          ) : (
                            <><TrendingUp className="h-2.5 w-2.5" /> 0%</>
                          )}
                        </span>
                      </div>
                    )}
                    <div
                      className={cn(
                        "flex items-center gap-3 p-1.5 rounded-lg transition-colors cursor-pointer",
                        hasAlert ? "bg-destructive/5" : "hover:bg-muted/30"
                      )}
                      onClick={() => openSheet('stage', stage.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <div
                          className="h-8 rounded-md flex items-center justify-between px-2.5 transition-all duration-300"
                          style={{ backgroundColor: stage.color, width: `${widthPercent}%` }}
                        >
                          <span className="text-white text-[11px] font-medium truncate mr-1">{stage.name}</span>
                          <span className="text-white text-xs font-bold shrink-0">{stage.value}</span>
                        </div>
                      </div>
                      <div className="shrink-0 w-14 text-right">
                        {!stage.isFirst && (
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] px-1.5 font-mono",
                              hasAlert && "border-destructive/40 text-destructive",
                              !hasAlert && stage.conversionRate >= 50 && "border-green-500/40 text-green-600",
                            )}
                          >
                            {stage.conversionRate}%
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ─── Status: lead_status no funil, resultados cadastrados no POP ─── */}
          {isPop && !popConfig?.resultados.length ? (
            <p className="text-[11px] text-muted-foreground bg-muted/40 rounded-md p-2.5 leading-relaxed border-t border-border/50">
              Nenhum resultado cadastrado neste POP. Cadastre os resultados possíveis
              (ex.: Deferido, Acordo, Indeferido) em Editar → Resultados.
            </p>
          ) : (
            <div className="pt-2 border-t border-border/50 space-y-2">
              {popSemResultadoAlgum && (
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Nenhum processo com resultado registrado ainda — o resultado é preenchido
                  na ficha do processo, aba Resultado. Os {popData?.total} processos aparecem
                  como "Em andamento".
                </p>
              )}
              <div className={cn(
                "grid gap-2 text-center",
                summaryTiles.length <= 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3 sm:grid-cols-6"
              )}>
                {summaryTiles.map(tile => {
                  const Icon = tile.icon;
                  return (
                    <div
                      key={tile.key}
                      className={cn("p-2 rounded-md cursor-pointer transition-colors min-w-0", tile.tone[0], tile.tone[1])}
                      onClick={() => openSheet(tile.key)}
                      title={tile.expected ? `${tile.label} — resultado esperado` : tile.label}
                    >
                      <div className="flex items-center justify-center gap-1">
                        <Icon className={cn("h-3.5 w-3.5 shrink-0", tile.tone[2])} />
                        <span className={cn("text-lg font-bold tabular-nums", tile.tone[2])}>{tile.count}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {tile.expected && '✅ '}{tile.label}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Drill-down lateral */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-[400px] sm:w-[450px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{getSheetTitle()}</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {(isPop ? sheetProcLoading : sheetLoading) ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : isPop ? (
              !sheetProcesses?.length ? (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhum processo encontrado</p>
              ) : (
                sheetProcesses.map(p => (
                  <div
                    key={p.id}
                    className="p-3 rounded-lg border border-border/50 hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => setSelectedProcess(p)}
                  >
                    <span className="text-sm font-medium leading-snug">{p.title || 'Processo sem título'}</span>
                    {p.process_number && (
                      <div className="text-xs text-muted-foreground mt-1 font-mono">{p.process_number}</div>
                    )}
                    {p.started_at && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Início: {new Date(p.started_at).toLocaleDateString('pt-BR')}
                      </div>
                    )}
                  </div>
                ))
              )
            ) : !sheetLeads?.length ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhum lead encontrado</p>
            ) : (
              sheetLeads.map(lead => (
                <div
                  key={lead.id}
                  className="p-3 rounded-lg border border-border/50 hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => setEditingLeadId(lead.id)}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium truncate">{lead.lead_name}</span>
                    <Badge variant="outline" className="text-[10px] ml-2 shrink-0">
                      {lead.lead_status === 'closed' ? 'Fechado' :
                       lead.lead_status === 'refused' ? 'Recusado' :
                       lead.lead_status === 'inviavel' ? 'Inviável' :
                       lead.lead_status === 'cancelled' ? 'Cancelado' :
                       'Ativo'}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Criado: {new Date(lead.created_at).toLocaleDateString('pt-BR')}
                  </div>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      {editingLead && (
        <LeadEditDialog
          open={!!editingLeadId}
          onOpenChange={(open) => { if (!open) setEditingLeadId(null); }}
          lead={editingLead as never}
          onSave={async () => setEditingLeadId(null)}
        />
      )}

      <Suspense fallback={null}>
        {selectedProcess && (
          <ProcessDetailSheet
            open={!!selectedProcess}
            onOpenChange={(open) => { if (!open) setSelectedProcess(null); }}
            process={selectedProcess}
            mode="sheet"
          />
        )}
      </Suspense>
    </>
  );
}
