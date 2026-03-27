import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Search, X, RefreshCw, Settings2, Plus, Pencil, Trash2 } from 'lucide-react';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious, PaginationEllipsis } from '@/components/ui/pagination';
import { ShareMenu } from '@/components/ShareMenu';
import { WorkflowProgressView } from '@/components/workflow/WorkflowProgressView';
import { WorkflowBuilder } from '@/components/workflow/WorkflowBuilder';
import { TeamChatButton } from '@/components/chat/TeamChatButton';
import { KanbanBoard, KanbanStage } from '@/hooks/useKanbanBoards';
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
  const WORKFLOWS_PER_PAGE = 6;
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [leadsRes, boardsRes] = await Promise.all([
        supabase.from('leads').select('id, lead_name, status, board_id').order('lead_name'),
        supabase.from('kanban_boards').select('*').order('display_order'),
      ]);

      if (leadsRes.error) throw leadsRes.error;
      if (boardsRes.error) throw boardsRes.error;

      setLeads(leadsRes.data || []);

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
          const board = parsedBoards.find(b => b.id === lead.board_id);
          setSelectedBoard(board || parsedBoards[0] || null);
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
    const board = boards.find(b => b.id === lead.board_id);
    setSelectedBoard(board || boards[0] || null);
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

          <h1 className="font-semibold text-lg flex-1">Progresso do Fluxo de Trabalho</h1>

          <Button variant="outline" size="sm" onClick={() => setShowConfig(true)} title="Configurar Fluxo">
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
              const { error } = await supabase.from('kanban_boards').delete().eq('id', boardId);
              if (error) { toast.error('Erro ao excluir'); return; }
              toast.success('Fluxo excluído');
              fetchData();
            };

            return (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Fluxos de trabalho</h2>
                  <Button size="icon" onClick={() => { setCreateNewMode(true); setEditingWorkflow(null); setShowConfig(true); }} title="Criar novo fluxo">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                <div className="relative max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar fluxos de trabalho..."
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
                          <h3 className="font-semibold text-sm truncate">{board.name}</h3>
                          {board.description && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{board.description}</p>
                          )}
                          <div className="flex items-center gap-2 mt-3 pt-2 border-t">
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
          <div className="text-center py-20 text-muted-foreground">
            <p>Nenhum quadro kanban encontrado para este lead</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Stage selector */}
            <div className="flex items-center gap-3 p-3 rounded-lg border bg-card">
              <span className="text-sm text-muted-foreground">Fase atual:</span>
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
          if (!open) setEditingWorkflow(null);
        }}
        onWorkflowSaved={fetchData}
        initialEditBoardId={editingWorkflow?.id || null}
      />
    </div>
  );
};

export default WorkflowProgressPage;
