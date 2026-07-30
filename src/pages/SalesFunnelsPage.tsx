import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useKanbanBoards } from "@/hooks/useKanbanBoards";
import { Button } from "@/components/ui/button";
import { Filter, Settings } from "lucide-react";
import { BpcFormLeadsSheet } from "@/components/whatsapp/FocusDashboard/BpcFormLeadsSheet";
import { useBpcFormLeads } from "@/hooks/useBpcFormLeads";
import { useEnsureStageLabels } from "@/hooks/useEnsureStageLabels";
import { BoardsList } from "@/components/board/BoardsList";
import { hasFunnelSheet } from "@/lib/funnelSheetConfig";

const isBpcFunnel = (name: string) => hasFunnelSheet(name);

const SalesFunnelsPage = () => {
  const navigate = useNavigate();
  const { boards } = useKanbanBoards();
  const [bpcSheetOpen, setBpcSheetOpen] = useState(false);

  const salesFunnels = useMemo(
    () => boards.filter(b => b.board_type === 'funnel'),
    [boards]
  );

  // Espelha as etapas do Kanban como etiquetas WhatsApp (allowlist por nome).
  // Exclusivo do funil: é integração UazAPI, não funcionalidade de quadro.
  useEnsureStageLabels(salesFunnels);

  const hasBpc = useMemo(() => salesFunnels.some(b => isBpcFunnel(b.name)), [salesFunnels]);

  // Para o Sheet de listagem BPC (independente do filtro por card — usa janela ampla)
  const {
    leads: bpcLeads,
    metrics: bpcSheetMetrics,
    loading: bpcSheetLoading,
    refetch: bpcSheetRefetch,
  } = useBpcFormLeads({
    from: new Date("2020-01-01T00:00:00Z"),
    to: new Date(),
    enabled: hasBpc && bpcSheetOpen,
    source: "unificada",
  });

  return (
    <div className="container mx-auto py-6 px-4 max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Filter className="h-6 w-6 text-primary" />
            Funis de Vendas
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gerencie seus funis e acompanhe a conversão de leads
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/settings')}>
            <Settings className="h-4 w-4 mr-2" />
            Configurar
          </Button>
        </div>
      </div>

      <BoardsList boardType="funnel" />

      <BpcFormLeadsSheet
        open={bpcSheetOpen}
        onOpenChange={setBpcSheetOpen}
        source="unificada"
        externalLeads={bpcLeads}
        externalMetrics={bpcSheetMetrics}
        externalLoading={bpcSheetLoading}
        onRefresh={bpcSheetRefetch}
      />
    </div>
  );
};

export default SalesFunnelsPage;
