import { useEffect, useMemo, useState } from 'react';
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
    const data = stages.map((stage, index) => {
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
    const maxValue = Math.max(...data.map((s) => s.value), 1);
    return data.map((stage) => ({ ...stage, maxValue }));
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
      <CardContent className="pt-2 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex items-stretch gap-2 h-64 px-2">
            {funnelData.map((stage) => {
              const clickable = stage.value > 0;
              const pct = Math.round((stage.value / stage.maxValue) * 100);
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
                    "flex flex-col items-center gap-1 flex-1 min-w-0 h-full",
                    clickable ? "cursor-pointer" : "opacity-50"
                  )}
                  onClick={handleClick}
                  title={clickable ? `Ver leads em "${stage.name}"` : undefined}
                >
                  <span className="text-[10px] font-semibold tabular-nums text-foreground">
                    {stage.value}
                  </span>
                  <div className="w-full flex-1 flex items-end rounded-t-md overflow-hidden bg-muted/40">
                    <div
                      className="w-full rounded-t-md transition-[height] duration-700 ease-out"
                      style={{
                        height: barsReady ? `${pct}%` : '0%',
                        backgroundColor: stage.color || '#3B82F6',
                        minHeight: barsReady && stage.value > 0 ? 4 : 0,
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground text-center leading-tight truncate w-full px-0.5">
                    {stage.name}
                  </span>
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
