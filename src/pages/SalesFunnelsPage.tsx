import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useKanbanBoards } from "@/hooks/useKanbanBoards";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, LayoutGrid, Users, ArrowRight, Settings, Filter, Maximize2, Minimize2, Target, CheckCircle2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { StageFunnelChart } from "@/components/kanban/StageFunnelChart";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { WorkflowBuilder } from "@/components/workflow/WorkflowBuilder";

interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
}

const SalesFunnelsPage = () => {
  const navigate = useNavigate();
  const { boards, fetchBoards } = useKanbanBoards();
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editBoardId, setEditBoardId] = useState<string | null>(null);

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

  // Fetch objective (checklist) data for expanded board
  const { data: objectiveData } = useQuery({
    queryKey: ['funnel-objectives', expandedId],
    queryFn: async () => {
      if (!expandedId) return null;

      // Get checklist stage links for this board
      const { data: links } = await supabase
        .from('checklist_stage_links')
        .select('stage_id, checklist_template_id, display_order')
        .eq('board_id', expandedId)
        .order('display_order');

      if (!links?.length) return null;

      const templateIds = [...new Set(links.map(l => l.checklist_template_id))];

      // Get template names
      const { data: templates } = await supabase
        .from('checklist_templates')
        .select('id, name')
        .in('id', templateIds);

      // Get checklist instances for all leads in this board
      const { data: instances } = await supabase
        .from('lead_checklist_instances')
        .select('checklist_template_id, stage_id, items, is_completed')
        .eq('board_id', expandedId);

      const templateMap = new Map(templates?.map(t => [t.id, t.name]) || []);

      // Group by stage -> template
      const result: Record<string, { templateId: string; templateName: string; totalItems: number; completedItems: number; totalInstances: number; completedInstances: number }[]> = {};

      for (const link of links) {
        if (!result[link.stage_id]) result[link.stage_id] = [];

        const relatedInstances = instances?.filter(
          i => i.checklist_template_id === link.checklist_template_id && i.stage_id === link.stage_id
        ) || [];

        let totalItems = 0;
        let completedItems = 0;

        for (const inst of relatedInstances) {
          const items = (inst.items as unknown as ChecklistItem[]) || [];
          totalItems += items.length;
          completedItems += items.filter(item => item.checked).length;
        }

        result[link.stage_id].push({
          templateId: link.checklist_template_id,
          templateName: templateMap.get(link.checklist_template_id) || 'Objetivo',
          totalItems,
          completedItems,
          totalInstances: relatedInstances.length,
          completedInstances: relatedInstances.filter(i => i.is_completed).length,
        });
      }

      return result;
    },
    enabled: !!expandedId,
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
            <div className="text-2xl font-bold text-primary">
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
            const isExpanded = expandedId === board.id;
            const boardObjectives = isExpanded ? objectiveData : null;

            return (
              <Card
                key={board.id}
                className={cn(
                  "border-border/50 hover:shadow-md transition-all group",
                  isExpanded && 'lg:col-span-2'
                )}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <LayoutGrid className="h-4 w-4 text-primary" />
                      {board.name}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">
                        <Users className="h-3 w-3 mr-1" />
                        {totalLeads} leads
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setExpandedId(isExpanded ? null : board.id)}
                        title={isExpanded ? "Reduzir" : "Expandir"}
                      >
                        {isExpanded ? (
                          <Minimize2 className="h-4 w-4" />
                        ) : (
                          <Maximize2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
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

                  {/* Objectives detail when expanded */}
                  {isExpanded && boardObjectives && board.stages?.length > 0 && (
                    <div className="border-t border-border/50 pt-3 space-y-3">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Target className="h-4 w-4 text-primary" />
                        Detalhamento por Objetivo
                      </div>
                      <div className="space-y-3">
                        {board.stages.map(stage => {
                          const stageObjectives = boardObjectives[stage.id];
                          if (!stageObjectives?.length) return null;

                          return (
                            <div key={stage.id} className="space-y-1.5">
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: stage.color }}
                                />
                                <span className="text-xs font-medium text-foreground">{stage.name}</span>
                                <span className="text-[10px] text-muted-foreground">
                                  ({stageData[stage.id] || 0} leads)
                                </span>
                              </div>
                              <div className="ml-5 space-y-1.5">
                                {stageObjectives.map(obj => {
                                  const pct = obj.totalItems > 0
                                    ? Math.round((obj.completedItems / obj.totalItems) * 100)
                                    : 0;

                                  return (
                                    <div key={obj.templateId} className="flex items-center gap-3 p-2 rounded-md bg-muted/30">
                                      <CheckCircle2 className={cn(
                                        "h-3.5 w-3.5 shrink-0",
                                        pct === 100 ? "text-primary" : "text-muted-foreground"
                                      )} />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between mb-1">
                                          <span className="text-[11px] font-medium truncate">{obj.templateName}</span>
                                          <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                                            {obj.completedItems}/{obj.totalItems} passos · {obj.completedInstances}/{obj.totalInstances} concluídos
                                          </span>
                                        </div>
                                        <Progress value={pct} className="h-1.5" />
                                      </div>
                                      <Badge variant="outline" className="text-[10px] px-1.5 font-mono shrink-0">
                                        {pct}%
                                      </Badge>
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

                  {isExpanded && boardObjectives === null && (
                    <div className="border-t border-border/50 pt-3 text-center text-xs text-muted-foreground py-4">
                      Nenhum objetivo configurado para este funil
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex justify-end pt-1">
                    <Button
                      variant="default"
                      size="sm"
                      className="text-xs"
                      onClick={() => handleOpenKanban(board.id)}
                    >
                      <LayoutGrid className="h-3.5 w-3.5 mr-1.5" />
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
