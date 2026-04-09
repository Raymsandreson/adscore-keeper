import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useKanbanBoards } from "@/hooks/useKanbanBoards";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, LayoutGrid, Users, ArrowRight, Settings, Filter, Maximize2, Minimize2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { StageFunnelChart } from "@/components/kanban/StageFunnelChart";

const SalesFunnelsPage = () => {
  const navigate = useNavigate();
  const { boards } = useKanbanBoards();
  const [search, setSearch] = useState("");

  const salesFunnels = useMemo(
    () => boards.filter(b => b.board_type === 'funnel'),
    [boards]
  );

  const filtered = useMemo(
    () => salesFunnels.filter(b =>
      b.name.toLowerCase().includes(search.toLowerCase())
    ),
    [salesFunnels, search]
  );

  // Fetch lead counts per board+stage
  const { data: leadCounts } = useQuery({
    queryKey: ['funnel-lead-counts', salesFunnels.map(b => b.id)],
    queryFn: async () => {
      if (!salesFunnels.length) return {};
      const boardIds = salesFunnels.map(b => b.id);
      const { data, error } = await supabase
        .from('leads')
        .select('board_id, status')
        .in('board_id', boardIds);
      if (error) throw error;

      const counts: Record<string, { total: number; byStage: Record<string, number> }> = {};
      for (const lead of data || []) {
        if (!counts[lead.board_id]) counts[lead.board_id] = { total: 0, byStage: {} };
        counts[lead.board_id].total++;
        counts[lead.board_id].byStage[lead.status] = (counts[lead.board_id].byStage[lead.status] || 0) + 1;
      }
      return counts;
    },
    enabled: salesFunnels.length > 0,
  });

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
        <Button variant="outline" size="sm" onClick={() => navigate('/settings')}>
          <Settings className="h-4 w-4 mr-2" />
          Configurar
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar funis..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
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
            <div className="text-2xl font-bold text-foreground">
              {Object.values(leadCounts || {}).reduce((sum, c) => sum + c.total, 0)}
            </div>
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
            <div className="text-2xl font-bold text-green-600">
              {salesFunnels.filter(b => (leadCounts?.[b.id]?.total || 0) > 0).length}
            </div>
            <div className="text-xs text-muted-foreground">Com Leads</div>
          </CardContent>
        </Card>
      </div>

      {/* Funnel list */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {search ? "Nenhum funil encontrado." : "Nenhum funil de vendas configurado."}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map(board => {
            const counts = leadCounts?.[board.id];
            const totalLeads = counts?.total || 0;
            const stageData = counts?.byStage || {};

            return (
              <Card
                key={board.id}
                className="border-border/50 hover:shadow-md transition-shadow cursor-pointer group"
                onClick={() => handleOpenKanban(board.id)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <LayoutGrid className="h-4 w-4 text-primary" />
                      {board.name}
                    </CardTitle>
                    <Badge variant="secondary" className="text-xs">
                      <Users className="h-3 w-3 mr-1" />
                      {totalLeads} leads
                    </Badge>
                  </div>
                  {board.description && (
                    <CardDescription className="text-xs line-clamp-1">
                      {board.description}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                  {/* Mini funnel visualization */}
                  <StageFunnelChart
                    board={board}
                    leadsPerStage={stageData}
                  />

                  {/* Action */}
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      Abrir Kanban
                      <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SalesFunnelsPage;
