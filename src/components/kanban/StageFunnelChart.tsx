import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { TrendingDown, TrendingUp, Filter, AlertTriangle, CheckCircle2, XCircle, Ban, Loader2, ShieldOff, PlayCircle } from 'lucide-react';
import { KanbanBoard } from '@/hooks/useKanbanBoards';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';

interface ConversionAlert {
  fromStage: string;
  toStage: string;
  currentRate: number;
  threshold: number;
  severity: 'warning' | 'critical';
}

interface StageFunnelChartProps {
  board: KanbanBoard;
  leadsPerStage: Record<string, number>;
  conversionAlerts?: ConversionAlert[];
}

type StatusFilter = 'closed' | 'refused' | 'inviavel' | 'blocked' | 'active' | 'stage';

export function StageFunnelChart({ board, leadsPerStage, conversionAlerts = [] }: StageFunnelChartProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<StatusFilter | null>(null);
  const [activeStageId, setActiveStageId] = useState<string | null>(null);
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null);

  // Fetch status counts for this board
  const { data: statusCounts } = useQuery({
    queryKey: ['funnel-status-counts', board.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('lead_status, is_blocked')
        .eq('board_id', board.id);
      if (error) throw error;
      const counts = { closed: 0, refused: 0, inviavel: 0, blocked: 0, active: 0 };
      for (const l of data || []) {
        if ((l as any).is_blocked) { counts.blocked++; continue; }
        if (l.lead_status === 'closed') counts.closed++;
        else if (l.lead_status === 'refused') counts.refused++;
        else if (l.lead_status === 'inviavel') counts.inviavel++;
        else if (l.lead_status === 'active' || !l.lead_status) counts.active++;
      }
      return counts;
    },
  });

  // Fetch leads for side sheet
  const { data: sheetLeads, isLoading: sheetLoading } = useQuery({
    queryKey: ['funnel-sheet-leads', board.id, activeFilter, activeStageId],
    queryFn: async () => {
      let query = supabase
        .from('leads')
        .select('id, lead_name, created_at, lead_status, status')
        .eq('board_id', board.id)
        .order('created_at', { ascending: false });

      if (activeFilter === 'stage' && activeStageId) {
        query = query.eq('status', activeStageId);
      } else if (activeFilter === 'blocked') {
        query = query.eq('is_blocked' as any, true);
      } else if (activeFilter === 'active') {
        query = query.or('lead_status.eq.active,lead_status.is.null').eq('is_blocked' as any, false);
      } else if (activeFilter) {
        query = query.eq('lead_status', activeFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: sheetOpen && !!activeFilter,
  });

  // Fetch full lead for edit dialog
  const { data: editingLead } = useQuery({
    queryKey: ['lead-for-edit', editingLeadId],
    queryFn: async () => {
      if (!editingLeadId) return null;
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('id', editingLeadId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!editingLeadId,
  });

  const funnelData = useMemo(() => {
    if (!board?.stages?.length) return [];

    const data = board.stages.map((stage, index) => {
      const count = leadsPerStage[stage.id] || 0;
      const previousCount = index > 0 
        ? (leadsPerStage[board.stages[index - 1].id] || 0) 
        : count;
      
      const conversionRate = previousCount > 0 
        ? Math.round((count / previousCount) * 100) 
        : 100;
      
      const dropOffRate = previousCount > 0 
        ? Math.round(((previousCount - count) / previousCount) * 100) 
        : 0;

      return {
        id: stage.id,
        name: stage.name,
        value: count,
        color: stage.color,
        conversionRate,
        dropOffRate,
        isFirst: index === 0,
        previousCount
      };
    });

    return data;
  }, [board, leadsPerStage]);

  const maxValue = useMemo(() => Math.max(...funnelData.map(s => s.value), 1), [funnelData]);
  const totalLeads = funnelData[0]?.value || 0;
  const overallConversion = totalLeads > 0 && statusCounts
    ? Math.round((statusCounts.closed / totalLeads) * 100) 
    : 0;

  const openSheet = (filter: StatusFilter, stageId?: string) => {
    setActiveFilter(filter);
    setActiveStageId(stageId || null);
    setSheetOpen(true);
  };

  const getSheetTitle = () => {
    if (activeFilter === 'closed') return 'Leads Fechados';
    if (activeFilter === 'refused') return 'Leads Recusados';
    if (activeFilter === 'inviavel') return 'Leads Inviáveis';
    if (activeFilter === 'stage' && activeStageId) {
      const stage = board.stages?.find(s => s.id === activeStageId);
      return `Leads em: ${stage?.name || activeStageId}`;
    }
    return 'Leads';
  };

  if (!board?.stages?.length) {
    return null;
  }

  return (
    <>
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm font-medium">Funil de Conversão</CardTitle>
            </div>
            <Badge variant="outline" className="text-xs">
              {overallConversion}% conversão total
            </Badge>
          </div>
          <CardDescription className="text-xs">
            Visualização do fluxo de leads entre estágios
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-2 space-y-3">
          {/* Unified funnel rows */}
          <div className="space-y-1.5">
            {funnelData.map((stage, index) => {
              const widthPercent = Math.max(12, (stage.value / maxValue) * 100);
              const hasAlert = index > 0 && conversionAlerts.some(
                a => a.fromStage === funnelData[index - 1].name && a.toStage === stage.name
              );

              return (
                <div key={stage.name}>
                  {/* Drop-off between stages */}
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

                  {/* Stage row - clickable */}
                  <div
                    className={cn(
                      "flex items-center gap-3 p-1.5 rounded-lg transition-colors cursor-pointer",
                      hasAlert ? "bg-destructive/5" : "hover:bg-muted/30"
                    )}
                    onClick={() => openSheet('stage', stage.id)}
                  >
                    {/* Bar */}
                    <div className="flex-1 min-w-0">
                      <div
                        className="h-8 rounded-md flex items-center justify-between px-2.5 transition-all duration-300"
                        style={{
                          backgroundColor: stage.color,
                          width: `${widthPercent}%`,
                        }}
                      >
                        <span className="text-white text-[11px] font-medium truncate mr-1">
                          {stage.name}
                        </span>
                        <span className="text-white text-xs font-bold shrink-0">
                          {stage.value}
                        </span>
                      </div>
                    </div>

                    {/* Conversion badge */}
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

          {/* Summary - Fechados, Recusados, Inviáveis */}
          <div className="grid grid-cols-3 gap-2 text-center pt-2 border-t border-border/50">
            <div
              className="p-2 rounded-md bg-green-500/10 cursor-pointer hover:bg-green-500/20 transition-colors"
              onClick={() => openSheet('closed')}
            >
              <div className="flex items-center justify-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                <span className="text-lg font-bold text-green-600">{statusCounts?.closed || 0}</span>
              </div>
              <div className="text-[10px] text-muted-foreground">Fechados</div>
            </div>
            <div
              className="p-2 rounded-md bg-destructive/10 cursor-pointer hover:bg-destructive/20 transition-colors"
              onClick={() => openSheet('refused')}
            >
              <div className="flex items-center justify-center gap-1">
                <XCircle className="h-3.5 w-3.5 text-destructive" />
                <span className="text-lg font-bold text-destructive">{statusCounts?.refused || 0}</span>
              </div>
              <div className="text-[10px] text-muted-foreground">Recusados</div>
            </div>
            <div
              className="p-2 rounded-md bg-orange-500/10 cursor-pointer hover:bg-orange-500/20 transition-colors"
              onClick={() => openSheet('inviavel')}
            >
              <div className="flex items-center justify-center gap-1">
                <Ban className="h-3.5 w-3.5 text-orange-600" />
                <span className="text-lg font-bold text-orange-600">{statusCounts?.inviavel || 0}</span>
              </div>
              <div className="text-[10px] text-muted-foreground">Inviáveis</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Side sheet with lead list */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-[400px] sm:w-[450px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{getSheetTitle()}</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {sheetLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
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

      {/* Lead edit dialog */}
      {editingLead && (
        <LeadEditDialog
          open={!!editingLeadId}
          onOpenChange={(open) => { if (!open) setEditingLeadId(null); }}
          lead={editingLead as any}
          onSave={async () => setEditingLeadId(null)}
        />
      )}
    </>
  );
}
