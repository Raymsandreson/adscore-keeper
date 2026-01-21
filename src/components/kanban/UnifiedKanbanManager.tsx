import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { 
  Plus, 
  LayoutGrid, 
  RefreshCw,
  Search,
  Instagram,
} from 'lucide-react';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';
import { useLeads, Lead, LeadStatus } from '@/hooks/useLeads';
import { useLeadStageHistory } from '@/hooks/useLeadStageHistory';
import { KanbanBoardSelector } from '@/components/kanban/KanbanBoardSelector';
import { DynamicKanbanBoard } from '@/components/kanban/DynamicKanbanBoard';
import { ImportInstagramProspects } from '@/components/kanban/ImportInstagramProspects';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import { StageTimeMetrics } from '@/components/kanban/StageTimeMetrics';
interface UnifiedKanbanManagerProps {
  adAccountId?: string;
}

export function UnifiedKanbanManager({ adAccountId }: UnifiedKanbanManagerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddLeadDialog, setShowAddLeadDialog] = useState(false);
  const [showImportInstagram, setShowImportInstagram] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  
  // New lead form state
  const [newLeadName, setNewLeadName] = useState('');
  const [newLeadPhone, setNewLeadPhone] = useState('');
  const [newLeadEmail, setNewLeadEmail] = useState('');
  const [newLeadNotes, setNewLeadNotes] = useState('');
  const [newLeadSource, setNewLeadSource] = useState('manual');

  // Kanban boards hook
  const {
    boards,
    loading: boardsLoading,
    selectedBoard,
    selectedBoardId,
    setSelectedBoardId,
    createBoard,
    updateBoard,
    deleteBoard,
  } = useKanbanBoards(adAccountId);

  // Leads hook
  const {
    leads: allLeads,
    loading: leadsLoading,
    fetchLeads,
    addLead,
    updateLead,
    deleteLead,
  } = useLeads(adAccountId);

  // Stage history hook
  const { addHistoryEntry } = useLeadStageHistory();

  // Filter leads by selected board
  const boardLeads = useMemo(() => {
    if (!selectedBoardId) return allLeads;
    return allLeads.filter(lead => lead.board_id === selectedBoardId);
  }, [allLeads, selectedBoardId]);

  // Filter leads by search query
  const filteredLeads = useMemo(() => {
    if (!searchQuery) return boardLeads;
    const query = searchQuery.toLowerCase();
    return boardLeads.filter(lead => 
      lead.lead_name?.toLowerCase().includes(query) ||
      lead.lead_phone?.includes(query) ||
      lead.lead_email?.toLowerCase().includes(query)
    );
  }, [boardLeads, searchQuery]);

  // Count leads by board
  const leadsCountByBoard = useMemo(() => {
    const counts: Record<string, number> = {};
    boards.forEach(board => {
      counts[board.id] = allLeads.filter(l => l.board_id === board.id).length;
    });
    // Count unassigned leads
    counts['unassigned'] = allLeads.filter(l => !l.board_id).length;
    return counts;
  }, [allLeads, boards]);

  // Stats for selected board
  const stats = useMemo(() => {
    const total = boardLeads.length;
    const converted = boardLeads.filter(l => l.status === 'converted').length;
    const inProgress = boardLeads.filter(l => !['converted', 'lost', 'not_qualified'].includes(l.status)).length;
    return {
      total,
      converted,
      inProgress,
      conversionRate: total > 0 ? (converted / total * 100).toFixed(1) : '0',
    };
  }, [boardLeads]);

  const handleMoveToStage = async (leadId: string, stageId: string) => {
    try {
      // Find the current lead to get the old stage
      const currentLead = allLeads.find(l => l.id === leadId);
      const oldStage = currentLead?.status || null;
      
      await updateLead(leadId, { status: stageId as LeadStatus });
      
      // Record history if stage actually changed
      if (oldStage !== stageId) {
        await addHistoryEntry(
          leadId,
          oldStage,
          stageId,
          currentLead?.board_id,
          currentLead?.board_id
        );
      }
    } catch (error) {
      console.error('Error moving lead:', error);
    }
  };

  const handleMoveToBoard = async (leadId: string, boardId: string, stageId?: string) => {
    try {
      const currentLead = allLeads.find(l => l.id === leadId);
      const targetBoard = boards.find(b => b.id === boardId);
      const firstStage = targetBoard?.stages[0]?.id || 'new';
      const newStage = stageId || firstStage;
      
      await supabase
        .from('leads')
        .update({ 
          board_id: boardId,
          status: newStage,
        })
        .eq('id', leadId);
      
      // Record history
      await addHistoryEntry(
        leadId,
        currentLead?.status || null,
        newStage,
        currentLead?.board_id || null,
        boardId
      );
      
      toast.success('Lead movido para outro quadro');
      fetchLeads();
    } catch (error) {
      console.error('Error moving lead to board:', error);
      toast.error('Erro ao mover lead');
    }
  };

  const handleAddLead = async () => {
    if (!newLeadName.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }

    const firstStage = selectedBoard?.stages[0]?.id || 'new';
    
    await addLead({
      lead_name: newLeadName,
      lead_phone: newLeadPhone || null,
      lead_email: newLeadEmail || null,
      notes: newLeadNotes || null,
      source: newLeadSource,
      status: firstStage as LeadStatus,
      board_id: selectedBoardId,
    } as Partial<Lead>);

    // Reset form
    setNewLeadName('');
    setNewLeadPhone('');
    setNewLeadEmail('');
    setNewLeadNotes('');
    setNewLeadSource('manual');
    setShowAddLeadDialog(false);
  };

  const loading = boardsLoading || leadsLoading;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        <div className="flex items-center gap-2">
          <KanbanBoardSelector
            boards={boards}
            selectedBoardId={selectedBoardId}
            onSelectBoard={setSelectedBoardId}
            onCreateBoard={createBoard}
            onUpdateBoard={updateBoard}
            onDeleteBoard={deleteBoard}
            leadsCountByBoard={leadsCountByBoard}
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar leads..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 w-[200px]"
            />
          </div>
          
          <Button variant="outline" size="icon" onClick={() => fetchLeads()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          
          <Button variant="outline" onClick={() => setShowImportInstagram(true)}>
            <Instagram className="h-4 w-4 mr-2" />
            Importar Instagram
          </Button>
          
          <Button onClick={() => setShowAddLeadDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Adicionar Lead
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground">Total de Leads</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-primary">{stats.inProgress}</div>
            <p className="text-xs text-muted-foreground">Em Andamento</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-500">{stats.converted}</div>
            <p className="text-xs text-muted-foreground">Convertidos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-amber-500">{stats.conversionRate}%</div>
            <p className="text-xs text-muted-foreground">Taxa de Conversão</p>
          </CardContent>
        </Card>
      </div>

      {/* Board Description */}
      {selectedBoard?.description && (
        <Card className="border-l-4" style={{ borderLeftColor: selectedBoard.color }}>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{selectedBoard.description}</p>
          </CardContent>
        </Card>
      )}

      {/* Stage Time Metrics */}
      {selectedBoard && boardLeads.length > 0 && (
        <StageTimeMetrics
          board={selectedBoard}
          leadIds={boardLeads.map(l => l.id)}
        />
      )}

      {/* Kanban Board */}
      {selectedBoard ? (
        <DynamicKanbanBoard
          board={selectedBoard}
          leads={filteredLeads}
          loading={loading}
          onMoveToStage={handleMoveToStage}
          onMoveToBoard={handleMoveToBoard}
          onDeleteLead={deleteLead}
          onEditLead={(lead) => setEditingLead(lead)}
          availableBoards={boards}
        />
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <LayoutGrid className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-medium mb-2">Nenhum quadro selecionado</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Selecione ou crie um quadro para começar a gerenciar seus leads
            </p>
            <Button onClick={() => createBoard({ name: 'Meu Primeiro Quadro' })}>
              <Plus className="h-4 w-4 mr-2" />
              Criar Quadro
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Add Lead Dialog */}
      <Dialog open={showAddLeadDialog} onOpenChange={setShowAddLeadDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar Lead</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Nome *</Label>
              <Input
                value={newLeadName}
                onChange={(e) => setNewLeadName(e.target.value)}
                placeholder="Nome do lead"
              />
            </div>

            <div>
              <Label>Telefone</Label>
              <Input
                value={newLeadPhone}
                onChange={(e) => setNewLeadPhone(e.target.value)}
                placeholder="(00) 00000-0000"
              />
            </div>

            <div>
              <Label>Email</Label>
              <Input
                type="email"
                value={newLeadEmail}
                onChange={(e) => setNewLeadEmail(e.target.value)}
                placeholder="email@exemplo.com"
              />
            </div>

            <div>
              <Label>Origem</Label>
              <Select value={newLeadSource} onValueChange={setNewLeadSource}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="form">Formulário</SelectItem>
                  <SelectItem value="referral">Indicação</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Observações</Label>
              <Textarea
                value={newLeadNotes}
                onChange={(e) => setNewLeadNotes(e.target.value)}
                placeholder="Notas sobre o lead..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddLeadDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleAddLead}>
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Instagram Prospects Sheet */}
      <ImportInstagramProspects
        open={showImportInstagram}
        onOpenChange={setShowImportInstagram}
        boards={boards}
        targetBoardId={selectedBoardId}
        onImportComplete={fetchLeads}
      />

      {/* Lead Edit Dialog */}
      <LeadEditDialog
        open={!!editingLead}
        onOpenChange={(open) => !open && setEditingLead(null)}
        lead={editingLead}
        onSave={async (leadId, updates) => {
          await updateLead(leadId, updates);
          fetchLeads();
        }}
        adAccountId={adAccountId}
        boards={boards}
      />
    </div>
  );
}
