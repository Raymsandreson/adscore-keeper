import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Filter, Loader2 } from 'lucide-react';
import { KanbanBoard } from '@/hooks/useKanbanBoards';
import { BpcMetrics } from '@/hooks/useBpcFormLeads';
import { cn } from '@/lib/utils';

interface BpcFunnelBarsProps {
  board: KanbanBoard;
  metrics: BpcMetrics;
  loading?: boolean;
  /** Abre a listagem completa (BpcFormLeadsSheet). */
  onOpenList: () => void;
  /** Abre a listagem filtrada por etapa específica. */
  onSelectStage?: (stage: { id: string; name: string; color: string }) => void;
  /**
   * Contagem real de leads (tabela `leads`) por etapa do board.
   * Quando presente, sobrepõe a heurística antiga "tudo na primeira etapa"
   * — assim toda movimentação no Kanban (ou via etiqueta WhatsApp) se reflete
   * imediatamente nas barras. A primeira etapa ainda absorve o residual da
   * planilha BASE_UNIFICADA que nunca foi importado pra `leads`.
   */
  leadsPerStage?: Record<string, number>;
}

// Funil BPC - Autismo: a barra base de leads vem da planilha BASE_UNIFICADA
// (cat_leads), mas a partir do momento que cada lead é tocado no Kanban /
// recebe etiqueta no WhatsApp ele passa a viver na tabela `leads`. Para refletir
// isso, somamos: contagem real da `leads.status = stage.id` + residual da
// planilha (apenas na primeira etapa, descontando o que já saiu pra `leads`).
export function BpcFunnelBars({ board, metrics, loading, onOpenList, onSelectStage, leadsPerStage }: BpcFunnelBarsProps) {
  const stages = useMemo(() => board.stages || [], [board.stages]);

  const funnelData = useMemo(() => {
    const firstId = stages.find((s) => s.id === 'new')?.id ?? stages[0]?.id;
    const counts = leadsPerStage || {};
    const movedTotal = Object.values(counts).reduce((sum, n) => sum + (Number(n) || 0), 0);
    const residualFirst = Math.max(0, metrics.total - movedTotal);
    return stages.map((stage, index) => {
      const realCount = Number(counts[stage.id] || 0);
      const value = stage.id === firstId ? realCount + residualFirst : realCount;
      return {
        id: stage.id,
        name: stage.name,
        color: stage.color,
        value,
        isFirst: index === 0,
      };
    });
  }, [stages, metrics.total, leadsPerStage]);

  

  if (!stages.length) return null;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-medium">Funil de Conversão</CardTitle>
          </div>
          <Badge variant="outline" className="text-xs">{metrics.total} leads</Badge>
        </div>
        <CardDescription className="text-xs">
          Leads da planilha BPC-LOAS (BASE_UNIFICADA)
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-2 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-1.5">
            {funnelData.map((stage) => {
              const widthPercent = Math.max(12, (stage.value / maxValue) * 100);
              const clickable = stage.value > 0;
              const handleClick = clickable
                ? () => {
                    if (onSelectStage) {
                      onSelectStage({ id: stage.id, name: stage.name, color: stage.color });
                    } else {
                      onOpenList();
                    }
                  }
                : undefined;
              return (
                <div
                  key={stage.id}
                  className={cn(
                    "flex items-center gap-3 p-1.5 rounded-lg transition-colors",
                    clickable ? "cursor-pointer hover:bg-muted/30" : "opacity-50"
                  )}
                  onClick={handleClick}
                  title={clickable ? `Ver leads em "${stage.name}"` : undefined}
                >
                  <div className="flex-1 min-w-0">
                    <div
                      className="h-8 rounded-md flex items-center justify-between px-2.5 transition-all duration-300 w-full"
                      style={{ backgroundColor: stage.color }}
                    >
                      <span className="text-white text-[11px] font-medium mr-1">{stage.name}</span>
                      <span className="text-white text-xs font-bold shrink-0">{stage.value}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Resumo BPC — clica pra abrir a listagem completa */}
        <div className="grid grid-cols-4 gap-2 text-center pt-2 border-t border-border/50">
          <div
            className="p-2 rounded-md bg-primary/10 cursor-pointer hover:bg-primary/20 transition-colors"
            onClick={onOpenList}
          >
            <div className="text-lg font-bold text-primary">{metrics.total}</div>
            <div className="text-[10px] text-muted-foreground">Total</div>
          </div>
          <div
            className="p-2 rounded-md bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors"
            onClick={onOpenList}
          >
            <div className="text-lg font-bold text-red-600">{metrics.toCallNow}</div>
            <div className="text-[10px] text-muted-foreground">📞 A ligar</div>
          </div>
          <div
            className="p-2 rounded-md bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors"
            onClick={onOpenList}
          >
            <div className="text-lg font-bold text-emerald-600">{metrics.alreadyOnWhatsApp}</div>
            <div className="text-[10px] text-muted-foreground">💬 No WA</div>
          </div>
          <div
            className="p-2 rounded-md bg-amber-500/10 cursor-pointer hover:bg-amber-500/20 transition-colors"
            onClick={onOpenList}
          >
            <div className="text-lg font-bold text-amber-600">{metrics.unviable}</div>
            <div className="text-[10px] text-muted-foreground">⚠️ Inviável</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
