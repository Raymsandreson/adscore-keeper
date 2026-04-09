import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePageState } from '@/hooks/usePageState';
import { generateLeadName } from '@/utils/generateLeadName';
import { getStageType } from '@/utils/kanbanStageTypes';
import { LeadAdvancedFilters, LeadFilters, emptyFilters, applyLeadFilters } from './LeadAdvancedFilters';
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
  ChevronRight,
} from 'lucide-react';
import { AccidentLeadForm, AccidentLeadFormData } from '@/components/leads/AccidentLeadForm';
import { useContactClassifications } from '@/hooks/useContactClassifications';
import { useProfilesList } from '@/hooks/useProfilesList';
import { AccidentDataExtractor, ExtractedAccidentData, CurrentLeadData } from '@/components/leads/AccidentDataExtractor';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';
import { useLeads, Lead, LeadStatus } from '@/hooks/useLeads';
import { useLeadStageHistory } from '@/hooks/useLeadStageHistory';
import { useChecklists } from '@/hooks/useChecklists';
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
import { ChecklistFilter } from '@/components/kanban/ChecklistFilter';

interface UnifiedKanbanManagerProps {
  adAccountId?: string;
}

export function UnifiedKanbanManager({ adAccountId }: UnifiedKanbanManagerProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = usePageState<string>('kanban_searchQuery', '');
  const teamProfiles = useProfilesList();
  const { classifications } = useContactClassifications();
  const [showAddLeadDialog, setShowAddLeadDialog] = usePageState<boolean>('kanban_addLeadOpen', false);
  const [showImportInstagram, setShowImportInstagram] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [editingLeadId, setEditingLeadId] = usePageState<string | null>('kanban_editingLeadId', null);
  const [showExtractor, setShowExtractor] = useState(false);
  const [advancedFilters, setAdvancedFilters] = usePageState<LeadFilters>('kanban_advFilters', emptyFilters);
  const [checklistFilteredIds, setChecklistFilteredIds] = useState<Set<string> | null>(null);

  // Handle URL param to auto-open a lead
  const [initialLeadTab, setInitialLeadTab] = useState<string | undefined>();
  useEffect(() => {
    const openLeadId = searchParams.get('openLead');
    if (openLeadId) {
      setEditingLeadId(openLeadId);
      const tabParam = searchParams.get('tab');
      if (tabParam) setInitialLeadTab(tabParam);
      // Clean up URL params
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('openLead');
      newParams.delete('tab');
      setSearchParams(newParams, { replace: true });
    }
  }, [searchParams, setSearchParams, setEditingLeadId]);

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
    client_classification: '',
    expected_birth_date: '',
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
  const { createLeadInstances, markStageInstancesReadonly } = useChecklists();

  // Derive editingLead from persisted ID
  const editingLead = allLeads.find(l => l.id === editingLeadId) ?? null;

  // Filter leads by selected board
  const boardLeads = useMemo(() => {
    if (!selectedBoardId) return allLeads;
    return allLeads.filter(lead => lead.board_id === selectedBoardId);
  }, [allLeads, selectedBoardId]);

  // Filter leads by search query, checklist filter, and advanced filters
  const filteredLeads = useMemo(() => {
    let result = boardLeads;
    
    // Apply checklist filter
    if (checklistFilteredIds !== null) {
      result = result.filter(lead => checklistFilteredIds.has(lead.id));
    }
    
    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(lead => 
        lead.lead_name?.toLowerCase().includes(query) ||
        lead.lead_phone?.includes(query) ||
        lead.lead_email?.toLowerCase().includes(query)
      );
    }

    // Apply advanced filters
    const hasAdvanced = Object.values(advancedFilters).some(v => v !== '');
    if (hasAdvanced) {
      result = applyLeadFilters(result, advancedFilters);
    }
    
    return result;
  }, [boardLeads, searchQuery, checklistFilteredIds, advancedFilters]);

  // Derive available filter options from all leads in the board
  const filterOptions = useMemo(() => {
    const states = [...new Set(boardLeads.map(l => (l as any).visit_state).filter(Boolean))].sort();
    const cities = [...new Set(boardLeads.map(l => (l as any).visit_city).filter(Boolean))].sort();
    const regions = [...new Set(boardLeads.map(l => (l as any).visit_region).filter(Boolean))].sort();
    const caseTypes = [...new Set(boardLeads.map(l => (l as any).case_type).filter(Boolean))].sort();
    const acolhedores = [...new Set(boardLeads.map(l => (l as any).acolhedor).filter(Boolean))].sort();
    return { states, cities, regions, caseTypes, acolhedores };
  }, [boardLeads]);

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

  // Check if any filter is active
  const hasActiveFilters = useMemo(() => {
    return !!searchQuery || checklistFilteredIds !== null || Object.values(advancedFilters).some(v => v !== '');
  }, [searchQuery, checklistFilteredIds, advancedFilters]);

  // Stats for selected board using stage type classification
  const stats = useMemo(() => {
    const stages = selectedBoard?.stages || [];
    const classify = (leads: typeof boardLeads) => {
      let inbox = 0, funnel = 0, closed = 0, refused = 0;
      leads.forEach(l => {
        const type = getStageType(l.status || stages[0]?.id || '', stages);
        if (type === 'inbox') inbox++;
        else if (type === 'closed') closed++;
        else if (type === 'refused') refused++;
        else funnel++;
      });
      const enteredFunnel = funnel + closed + refused;
      const conversionRate = enteredFunnel > 0 ? (closed / enteredFunnel * 100).toFixed(1) : '0';
      return { total: leads.length, inbox, funnel, closed, refused, conversionRate };
    };
    return {
      board: classify(boardLeads),
      filtered: classify(filteredLeads),
    };
  }, [boardLeads, filteredLeads, selectedBoard]);

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
      const currentLead = allLeads.find(l => l.id === leadId);
      const oldStage = currentLead?.status || null;
      
      await updateLead(leadId, { status: stageId as LeadStatus });
      
      if (oldStage !== stageId) {
        await addHistoryEntry(
          leadId,
          oldStage,
          stageId,
          currentLead?.board_id,
          currentLead?.board_id
        );

        // Mark old stage checklists as readonly and create new ones
        if (currentLead?.board_id) {
          if (oldStage) {
            await markStageInstancesReadonly(leadId, currentLead.board_id, oldStage);
          }
          await createLeadInstances(leadId, currentLead.board_id, stageId);
        }
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
      
      await addHistoryEntry(
        leadId,
        currentLead?.status || null,
        newStage,
        currentLead?.board_id || null,
        boardId
      );

      // Mark old checklists readonly and create new ones
      if (currentLead?.board_id && currentLead?.status) {
        await markStageInstancesReadonly(leadId, currentLead.board_id, currentLead.status);
      }
      await createLeadInstances(leadId, boardId, newStage);
      
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
      client_classification: newLeadFormData.client_classification || null,
      expected_birth_date: newLeadFormData.expected_birth_date || null,
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
      client_classification: '',
      expected_birth_date: '',
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
    // Generate lead name following standard pattern
    const generatedName = generateLeadName({
      city: data.visit_city,
      state: data.visit_state,
      victim_name: data.victim_name,
      main_company: data.main_company,
      contractor_company: data.contractor_company,
      accident_date: data.accident_date,
      damage_description: data.damage_description,
      case_type: data.case_type,
    });

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
      lead_name: generatedName || prev.lead_name || data.victim_name || '',
    }));
  };

  const loading = boardsLoading || leadsLoading;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        <div className="flex items-center gap-2">
          <KanbanBoardSelector
            boards={boards.filter(b => b.board_type !== 'workflow')}
            selectedBoardId={selectedBoardId}
            onSelectBoard={setSelectedBoardId}
            onCreateBoard={createBoard}
            onUpdateBoard={updateBoard}
            onDeleteBoard={deleteBoard}
            leadsCountByBoard={leadsCountByBoard}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[150px] max-w-[250px]">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar leads..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 w-full"
            />
          </div>
          
          <Button variant="outline" size="icon" onClick={() => fetchLeads()}>
            <RefreshCw className="h-4 w-4" />
          </Button>

          {selectedBoard && (
            <Button variant="outline" onClick={() => setShowReport(true)}>
              <FileText className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Relatório</span>
            </Button>
          )}
          
          {selectedBoard && (
            <ChecklistFilter
              boardId={selectedBoardId}
              leadIds={boardLeads.map(l => l.id)}
              onFilteredLeadIds={setChecklistFilteredIds}
            />
          )}
          
          <Button onClick={() => setShowAddLeadDialog(true)} size="sm">
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Adicionar Lead</span>
          </Button>
        </div>
      </div>

      {/* Advanced Filters */}
      <LeadAdvancedFilters
        filters={advancedFilters}
        onChange={setAdvancedFilters}
        profiles={teamProfiles}
        availableStates={filterOptions.states}
        availableCities={filterOptions.cities}
        availableRegions={filterOptions.regions}
        availableCaseTypes={filterOptions.caseTypes}
        availableAcolhedores={filterOptions.acolhedores}
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">
              {hasActiveFilters ? <>{stats.filtered.total} <span className="text-sm font-normal text-muted-foreground">/ {stats.board.total}</span></> : stats.board.total}
            </div>
            <p className="text-xs text-muted-foreground">Total de Leads</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-muted-foreground">
              {hasActiveFilters ? <>{stats.filtered.inbox} <span className="text-sm font-normal text-muted-foreground">/ {stats.board.inbox}</span></> : stats.board.inbox}
            </div>
            <p className="text-xs text-muted-foreground">Caixa de Entrada</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-primary">
              {hasActiveFilters ? <>{stats.filtered.funnel} <span className="text-sm font-normal text-muted-foreground">/ {stats.board.funnel}</span></> : stats.board.funnel}
            </div>
            <p className="text-xs text-muted-foreground">Em Andamento</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-500">
              {hasActiveFilters ? <>{stats.filtered.closed} <span className="text-sm font-normal text-muted-foreground">/ {stats.board.closed}</span></> : stats.board.closed}
            </div>
            <p className="text-xs text-muted-foreground">Fechados</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-amber-500">
              {hasActiveFilters ? <>{stats.filtered.conversionRate}% <span className="text-sm font-normal text-muted-foreground">/ {stats.board.conversionRate}%</span></> : <>{stats.board.conversionRate}%</>}
            </div>
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

      {/* Analytics: Funnel Chart and Stage Time Metrics - Collapsible */}
      {selectedBoard && boardLeads.length > 0 && (
        <details className="group">
          <summary className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors py-1 px-1 select-none">
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
            <span>Métricas e Funil de Conversão</span>
            <Badge variant="outline" className="text-[10px] px-1.5">{boardLeads.length} leads</Badge>
          </summary>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-2">
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
        </details>
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
          onCloneLead={async (lead) => {
            const { id, created_at, updated_at, qualified_at, converted_at, facebook_lead_id, sync_status, last_sync_at, ...cloneData } = lead;
            await addLead({
              ...cloneData,
              lead_name: `${lead.lead_name || 'Lead'} (cópia)`,
              status: 'new',
            });
            fetchLeads();
          }}
          onEditLead={(lead) => setEditingLeadId(lead.id)}
          availableBoards={boards}
          onChangeLeadStatus={async (leadId, newStatus) => {
            try {
              // Get current lead data for history
              const { data: currentLead } = await supabase
                .from('leads')
                .select('status, board_id, lead_status, lead_name, case_type')
                .eq('id', leadId)
                .single();

              const { data: { user } } = await supabase.auth.getUser();

              await supabase.from('leads').update({ lead_status: newStatus } as any).eq('id', leadId);

              // Record in lead_stage_history so productivity metrics track it
              await supabase.from('lead_stage_history').insert({
                lead_id: leadId,
                from_stage: (currentLead as any)?.lead_status || 'active',
                to_stage: newStatus,
                from_board_id: currentLead?.board_id || selectedBoardId,
                to_board_id: currentLead?.board_id || selectedBoardId,
                changed_by: user?.id || null,
                notes: newStatus === 'closed' ? 'Lead fechado' : newStatus === 'refused' ? 'Lead recusado' : newStatus === 'inviavel' ? 'Lead inviável' : 'Lead reativado',
              } as any);

              // Record in lead_status_history
              await supabase.from('lead_status_history' as any).insert({
                lead_id: leadId,
                from_status: (currentLead as any)?.lead_status || 'active',
                to_status: newStatus,
                changed_by: user?.id || null,
                changed_by_type: 'manual',
              });

              // Auto-create legal case when closing
              if (newStatus === 'closed') {
                // Set became_client_date
                await supabase.from('leads').update({
                  became_client_date: new Date().toISOString().slice(0, 10),
                } as any).eq('id', leadId);

                const { data: existingCases } = await supabase
                  .from('legal_cases')
                  .select('id')
                  .eq('lead_id', leadId)
                  .limit(1);

                if (!existingCases || existingCases.length === 0) {
                  // Try to match case_type to nucleus
                  let matchedNucleusId: string | null = null;
                  const caseType = (currentLead as any)?.case_type;
                  if (caseType) {
                    const caseTypeLower = caseType.toLowerCase();
                    const { data: nuclei } = await supabase
                      .from('specialized_nuclei')
                      .select('id, name');
                    
                    if (nuclei) {
                      const match = nuclei.find((n: any) => {
                        const nameLower = n.name.toLowerCase();
                        return caseTypeLower.includes(nameLower) || nameLower.includes(caseTypeLower) ||
                          (caseTypeLower.includes('maternidade') && nameLower.includes('maternidade')) ||
                          (caseTypeLower.includes('trabalho') && nameLower.includes('trabalho')) ||
                          (caseTypeLower.includes('trânsito') && nameLower.includes('trânsito')) ||
                          (caseTypeLower.includes('transito') && nameLower.includes('trânsito')) ||
                          (caseTypeLower.includes('doença') && nameLower.includes('doença')) ||
                          (caseTypeLower.includes('consumo') && nameLower.includes('consumo')) ||
                          (caseTypeLower.includes('bpc') && nameLower.includes('grave')) ||
                          (caseTypeLower.includes('loas') && nameLower.includes('grave')) ||
                          (caseTypeLower.includes('inss') && nameLower.includes('grave')) ||
                          (caseTypeLower.includes('benefício') && nameLower.includes('grave')) ||
                          (caseTypeLower.includes('beneficio') && nameLower.includes('grave'));
                      });
                      if (match) matchedNucleusId = match.id;
                    }
                  }

                  const { data: caseNumber } = await supabase
                    .rpc('generate_case_number', { p_nucleus_id: matchedNucleusId });

                  await supabase.from('legal_cases').insert({
                    lead_id: leadId,
                    nucleus_id: matchedNucleusId,
                    case_number: caseNumber || 'CASO-0001',
                    title: `Caso - ${currentLead?.lead_name || 'Novo'}`,
                    status: 'em_andamento',
                    created_by: user?.id,
                  } as any);

                  toast.success(`Lead fechado! Caso ${caseNumber} criado automaticamente.`);
                } else {
                  toast.success('Lead marcado como Fechado');
                }
              } else if (newStatus === 'inviavel') {
                await supabase.from('leads').update({
                  inviavel_date: new Date().toISOString().slice(0, 10),
                } as any).eq('id', leadId);
                toast.success('Lead marcado como Inviável');
              } else {
                toast.success(newStatus === 'refused' ? 'Lead marcado como Recusado' : 'Lead reativado');
              }
              fetchLeads();
            } catch (e) {
              toast.error('Erro ao alterar status');
            }
          }}
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
            teamMembers={teamProfiles}
            classifications={classifications}
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
      {editingLead && (
        <LeadEditDialog
          open={!!editingLead}
          onOpenChange={(open) => {
            if (!open) {
              setEditingLeadId(null);
              setInitialLeadTab(undefined);
            }
          }}
          lead={editingLead}
          onSave={async (leadId, updates) => {
            await updateLead(leadId, updates);
            fetchLeads();
          }}
          adAccountId={adAccountId}
          boards={boards}
          initialTab={initialLeadTab}
        />
      )}

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
