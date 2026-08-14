import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Search, X, RefreshCw, Settings2 } from 'lucide-react';
import { ShareMenu } from '@/components/ShareMenu';
import { WorkflowProgressView } from '@/components/workflow/WorkflowProgressView';
import { WorkflowBuilder } from '@/components/workflow/WorkflowBuilder';
import { BoardsList } from '@/components/board/BoardsList';
import { TeamChatButton } from '@/components/chat/TeamChatButton';
import { KanbanBoard, KanbanStage, isBoardArchived } from '@/hooks/useKanbanBoards';
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
  // Deep-link de menção do chat de passo do POP.
  const editBoardParam = searchParams.get('editBoard');
  const openStepParam = searchParams.get('openStep');
  const openStepChatParam = searchParams.get('openStepChat');
  const highlightMsgParam = searchParams.get('highlightMsg');
  const [deepLinkStep, setDeepLinkStep] = useState<{ stepId: string; openChat: boolean; msgId: string | null } | null>(null);

  const [leads, setLeads] = useState<LeadBasic[]>([]);
  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [selectedLead, setSelectedLead] = useState<LeadBasic | null>(null);
  const [selectedBoard, setSelectedBoard] = useState<KanbanBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showLeadPicker, setShowLeadPicker] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<KanbanBoard | null>(null);
  const [createNewMode, setCreateNewMode] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [leadsRes, boardsRes] = await Promise.all([
        externalSupabase.from('leads').select('id, lead_name, status, board_id').order('lead_name'),
        externalSupabase.from('kanban_boards').select('*').order('display_order'),
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

  // Deep-link de menção do chat de passo: quando a URL traz editBoard,
  // abre o editor de POP naquele board e repassa o passo-alvo pro builder,
  // que rola/destaca e abre o chat. Consome os params uma única vez.
  useEffect(() => {
    if (!editBoardParam || boards.length === 0) return;
    const board = boards.find(b => b.id === editBoardParam);
    if (board) {
      setEditingWorkflow(board);
      setShowConfig(true);
      if (openStepParam) {
        setDeepLinkStep({
          stepId: openStepParam,
          openChat: openStepChatParam === '1',
          msgId: highlightMsgParam,
        });
      }
    } else {
      toast.error('POP da menção não foi encontrado.');
    }
    // Limpa só os params do deep-link, preservando o resto (ex.: leadId).
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      ['editBoard', 'openStep', 'openStepChat', 'highlightMsg'].forEach(k => next.delete(k));
      return next;
    }, { replace: true });
  }, [editBoardParam, openStepParam, openStepChatParam, highlightMsgParam, boards, setSearchParams]);

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
      <div className={`mx-auto p-4 ${selectedLead ? 'max-w-3xl' : 'max-w-6xl'}`}>
        {!selectedLead ? (
          <BoardsList boardType="workflow" />
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
                    .filter(b => (b as any).board_type === 'workflow' && !isBoardArchived(b))
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
                    .filter(b => (b as any).board_type === 'workflow' && !isBoardArchived(b))
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
          if (!open) { setEditingWorkflow(null); setCreateNewMode(false); setDeepLinkStep(null); }
        }}
        onWorkflowSaved={fetchData}
        initialEditBoardId={editingWorkflow?.id || null}
        initialCreateNew={createNewMode}
        initialOpenStepId={deepLinkStep?.stepId || null}
        initialOpenStepChat={deepLinkStep?.openChat}
        initialHighlightMsgId={deepLinkStep?.msgId || null}
      />


    </div>
  );
};

export default WorkflowProgressPage;
