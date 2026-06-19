import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useKanbanBoards } from "@/hooks/useKanbanBoards";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Filter, Settings, Plus } from "lucide-react";
import { db as supabase } from "@/integrations/supabase";
import { useQuery } from "@tanstack/react-query";
import { BpcFormLeadsSheet } from "@/components/whatsapp/FocusDashboard/BpcFormLeadsSheet";
import { useBpcFormLeads } from "@/hooks/useBpcFormLeads";
import { useEnsureStageLabels } from "@/hooks/useEnsureStageLabels";
import { WorkflowBuilder } from "@/components/workflow/WorkflowBuilder";
import { FunnelTeamDialog } from "@/components/funnel/FunnelTeamDialog";
import { FunnelBoardCard } from "@/components/funnel/FunnelBoardCard";

const isBpcFunnel = (name: string) => /bpc|autis/i.test(name);

const SalesFunnelsPage = () => {
  const navigate = useNavigate();
  const { boards, fetchBoards } = useKanbanBoards();
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editBoardId, setEditBoardId] = useState<string | null>(null);
  const [teamBoard, setTeamBoard] = useState<{ id: string; name: string } | null>(null);
  const [bpcSheetOpen, setBpcSheetOpen] = useState(false);

  const salesFunnels = useMemo(
    () => boards.filter(b => b.board_type === 'funnel'),
    [boards]
  );

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

  const filtered = useMemo(
    () => salesFunnels.filter(b =>
      b.name.toLowerCase().includes(search.toLowerCase())
    ),
    [salesFunnels, search]
  );

  // Sumário no topo: contagem total por board, SEM filtro de data (filtros agora são por card)
  const { data: totalsByBoard } = useQuery({
    queryKey: ['funnel-totals-by-board', salesFunnels.map(b => b.id)],
    queryFn: async () => {
      if (!salesFunnels.length) return {} as Record<string, number>;
      const boardIds = salesFunnels.map(b => b.id);
      // Conta exata por board via head+count (evita o cap de 1000 linhas do PostgREST).
      const entries = await Promise.all(
        boardIds.map(async (id) => {
          const { count, error } = await supabase
            .from('leads')
            .select('board_id', { count: 'exact', head: true })
            .eq('board_id', id);
          if (error) throw error;
          return [id, count || 0] as const;
        })
      );
      return Object.fromEntries(entries) as Record<string, number>;
    },
    enabled: salesFunnels.length > 0,
  });

  const totalLeads = useMemo(
    () => Object.values(totalsByBoard || {}).reduce((s, n) => s + n, 0),
    [totalsByBoard]
  );
  const boardsWithLeads = useMemo(
    () => salesFunnels.filter(b => (totalsByBoard?.[b.id] || 0) > 0).length,
    [salesFunnels, totalsByBoard]
  );

  const handleOpenKanban = (boardId: string) => {
    navigate(`/leads?board=${boardId}`);
  };

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
          <Button onClick={() => { setEditBoardId(null); setShowBuilder(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            Criar Funil
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/settings')}>
            <Settings className="h-4 w-4 mr-2" />
            Configurar
          </Button>
        </div>
      </div>

      {/* Busca (filtro de data agora é por card) */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar funis..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold text-primary">{salesFunnels.length}</div>
            <div className="text-xs text-muted-foreground">Funis Ativos</div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold text-foreground">{totalLeads}</div>
            <div className="text-xs text-muted-foreground">Total de Leads</div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold text-foreground">
              {salesFunnels.reduce((sum, b) => sum + (b.stages?.length || 0), 0)}
            </div>
            <div className="text-xs text-muted-foreground">Etapas Total</div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold text-primary">{boardsWithLeads}</div>
            <div className="text-xs text-muted-foreground">Com Leads</div>
          </CardContent>
        </Card>
      </div>

      {/* Funnel list */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground space-y-3">
          <p>{search ? "Nenhum funil encontrado." : "Nenhum funil de vendas configurado."}</p>
          {!search && (
            <Button onClick={() => { setEditBoardId(null); setShowBuilder(true); }}>
              <Plus className="h-4 w-4 mr-2" />
              Criar Primeiro Funil
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map(board => (
            <FunnelBoardCard
              key={board.id}
              board={board}
              expanded={expandedId === board.id}
              onToggleExpand={() => setExpandedId(expandedId === board.id ? null : board.id)}
              onOpenKanban={() => handleOpenKanban(board.id)}
              onOpenTeam={() => setTeamBoard({ id: board.id, name: board.name })}
              onEdit={() => { setEditBoardId(board.id); setShowBuilder(true); }}
              onOpenBpcSheet={() => setBpcSheetOpen(true)}
            />
          ))}
        </div>
      )}

      <WorkflowBuilder
        open={showBuilder}
        onOpenChange={setShowBuilder}
        onWorkflowSaved={() => fetchBoards()}
        initialEditBoardId={editBoardId}
        initialCreateNew={!editBoardId}
        boardType="funnel"
      />

      {teamBoard && (
        <FunnelTeamDialog
          open={!!teamBoard}
          onOpenChange={(o) => !o && setTeamBoard(null)}
          boardId={teamBoard.id}
          boardName={teamBoard.name}
        />
      )}

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
