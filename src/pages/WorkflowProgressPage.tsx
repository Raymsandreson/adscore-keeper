import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Search, X, RefreshCw, Settings2, Plus, Pencil, Trash2, GitBranch, Scale } from 'lucide-react';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious, PaginationEllipsis } from '@/components/ui/pagination';
import { ShareMenu } from '@/components/ShareMenu';
import { WorkflowProgressView } from '@/components/workflow/WorkflowProgressView';
import { WorkflowBuilder } from '@/components/workflow/WorkflowBuilder';
import { WorkflowVisualizationDialog } from '@/components/workflow/WorkflowVisualizationDialog';
import { TeamChatButton } from '@/components/chat/TeamChatButton';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { KanbanBoard, KanbanStage } from '@/hooks/useKanbanBoards';
import { LeadProcess } from '@/hooks/useLeadProcesses';
import { toast } from 'sonner';

interface LeadBasic {
  id: string;
  lead_name: string | null;
  status: string | null;
  board_id: string | null;
}

const WorkflowProgressPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const leadIdParam = searchParams.get('leadId');

  const [leads, setLeads] = useState<LeadBasic[]>([]);
  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [selectedLead, setSelectedLead] = useState<LeadBasic | null>(null);
  const [selectedBoard, setSelectedBoard] = useState<KanbanBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showLeadPicker, setShowLeadPicker] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [workflowSearch, setWorkflowSearch] = useState('');
  const [workflowPage, setWorkflowPage] = useState(1);
  const [editingWorkflow, setEditingWorkflow] = useState<KanbanBoard | null>(null);
  const [createNewMode, setCreateNewMode] = useState(false);
  const [vizBoard, setVizBoard] = useState<KanbanBoard | null>(null);
  // Aba lateral com a relação de processos vinculados a um POP
  const [processesBoard, setProcessesBoard] = useState<KanbanBoard | null>(null);
  const [boardProcesses, setBoardProcesses] = useState<LeadProcess[]>([]);
  const [loadingProcesses, setLoadingProcesses] = useState(false);
  const [processCounts, setProcessCounts] = useState<Record<string, number>>({});
  const WORKFLOWS_PER_PAGE = 6;
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [leadsRes, boardsRes, processCountRes] = await Promise.all([
        externalSupabase.from('leads').select('id, lead_name, status, board_id').order('lead_name'),
        externalSupabase.from('kanban_boards').select('*').order('display_order'),
        // Query única para contar processos por POP (evita N+1)
        externalSupabase.from('lead_processes').select('workflow_id').is('deleted_at', null),
      ]);

      if (leadsRes.error) throw leadsRes.error;
      if (boardsRes.error) throw boardsRes.error;

      setLeads(leadsRes.data || []);

      if (processCountRes.error) {
        console.error('Erro ao contar processos por POP:', processCountRes.error);
      } else {
        const counts: Record<string, number> = {};
        for (const row of processCountRes.data || []) {
          const wid = (row as { workflow_id: string | null }).workflow_id;
          if (wid) counts[wid] = (counts[wid] || 0) + 1;
        }
        setProcessCounts(counts);
      }

      const parsedBoards = (boardsRes.data || []).map(b => ({
        ...b,
        stages: (b.stages as unknown as KanbanStage[]) || [],
      })) as KanbanBoard[];
      setBoards(parsedBoards);

      // Auto-select lead from URL
      if (leadIdParam) {
        const lead = (leadsRes.data || []).find(l => l.id === leadIdParam);
        if (lead) {
          setSelectedLead(lead);
          // Só auto-seleciona se o board do lead existir E for workflow.
          // Evita cair no fallback boards[0] que mostrava fluxo errado
          // (ex.: caso de Inquérito exibindo tarefas de Acidente de Trabalho).
          const board = parsedBoards.find(
            b => b.id === lead.board_id && (b as any).board_type === 'workflow',
          );
          setSelectedBoard(board || null);
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  }, [leadIdParam]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSelectLead = (lead: LeadBasic) => {
    setSelectedLead(lead);
    setSearchParams({ leadId: lead.id });
    const board = boards.find(
      b => b.id === lead.board_id && (b as any).board_type === 'workflow',
    );
    setSelectedBoard(board || null);
    setShowLeadPicker(false);
    setSearchQuery('');
  };

  const handleStageChange = async (newStageId: string) => {
    if (!selectedLead) return;
    const { error } = await supabase
      .from('leads')
      .update({ status: newStageId })
      .eq('id', selectedLead.id);

    if (error) {
      toast.error('Erro ao mover lead');
      return;
    }

    setSelectedLead(prev => prev ? { ...prev, status: newStageId } : null);
    toast.success('Lead movido de fase');
  };

  const openProcessesSheet = useCallback(async (board: KanbanBoard) => {
    setProcessesBoard(board);
    setLoadingProcesses(true);
    setBoardProcesses([]);
    try {
      const { data, error } = await externalSupabase
        .from('lead_processes')
        .select('*')
        .eq('workflow_id', board.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setBoardProcesses((data || []) as unknown as LeadProcess[]);
    } catch (error) {
      console.error('Erro ao carregar processos do POP:', error);
      toast.error('Erro ao carregar processos');
    } finally {
      setLoadingProcesses(false);
    }
  }, []);

  const leadNameById = useCallback(
    (leadId: string | null) => (leadId ? leads.find(l => l.id === leadId)?.lead_name || null : null),
    [leads],
  );

  const filteredLeads = searchQuery
    ? leads.filter(l => l.lead_name?.toLowerCase().includes(searchQuery.toLowerCase()))
    : leads;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <RefreshCw className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>

          <h1 className="font-semibold text-lg flex-1">Progresso do POP</h1>

          <Button variant="outline" size="sm" onClick={() => setShowConfig(true)} title="Configurar POP">
            <Settings2 className="h-4 w-4 mr-1" />
            Configurar
          </Button>

          {selectedLead && (
            <ShareMenu entityType="workflow" entityId={selectedLead.id} entityName={selectedLead.lead_name || 'Lead sem nome'} size="sm" variant="outline" />
          )}

          {selectedBoard && (
            <TeamChatButton
              entityType="workflow"
              entityId={selectedBoard.id}
              entityName={selectedBoard.name}
              variant="icon"
              className="h-9 w-9"
            />
          )}

          <Button variant="outline" size="sm" onClick={() => setShowLeadPicker(true)}>
            {selectedLead ? (selectedLead.lead_name || 'Lead sem nome') : 'Selecionar Lead'}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto p-4">
        {!selectedLead ? (
          (() => {
            const workflowBoards = boards.filter(b => (b as any).board_type === 'workflow');
            const filteredWorkflows = workflowSearch
              ? workflowBoards.filter(b => b.name.toLowerCase().includes(workflowSearch.toLowerCase()))
              : workflowBoards;
            const totalPages = Math.max(1, Math.ceil(filteredWorkflows.length / WORKFLOWS_PER_PAGE));
            const currentPage = Math.min(workflowPage, totalPages);
            const paged = filteredWorkflows.slice((currentPage - 1) * WORKFLOWS_PER_PAGE, currentPage * WORKFLOWS_PER_PAGE);

            const handleDeleteWorkflow = async (boardId: string) => {
              if (!confirm('Tem certeza que deseja excluir este fluxo?')) return;
              const { error } = await externalSupabase.from('kanban_boards').delete().eq('id', boardId);
              if (error) { toast.error('Erro ao excluir'); return; }
              toast.success('POP excluído');
              fetchData();
            };

            return (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">POPs</h2>
                  <Button size="icon" onClick={() => { setCreateNewMode(true); setEditingWorkflow(null); setShowConfig(true); }} title="Criar novo fluxo">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                <div className="relative max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar POPs..."
                    value={workflowSearch}
                    onChange={e => { setWorkflowSearch(e.target.value); setWorkflowPage(1); }}
                    className="pl-9"
                  />
                </div>

                {filteredWorkflows.length === 0 ? (
                  <p className="text-center py-10 text-muted-foreground text-sm">Nenhum fluxo encontrado</p>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {paged.map(board => (
                        <div key={board.id} className="border rounded-lg p-4 bg-card hover:shadow-sm transition-shadow">
                          <div className="flex items-start gap-2">
                            <h3 className="font-semibold text-sm truncate flex-1">{board.name}</h3>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs shrink-0"
                              onClick={() => openProcessesSheet(board)}
                              title="Ver processos vinculados a este POP"
                            >
                              <Scale className="h-3 w-3 mr-1" />
                              Processos
                              {processCounts[board.id] ? (
                                <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px] leading-4">
                                  {processCounts[board.id]}
                                </Badge>
                              ) : null}
                            </Button>
                          </div>
                          {board.description && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{board.description}</p>
                          )}
                          <div className="flex items-center gap-2 mt-3 pt-2 border-t">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="flex-1 text-xs h-8"
                              onClick={() => setVizBoard(board)}
                            >
                              <GitBranch className="h-3 w-3 mr-1" /> Visualizar
                            </Button>
                            <div className="w-px h-5 bg-border" />
                            <Button
                              variant="ghost"
                              size="sm"
                              className="flex-1 text-xs h-8"
                              onClick={() => { setEditingWorkflow(board); setShowConfig(true); }}
                            >
                              <Pencil className="h-3 w-3 mr-1" /> Editar
                            </Button>
                            <div className="w-px h-5 bg-border" />
                            <Button
                              variant="ghost"
                              size="sm"
                              className="flex-1 text-xs h-8 text-destructive hover:text-destructive"
                              onClick={() => handleDeleteWorkflow(board.id)}
                            >
                              <Trash2 className="h-3 w-3 mr-1" /> Excluir
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {totalPages > 1 && (
                      <Pagination>
                        <PaginationContent>
                          <PaginationItem>
                            <PaginationPrevious
                              onClick={() => setWorkflowPage(p => Math.max(1, p - 1))}
                              className={currentPage <= 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                            />
                          </PaginationItem>
                          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                            let page: number;
                            if (totalPages <= 5) page = i + 1;
                            else if (currentPage <= 3) page = i + 1;
                            else if (currentPage >= totalPages - 2) page = totalPages - 4 + i;
                            else page = currentPage - 2 + i;
                            return (
                              <PaginationItem key={page}>
                                <PaginationLink
                                  isActive={page === currentPage}
                                  onClick={() => setWorkflowPage(page)}
                                  className="cursor-pointer"
                                >
                                  {page}
                                </PaginationLink>
                              </PaginationItem>
                            );
                          })}
                          {totalPages > 5 && currentPage < totalPages - 2 && (
                            <>
                              <PaginationItem><PaginationEllipsis /></PaginationItem>
                              <PaginationItem>
                                <PaginationLink onClick={() => setWorkflowPage(totalPages)} className="cursor-pointer">
                                  {totalPages}
                                </PaginationLink>
                              </PaginationItem>
                            </>
                          )}
                          <PaginationItem>
                            <PaginationNext
                              onClick={() => setWorkflowPage(p => Math.min(totalPages, p + 1))}
                              className={currentPage >= totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                            />
                          </PaginationItem>
                        </PaginationContent>
                        <div className="flex justify-center mt-2">
                          <span className="text-xs text-muted-foreground">{WORKFLOWS_PER_PAGE} / página</span>
                        </div>
                      </Pagination>
                    )}
                  </>
                )}
              </div>
            );
          })()
        ) : !selectedBoard ? (
          <div className="space-y-4 py-10">
            <p className="text-center text-sm text-muted-foreground">
              Nenhum POP está associado automaticamente a este lead.
              Selecione um POP para visualizar:
            </p>
            <div className="flex justify-center">
              <Select
                onValueChange={(id) => {
                  const b = boards.find(x => x.id === id);
                  if (b) setSelectedBoard(b);
                }}
              >
                <SelectTrigger className="w-[280px]">
                  <SelectValue placeholder="Escolher POP" />
                </SelectTrigger>
                <SelectContent>
                  {boards
                    .filter(b => (b as any).board_type === 'workflow')
                    .map(b => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Workflow + stage selectors */}
            <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg border bg-card">
              <span className="text-sm text-muted-foreground">POP:</span>
              <Select
                value={selectedBoard.id}
                onValueChange={(id) => {
                  const b = boards.find(x => x.id === id);
                  if (b) setSelectedBoard(b);
                }}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {boards
                    .filter(b => (b as any).board_type === 'workflow')
                    .map(b => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground ml-2">Fase atual:</span>
              <Select
                value={selectedLead.status || selectedBoard.stages[0]?.id}
                onValueChange={handleStageChange}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {selectedBoard.stages.map(stage => (
                    <SelectItem key={stage.id} value={stage.id}>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: stage.color }}
                        />
                        {stage.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <WorkflowProgressView
              leadId={selectedLead.id}
              leadName={selectedLead.lead_name || 'Lead sem nome'}
              boardId={selectedBoard.id}
              currentStageId={selectedLead.status || selectedBoard.stages[0]?.id || ''}
              board={selectedBoard}
              onStageChange={handleStageChange}
            />
          </div>
        )}
      </div>

      {/* Lead picker dialog */}
      <Dialog open={showLeadPicker} onOpenChange={setShowLeadPicker}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Selecionar Lead</DialogTitle>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar lead..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 pr-9"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                onClick={() => setSearchQuery('')}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          <ScrollArea className="max-h-[400px]">
            <div className="space-y-1">
              {filteredLeads.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhum lead encontrado
                </p>
              ) : (
                filteredLeads.map(lead => {
                  const board = boards.find(b => b.id === lead.board_id);
                  const stage = board?.stages.find(s => s.id === lead.status);

                  return (
                    <button
                      key={lead.id}
                      className="w-full text-left p-2.5 rounded-md hover:bg-accent transition-colors flex items-center gap-3"
                      onClick={() => handleSelectLead(lead)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {lead.lead_name || 'Lead sem nome'}
                        </p>
                        {stage && (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <div
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: stage.color }}
                            />
                            <span className="text-[11px] text-muted-foreground">{stage.name}</span>
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
      {/* Workflow config */}
      <WorkflowBuilder
        open={showConfig}
        onOpenChange={(open) => {
          setShowConfig(open);
          if (!open) { setEditingWorkflow(null); setCreateNewMode(false); }
        }}
        onWorkflowSaved={fetchData}
        initialEditBoardId={editingWorkflow?.id || null}
        initialCreateNew={createNewMode}
      />

      {/* Visualização (fluxograma / mapa mental / detalhes) */}
      <WorkflowVisualizationDialog
        board={vizBoard}
        open={!!vizBoard}
        onOpenChange={(open) => { if (!open) setVizBoard(null); }}
        onEdit={() => { if (vizBoard) { setEditingWorkflow(vizBoard); setShowConfig(true); } }}
      />

      {/* Aba lateral: relação de processos vinculados ao POP */}
      <Sheet open={!!processesBoard} onOpenChange={(open) => { if (!open) { setProcessesBoard(null); setBoardProcesses([]); } }}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Scale className="h-4 w-4" />
              Processos do POP
            </SheetTitle>
            <SheetDescription className="truncate">{processesBoard?.name}</SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto mt-4">
            {loadingProcesses ? (
              <div className="flex items-center justify-center py-16">
                <RefreshCw className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : boardProcesses.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-16">
                Nenhum processo vinculado a este POP.
              </p>
            ) : (
              <div className="space-y-2">
                {boardProcesses.map(p => {
                  const clientName = leadNameById(p.lead_id);
                  const statusLabel =
                    p.status === 'concluido' ? 'Concluído' :
                    p.status === 'arquivado' ? 'Arquivado' : 'Em andamento';
                  const statusVariant =
                    p.status === 'concluido' ? 'default' :
                    p.status === 'arquivado' ? 'secondary' : 'outline';
                  return (
                    <div key={p.id} className="border rounded-lg p-3 bg-card">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium leading-snug">{p.title || 'Processo sem título'}</p>
                        <Badge variant={statusVariant as any} className="shrink-0 text-[10px]">{statusLabel}</Badge>
                      </div>
                      {p.process_number && (
                        <p className="text-xs text-muted-foreground mt-1 font-mono">{p.process_number}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <Badge variant="secondary" className="text-[10px] capitalize">{p.process_type}</Badge>
                        {clientName && (
                          <span className="text-[11px] text-muted-foreground">Cliente: {clientName}</span>
                        )}
                      </div>
                      {p.started_at && (
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Início: {new Date(p.started_at).toLocaleDateString('pt-BR')}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default WorkflowProgressPage;
