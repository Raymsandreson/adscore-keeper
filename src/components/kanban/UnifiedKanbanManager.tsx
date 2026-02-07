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
  FileText,
} from 'lucide-react';
import { AccidentLeadForm, AccidentLeadFormData } from '@/components/leads/AccidentLeadForm';
import { AccidentDataExtractor, ExtractedAccidentData, CurrentLeadData } from '@/components/leads/AccidentDataExtractor';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';
import { useLeads, Lead, LeadStatus } from '@/hooks/useLeads';
import { useLeadStageHistory } from '@/hooks/useLeadStageHistory';
import { useConversionAlerts } from '@/hooks/useConversionAlerts';
import { KanbanBoardSelector } from '@/components/kanban/KanbanBoardSelector';
import { DynamicKanbanBoard } from '@/components/kanban/DynamicKanbanBoard';
import { ImportInstagramProspects } from '@/components/kanban/ImportInstagramProspects';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import { StageTimeMetrics } from '@/components/kanban/StageTimeMetrics';
import { StageFunnelChart } from '@/components/kanban/StageFunnelChart';
import { BoardComparisonMetrics } from '@/components/kanban/BoardComparisonMetrics';
import { ConversionAlertSettings } from '@/components/kanban/ConversionAlertSettings';
import { KanbanReportDialog } from '@/components/kanban/KanbanReportDialog';

interface UnifiedKanbanManagerProps {
  adAccountId?: string;
}

export function UnifiedKanbanManager({ adAccountId }: UnifiedKanbanManagerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddLeadDialog, setShowAddLeadDialog] = useState(false);
  const [showImportInstagram, setShowImportInstagram] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [showExtractor, setShowExtractor] = useState(false);
  
  // New lead form state - expanded for accident cases
  const [newLeadFormData, setNewLeadFormData] = useState<AccidentLeadFormData>({
    lead_name: '',
    lead_phone: '',
    lead_email: '',
    source: 'manual',
    notes: '',
    acolhedor: '',
    case_type: '',
    group_link: '',
    visit_city: '',
    visit_state: '',
    visit_region: '',
    visit_address: '',
    accident_date: '',
    damage_description: '',
    victim_name: '',
    victim_age: '',
    accident_address: '',
    contractor_company: '',
    main_company: '',
    sector: '',
    news_link: '',
    company_size_justification: '',
    liability_type: '',
    legal_viability: '',
  });

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

  // Leads per stage for funnel chart
  const leadsPerStage = useMemo(() => {
    const counts: Record<string, number> = {};
    selectedBoard?.stages?.forEach(stage => {
      counts[stage.id] = boardLeads.filter(l => l.status === stage.id).length;
    });
    return counts;
  }, [boardLeads, selectedBoard]);

  // Conversion alerts hook
  const {
    settings: conversionSettings,
    saveSettings: saveConversionSettings,
    checkConversionRates,
    requestNotificationPermission,
    hasNotificationPermission,
  } = useConversionAlerts(selectedBoard, leadsPerStage);

  // Get current alerts for display
  const currentConversionAlerts = useMemo(() => {
    return checkConversionRates();
  }, [checkConversionRates]);

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
    if (!newLeadFormData.lead_name.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }

    const firstStage = selectedBoard?.stages[0]?.id || 'new';
    
    await addLead({
      lead_name: newLeadFormData.lead_name,
      lead_phone: newLeadFormData.lead_phone || null,
      lead_email: newLeadFormData.lead_email || null,
      notes: newLeadFormData.notes || null,
      source: newLeadFormData.source,
      status: firstStage as LeadStatus,
      board_id: selectedBoardId,
      // Accident-specific fields
      acolhedor: newLeadFormData.acolhedor || null,
      case_type: newLeadFormData.case_type || null,
      group_link: newLeadFormData.group_link || null,
      visit_city: newLeadFormData.visit_city || null,
      visit_state: newLeadFormData.visit_state || null,
      visit_region: newLeadFormData.visit_region || null,
      visit_address: newLeadFormData.visit_address || null,
      accident_date: newLeadFormData.accident_date || null,
      damage_description: newLeadFormData.damage_description || null,
      victim_name: newLeadFormData.victim_name || null,
      victim_age: newLeadFormData.victim_age ? parseInt(newLeadFormData.victim_age) : null,
      accident_address: newLeadFormData.accident_address || null,
      contractor_company: newLeadFormData.contractor_company || null,
      main_company: newLeadFormData.main_company || null,
      sector: newLeadFormData.sector || null,
      news_link: newLeadFormData.news_link || null,
      company_size_justification: newLeadFormData.company_size_justification || null,
      liability_type: newLeadFormData.liability_type || null,
      legal_viability: newLeadFormData.legal_viability || null,
    } as Partial<Lead>);

    // Reset form
    setNewLeadFormData({
      lead_name: '',
      lead_phone: '',
      lead_email: '',
      source: 'manual',
      notes: '',
      acolhedor: '',
      case_type: '',
      group_link: '',
      visit_city: '',
      visit_state: '',
      visit_region: '',
      visit_address: '',
      accident_date: '',
      damage_description: '',
      victim_name: '',
      victim_age: '',
      accident_address: '',
      contractor_company: '',
      main_company: '',
      sector: '',
      news_link: '',
      company_size_justification: '',
      liability_type: '',
      legal_viability: '',
    });
    setShowAddLeadDialog(false);
  };

  const handleExtractedData = (data: ExtractedAccidentData) => {
    setNewLeadFormData(prev => ({
      ...prev,
      victim_name: data.victim_name || prev.victim_name,
      victim_age: data.victim_age?.toString() || prev.victim_age,
      accident_date: data.accident_date || prev.accident_date,
      accident_address: data.accident_address || prev.accident_address,
      damage_description: data.damage_description || prev.damage_description,
      contractor_company: data.contractor_company || prev.contractor_company,
      main_company: data.main_company || prev.main_company,
      sector: data.sector || prev.sector,
      case_type: data.case_type || prev.case_type,
      liability_type: data.liability_type || prev.liability_type,
      legal_viability: data.legal_viability || prev.legal_viability,
      visit_city: data.visit_city || prev.visit_city,
      visit_state: data.visit_state || prev.visit_state,
      news_link: (data as any).news_link || prev.news_link,
      // Use victim_name as lead_name if not set
      lead_name: prev.lead_name || data.victim_name || '',
    }));
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

          {selectedBoard && (
            <Button variant="outline" onClick={() => setShowReport(true)}>
              <FileText className="h-4 w-4 mr-2" />
              Relatório
            </Button>
          )}
          
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

      {/* Board Comparison Metrics */}
      {boards.length >= 2 && allLeads.length > 0 && (
        <BoardComparisonMetrics
          boards={boards}
          allLeads={allLeads}
        />
      )}

      {/* Conversion Alert Settings */}
      {selectedBoard && (
        <ConversionAlertSettings
          board={selectedBoard}
          settings={conversionSettings}
          onSave={saveConversionSettings}
          currentAlerts={currentConversionAlerts}
          requestNotificationPermission={requestNotificationPermission}
          hasNotificationPermission={hasNotificationPermission}
        />
      )}

      {/* Analytics: Funnel Chart and Stage Time Metrics */}
      {selectedBoard && boardLeads.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <StageFunnelChart
            board={selectedBoard}
            leadsPerStage={leadsPerStage}
            conversionAlerts={currentConversionAlerts}
          />
          <StageTimeMetrics
            board={selectedBoard}
            leadIds={boardLeads.map(l => l.id)}
          />
        </div>
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
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Adicionar Lead</DialogTitle>
          </DialogHeader>

          <AccidentLeadForm
            formData={newLeadFormData}
            onChange={(data) => setNewLeadFormData(prev => ({ ...prev, ...data }))}
            onOpenExtractor={() => setShowExtractor(true)}
          />

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

      {/* AI Data Extractor */}
      <AccidentDataExtractor
        open={showExtractor}
        onOpenChange={setShowExtractor}
        onDataExtracted={handleExtractedData}
      />

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

      {/* Kanban Report Dialog */}
      {selectedBoard && (
        <KanbanReportDialog
          open={showReport}
          onOpenChange={setShowReport}
          board={selectedBoard}
          leads={boardLeads}
          leadsPerStage={leadsPerStage}
        />
      )}
    </div>
  );
}
