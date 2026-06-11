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
}

// Funil BPC - Autismo: os leads vêm da planilha BASE_UNIFICADA e não têm
// classificação de etapa (status_funil vazio), então TODOS entram na primeira
// etapa ("Novo"). A movimentação entre etapas acontece depois, dentro do sistema.
// Visual de barras espelha o StageFunnelChart pra ficar igual aos demais funis,
// mas sem as queries na tabela `leads` (que está vazia pra este board).
export function BpcFunnelBars({ board, metrics, loading, onOpenList }: BpcFunnelBarsProps) {
  const stages = useMemo(() => board.stages || [], [board.stages]);

  const funnelData = useMemo(() => {
    const firstId = stages.find((s) => s.id === 'new')?.id ?? stages[0]?.id;
    return stages.map((stage, index) => ({
      id: stage.id,
      name: stage.name,
      color: stage.color,
      value: stage.id === firstId ? metrics.total : 0,
      isFirst: index === 0,
    }));
  }, [stages, metrics.total]);

  const maxValue = useMemo(() => Math.max(...funnelData.map((s) => s.value), 1), [funnelData]);

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
              return (
                <div
                  key={stage.id}
                  className={cn(
                    "flex items-center gap-3 p-1.5 rounded-lg transition-colors",
                    clickable ? "cursor-pointer hover:bg-muted/30" : "opacity-50"
                  )}
                  onClick={clickable ? onOpenList : undefined}
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
