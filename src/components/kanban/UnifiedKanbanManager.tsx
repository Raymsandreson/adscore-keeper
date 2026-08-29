import { useState, useMemo, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useGroupReportsPending } from '@/hooks/useGroupReportsPending';
import { usePageState } from '@/hooks/usePageState';
import { generateLeadName } from '@/utils/generateLeadName';
import { getStageType } from '@/utils/kanbanStageTypes';
import { LeadAdvancedFilters, LeadFilters, emptyFilters, applyLeadFilters, normalizeLeadFilters, hasAnyLeadFilter } from './LeadAdvancedFilters';
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
import { Checkbox } from '@/components/ui/checkbox';
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
import { externalSupabase } from '@/integrations/supabase/external-client';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import {
  Plus,
  LayoutGrid,
  RefreshCw,
  Search,
  Instagram,
  FileText,
  ChevronRight,
  Columns3,
  List,
  HeartHandshake,
  Ear,
  Loader2,
  Users,
  Link2,
  CheckCircle2,
  WifiOff,
} from 'lucide-react';
import {
  GROUP_AUTHOR_OPTIONS,
  DEFAULT_GROUP_AUTHOR_INSTANCE_ID,
  composeGroupIntroMessage,
  createLeadWhatsappGroup,
  fetchBoardInstanceIds,
  fetchBoardSequencePrefix,
  fetchInstanceConnStatus,
  nextFreeLeadNumber,
  suggestNextSequence,
  type InstanceConnStatus,
} from '@/lib/leadWhatsappGroupFlow';
import { isTrabalhistaBoard } from '@/lib/trabalhistaAcolhedores';
import { AccidentLeadForm, AccidentLeadFormData } from '@/components/leads/AccidentLeadForm';
import { useContactClassifications } from '@/hooks/useContactClassifications';
import { useProfilesList } from '@/hooks/useProfilesList';
import { AccidentDataExtractor, ExtractedAccidentData, CurrentLeadData } from '@/components/leads/AccidentDataExtractor';
import { useKanbanBoards, isBoardArchived } from '@/hooks/useKanbanBoards';
import { useLeads, Lead, LeadStatus } from '@/hooks/useLeads';
import { useLeadDetails } from '@/hooks/useLeadDetails';
import { useLeadStageHistory } from '@/hooks/useLeadStageHistory';
import { useChecklists } from '@/hooks/useChecklists';
import { useConversionAlerts } from '@/hooks/useConversionAlerts';
import { KanbanBoardSelector } from '@/components/kanban/KanbanBoardSelector';
import { DynamicKanbanBoard } from '@/components/kanban/DynamicKanbanBoard';
import { useVirtualSheetLeadsForBoard } from '@/components/kanban/SheetVirtualLeads';
import { ImportInstagramProspects } from '@/components/kanban/ImportInstagramProspects';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import { StageTimeMetrics } from '@/components/kanban/StageTimeMetrics';
import { StageFunnelChart } from '@/components/kanban/StageFunnelChart';
import { KanbanReportDialog } from '@/components/kanban/KanbanReportDialog';
import { ChecklistFilter } from '@/components/kanban/ChecklistFilter';
import { LeadListView } from '@/components/kanban/LeadListView';
import {
  DEFAULT_LIST_SORT,
  emptyChips,
  type ListSort,
  type ListSortKey,
  type QuickChips,
} from '@/hooks/useLeadListView';
import { normalizeDateInput } from '@/utils/normalizeDateInput';
import { regionForUf } from '@/lib/leads/visitFromAccident';

// Calendário das visitas das assistentes sociais — carrega só quando a visão é
// aberta, para não pesar no bundle de quem só usa o kanban.
const SocialVisitsModule = lazy(() => import('@/components/visitas/SocialVisitsModule'));

interface UnifiedKanbanManagerProps {
  adAccountId?: string;
  category?: 'trabalhista' | 'previdenciario';
}

export function UnifiedKanbanManager({ adAccountId, category }: UnifiedKanbanManagerProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { count: relatosPendentes } = useGroupReportsPending();
  const [searchQuery, setSearchQuery] = usePageState<string>('kanban_searchQuery', '');
  const teamProfiles = useProfilesList();
  const { classifications } = useContactClassifications();
  const [showAddLeadDialog, setShowAddLeadDialog] = usePageState<boolean>('kanban_addLeadOpen', false);
  const [showImportInstagram, setShowImportInstagram] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [editingLeadId, setEditingLeadId] = usePageState<string | null>('kanban_editingLeadId', null);
  const [showExtractor, setShowExtractor] = useState(false);
  const [storedFilters, setAdvancedFilters] = usePageState<LeadFilters>('kanban_advFilters', emptyFilters);
  // O localStorage pode ter a forma antiga do filtro de Estado (string).
  const advancedFilters = useMemo(() => normalizeLeadFilters(storedFilters), [storedFilters]);
  const [acolhedorFilter, setAcolhedorFilter] = usePageState<string>('kanban_acolhedorFilter', '');
  const [checklistFilteredIds, setChecklistFilteredIds] = useState<Set<string> | null>(null);

  // Visualização kanban|lista. Última escolha em localStorage (usePageState);
  // URL (?view=list&sort=tempo_estagio.desc) tem prioridade ao abrir e é
  // mantida atualizada para permitir compartilhar o link.
  const [viewMode, setViewMode] = usePageState<'kanban' | 'list' | 'visitas'>('kanban_viewMode', 'kanban');
  const [listSort, setListSort] = usePageState<ListSort>('kanban_listSort', DEFAULT_LIST_SORT);
  const [listChips, setListChips] = usePageState<QuickChips>('kanban_listChips', emptyChips);

  useEffect(() => {
    const view = searchParams.get('view');
    if (view === 'list' || view === 'kanban' || view === 'visitas') setViewMode(view);
    const sortParam = searchParams.get('sort');
    if (sortParam) {
      const [key, dir] = sortParam.split('.');
      const validKeys: ListSortKey[] = ['vitima', 'empresa', 'local', 'estagio', 'tempo_estagio', 'data_acidente', 'acolhedor'];
      if (validKeys.includes(key as ListSortKey) && (dir === 'asc' || dir === 'desc')) {
        setListSort({ key: key as ListSortKey, dir });
      }
    }
    // Só na montagem: depois disso o estado local é a fonte e reflete na URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (viewMode === 'list') {
        next.set('view', 'list');
        next.set('sort', `${listSort.key}.${listSort.dir}`);
      } else if (viewMode === 'visitas') {
        next.set('view', 'visitas');
        next.delete('sort');
      } else {
        next.delete('view');
        next.delete('sort');
      }
      return next;
    }, { replace: true });
  }, [viewMode, listSort, setSearchParams]);

  // A visão de visitas só existe no Trabalhista, mas `viewMode` é lembrado em
  // localStorage e vale para os dois menus: sem esta guarda, quem saísse dela
  // para o Previdenciário cairia numa tela sem botão para voltar.
  const visitsViewAvailable = category === 'trabalhista';
  useEffect(() => {
    if (viewMode === 'visitas' && !visitsViewAvailable) setViewMode('kanban');
  }, [viewMode, visitsViewAvailable, setViewMode]);

  // Handle URL param to auto-open a lead
  const [initialLeadTab, setInitialLeadTab] = useState<string | undefined>();
  // Lead vindo de link/sino abre em painel lateral (sheet), não no dialog central
  const [leadAsSheet, setLeadAsSheet] = useState(false);
  useEffect(() => {
    const openLeadId = searchParams.get('openLead');
    if (openLeadId) {
      setEditingLeadId(openLeadId);
      setLeadAsSheet(true);
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
    crm_campaign_id: '',
    campaign_id: '',
    campaign_name: '',
    acolhedor: '',
    case_type: '',
    group_link: '',
    client_classification: '',
    expected_birth_date: '',
    visit_cep: '',
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

  // ===== Grupo automático do WhatsApp no "Adicionar Lead" =====
  // Mesmo fluxo do modal "Cadastrar Caso Viável" (Notícias): nº do lead sugerido,
  // instância autora do grupo, nome editável, link de convite salvo no lead e
  // mensagem-resumo postada no grupo recém-criado.
  const [autoCreateGroup, setAutoCreateGroup] = useState(true);
  const [groupSeq, setGroupSeq] = useState('');
  const [groupSeqLoading, setGroupSeqLoading] = useState(false);
  const [groupPrefix, setGroupPrefix] = useState('');
  const [groupAuthorId, setGroupAuthorId] = useState<string>(DEFAULT_GROUP_AUTHOR_INSTANCE_ID);
  const [groupNameInput, setGroupNameInput] = useState('');
  const groupNameTouched = useRef(false);
  const [connList, setConnList] = useState<InstanceConnStatus[]>([]);
  const [connLoading, setConnLoading] = useState(false);
  const [boardInstanceIds, setBoardInstanceIds] = useState<string[]>([]);
  const [showCreatorPicker, setShowCreatorPicker] = useState(false);
  const [addingLead, setAddingLead] = useState(false);
  const [groupSteps, setGroupSteps] = useState<{ save: 'idle' | 'running' | 'done' | 'error'; group: 'idle' | 'running' | 'done' | 'error'; link: 'idle' | 'running' | 'done' | 'error' }>(
    { save: 'idle', group: 'idle', link: 'idle' }
  );

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

  // Filter boards by category (Trabalhista vs Previdenciário) based on board name
  const categoryRegex = useMemo(() => {
    if (category === 'trabalhista') return /trab|acidente|\bcat\b|cipa/i;
    if (category === 'previdenciario') return /prev|inss|bpc|benef|aposent|auxi?lio|loas|pensão|pensao|seguro\s+de\s+vida/i;
    return null;
  }, [category]);

  const visibleBoards = useMemo(() => {
    if (category === 'trabalhista') {
      return boards.filter(b => /acidente\s+de\s+trabalho/i.test(b.name));
    }
    if (!categoryRegex) return boards;
    return boards.filter(b => categoryRegex.test(b.name) || categoryRegex.test(b.description || ''));
  }, [boards, categoryRegex, category]);

  // Auto-select first visible board when category changes
  useEffect(() => {
    if (!categoryRegex || visibleBoards.length === 0) return;
    if (!selectedBoardId || !visibleBoards.some(b => b.id === selectedBoardId)) {
      // Para Previdenciário, abrir em "Auxílio Acidente" por padrão quando disponível
      const defaultBoard =
        category === 'previdenciario'
          ? visibleBoards.find(b =>
              /aux[íi]lio\s*acidente|aux\.?\s*acidente/i.test(b.name)
            )
          : undefined;
      setSelectedBoardId(defaultBoard?.id ?? visibleBoards[0].id);
    }
  }, [categoryRegex, visibleBoards, selectedBoardId, setSelectedBoardId, category]);

  // Quadro vindo por link: ?board=<id> — botão "Abrir Kanban" dos cards de
  // funil/POP, notificações do chat, MetricDetailSheet etc. Sem isso o link é
  // ignorado e a tela sempre abre no quadro padrão.
  //
  // Este efeito TEM que ficar depois do useKanbanBoards e do auto-select por
  // categoria: efeito declarado depois roda depois, então a escolha do link é a
  // última a gravar no mesmo commit. (Mover pra cima nem compila — as deps
  // referenciam `visibleBoards`.)
  useEffect(() => {
    const boardParam = searchParams.get('board');
    if (!boardParam) return;
    // Ainda carregando os quadros: espera o próximo render pra não descartar o param.
    if (visibleBoards.length === 0) return;

    if (visibleBoards.some(b => b.id === boardParam)) {
      setSelectedBoardId(boardParam);
    } else {
      toast.error('Quadro do link não encontrado — abrindo o quadro padrão');
    }

    // Consome o param (mesmo padrão do ?openLead), pra que trocar de quadro no
    // seletor depois não seja desfeito por um re-render. Updater funcional: o
    // efeito de view/sort acima também escreve na URL no mesmo commit.
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('board');
      return next;
    }, { replace: true });
  }, [visibleBoards, searchParams, setSearchParams, setSelectedBoardId]);

  // Quadros do seletor: os funis (público desta tela) + o quadro selecionado
  // quando ele é um POP. O card do POP também abre o kanban por ?board=<id> e o
  // dropdown precisa mostrar o que está na tela — mas listar todos os POPs pro
  // time comercial seria só ruído.
  const selectorBoards = useMemo(() => {
    // Arquivado também sai do seletor — só entra se for o quadro aberto na tela.
    const funnels = visibleBoards.filter(b => b.board_type !== 'workflow' && !isBoardArchived(b));
    const current = visibleBoards.find(b => b.id === selectedBoardId);
    return current && !funnels.some(f => f.id === current.id) ? [...funnels, current] : funnels;
  }, [visibleBoards, selectedBoardId]);

  // Leads hook
  const {
    leads: allLeads,
    loading: leadsLoading,
    fetchLeads,
    addLead,
    updateLead,
    deleteLead,
  } = useLeads(adAccountId, { detailLevel: 'index', boardId: selectedBoardId || undefined });

  // Stage history hook
  const { addHistoryEntry } = useLeadStageHistory();
  const { createLeadInstances, markStageInstancesReadonly } = useChecklists();

  // Derive editingLead from persisted ID
  const editingLead = allLeads.find(l => l.id === editingLeadId) ?? null;

  // Quando um lead entra em edição, carrega colunas full apenas dele.
  useLeadDetails(editingLeadId ? [editingLeadId] : [], adAccountId);


  // Filter leads by selected board
  const boardLeads = useMemo(() => {
    if (!selectedBoardId) return allLeads;
    return allLeads.filter(lead => lead.board_id === selectedBoardId);
  }, [allLeads, selectedBoardId]);

  // Cards virtuais da planilha (Meta Ads) — só para boards com sheet conectada.
  const {
    virtualCards: sheetVirtualCards,
    firstStageId: sheetVirtualStageId,
    sheetLabel: sheetVirtualLabel,
  } = useVirtualSheetLeadsForBoard(selectedBoard, boardLeads);

  // Filtered virtual cards (apply acolhedor filter using the sheet's `operator` field).
  const displayedVirtualCards = useMemo(() => {
    if (!acolhedorFilter) return sheetVirtualCards;
    return sheetVirtualCards.filter((c) => (c.operator || '') === acolhedorFilter);
  }, [sheetVirtualCards, acolhedorFilter]);

  // Union de acolhedores (kanban) + operadores (planilha) pro dropdown.
  const acolhedorOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of boardLeads) {
      const v = (l as any).acolhedor;
      if (v) set.add(String(v));
    }
    for (const c of sheetVirtualCards) {
      if (c.operator) set.add(c.operator);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [boardLeads, sheetVirtualCards]);

  // Filter leads by search query, checklist filter, and advanced filters
  const filteredLeads = useMemo(() => {
    let result = boardLeads;
    
    // Apply checklist filter
    if (checklistFilteredIds !== null) {
      result = result.filter(lead => checklistFilteredIds.has(lead.id));
    }
    
    // Apply acolhedor filter
    if (acolhedorFilter) {
      result = result.filter(lead => ((lead as any).acolhedor || '') === acolhedorFilter);
    }
    
    // Apply search filter — busca por nome, telefone ou número do caso
    if (searchQuery) {
      const query = searchQuery.toLowerCase().trim();
      const queryDigits = query.replace(/\D/g, '');
      result = result.filter(lead => {
        const nameMatch = (lead.lead_name || '').toLowerCase().includes(query);
        const phoneMatch = queryDigits.length >= 3
          ? (lead.lead_phone || '').replace(/\D/g, '').includes(queryDigits)
          : false;
        const caseMatch = (lead.case_number || '').toLowerCase().includes(query);
        return nameMatch || phoneMatch || caseMatch;
      });
    }

    // Apply advanced filters
    const hasAdvanced = hasAnyLeadFilter(advancedFilters);
    if (hasAdvanced) {
      result = applyLeadFilters(result, advancedFilters);
    }
    
    return result;
  }, [boardLeads, searchQuery, checklistFilteredIds, advancedFilters, acolhedorFilter]);

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
    return !!searchQuery || checklistFilteredIds !== null || !!acolhedorFilter || hasAnyLeadFilter(advancedFilters);
  }, [searchQuery, checklistFilteredIds, advancedFilters, acolhedorFilter]);

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

      // Política (jun/2026): mover para a etapa 'closed' (✅ Fechado) é o único
      // momento em que o lead vira closed de verdade. Aqui disparamos os efeitos
      // colaterais: lead_status, became_client_date e criação do legal_case.
      if (stageId === 'closed' && (currentLead as any)?.lead_status !== 'closed') {
        try {
          const today = new Date().toISOString().slice(0, 10);
          await externalSupabase
            .from('leads')
            .update({ lead_status: 'closed', became_client_date: today } as any)
            .eq('id', leadId);

          const { data: existingCases } = await externalSupabase
            .from('legal_cases')
            .select('id')
            .eq('lead_id', leadId)
            .limit(1);

          if (!existingCases || existingCases.length === 0) {
            const { data: leadProdRow } = await externalSupabase
              .from('leads')
              .select('product_service_id')
              .eq('id', leadId)
              .maybeSingle();
            const productId = (leadProdRow as any)?.product_service_id || null;
            const { data: caseNumber } = await externalSupabase
              .rpc('generate_case_number', { p_product_id: productId } as any);
            const { data: { user } } = await supabase.auth.getUser();
            await externalSupabase.from('legal_cases').insert({
              lead_id: leadId,
              case_number: caseNumber || 'CASO-0001',
              title: `Caso - ${currentLead?.lead_name || 'Novo'}`,
              status: 'em_andamento',
              created_by: user?.id || null,
            } as any);
            toast.success(`Lead fechado! Caso ${caseNumber || ''} criado.`);
          } else {
            toast.success('Lead movido para Fechado');
          }
        } catch (closeErr) {
          console.error('Erro ao fechar lead:', closeErr);
          toast.error('Card movido, mas falhou ao registrar fechamento');
        }
      }

      
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

        // Sincroniza etiqueta no WhatsApp (fire-and-forget, com reversão em erro)
        if (currentLead?.board_id) {
          import('@/lib/functionRouter').then(({ cloudFunctions }) => {
            cloudFunctions
              .invoke('apply-stage-label', {
                body: {
                  lead_id: leadId,
                  board_id: currentLead.board_id,
                  new_stage_id: stageId,
                  old_stage_id: oldStage,
                },
              })
              .then(({ data, error }) => {
                if (error || !(data as any)?.success) {
                  const msg = (data as any)?.error || error?.message || 'falha desconhecida';
                  // Não reverte a etapa — sincronização da etiqueta é best-effort
                  if (!/sem lead_phone|lead_phone/i.test(String(msg))) {
                    toast.warning(`Etiqueta WhatsApp não sincronizada: ${msg}`);
                  }
                } else {
                  const okCount = ((data as any).results || []).filter((r: any) => r?.added?.ok).length;
                  if (okCount > 0) toast.success(`Etiqueta aplicada em ${okCount} instância(s) do WhatsApp`);
                }
              })
              .catch((e) => {
                toast.warning(`Etiqueta WhatsApp falhou: ${e?.message || 'erro'}`);
              });

          });
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

  // Selected board for the new-lead dialog (independent of page-level selection)
  const [selectedBoardForNewLead, setSelectedBoardForNewLead] = useState<string | null>(null);

  // Sync default whenever dialog opens
  useEffect(() => {
    if (showAddLeadDialog) {
      setSelectedBoardForNewLead(prev => prev ?? selectedBoardId ?? null);
    }
  }, [showAddLeadDialog, selectedBoardId]);

  const boardIdForNewLead = selectedBoardForNewLead || selectedBoardId || null;

  const refreshConnStatus = useCallback(async () => {
    setConnLoading(true);
    try {
      const rows = await fetchInstanceConnStatus();
      setConnList(rows);
      return rows;
    } finally {
      setConnLoading(false);
    }
  }, []);

  // Ao abrir o dialog (ou trocar de funil): status das instâncias, instâncias
  // vinculadas ao funil, prefixo da sequência e o próximo nº sugerido.
  useEffect(() => {
    if (!showAddLeadDialog || !boardIdForNewLead) return;
    let cancelled = false;
    groupNameTouched.current = false;
    setGroupSteps({ save: 'idle', group: 'idle', link: 'idle' });
    refreshConnStatus();
    fetchBoardInstanceIds(boardIdForNewLead).then(ids => { if (!cancelled) setBoardInstanceIds(ids); });
    setGroupSeq('');
    setGroupSeqLoading(true);
    fetchBoardSequencePrefix(boardIdForNewLead)
      .then(async (prefix) => {
        if (cancelled) return;
        setGroupPrefix(prefix);
        const n = await suggestNextSequence(boardIdForNewLead, prefix || 'LEAD');
        if (!cancelled) setGroupSeq(n ? String(n) : '');
      })
      .finally(() => { if (!cancelled) setGroupSeqLoading(false); });
    return () => { cancelled = true; };
  }, [showAddLeadDialog, boardIdForNewLead, refreshConnStatus]);

  // Instâncias oferecidas como autoras: as vinculadas ao funil (mesma tabela que
  // o edge consulta). Sem vínculo cadastrado, cai na lista completa.
  const groupAuthorOptions = useMemo(() => {
    const known = new Map(GROUP_AUTHOR_OPTIONS.map(o => [o.instanceId, o.label]));
    const pool = boardInstanceIds.length
      ? connList.filter(r => boardInstanceIds.includes(r.id))
      : connList;
    const rows = pool.length ? pool : connList;
    return rows.map(r => ({
      instanceId: r.id,
      label: known.get(r.id) || r.instance_name,
      connected: r.connected,
    }));
  }, [connList, boardInstanceIds]);

  // Mantém a seleção válida: se a instância padrão não serve para este funil,
  // escolhe a primeira conectada da lista.
  useEffect(() => {
    if (!groupAuthorOptions.length) return;
    if (groupAuthorOptions.some(o => o.instanceId === groupAuthorId)) return;
    const fallback = groupAuthorOptions.find(o => o.connected) || groupAuthorOptions[0];
    setGroupAuthorId(fallback.instanceId);
  }, [groupAuthorOptions, groupAuthorId]);

  // Nome do grupo = mesmo padrão do nome do lead ("<prefixo> <n> | <nome>"),
  // para grupo e lead não divergirem. Editável: depois de mexer, o input manda.
  const groupNamePreview = useMemo(() => {
    const base = newLeadFormData.lead_name.trim();
    if (!base) return '';
    const prefix = groupPrefix.trim();
    if (!prefix) return base;
    return `${prefix} ${groupSeq || '?'} | ${base}`;
  }, [newLeadFormData.lead_name, groupPrefix, groupSeq]);

  useEffect(() => {
    if (!groupNameTouched.current) setGroupNameInput(groupNamePreview);
  }, [groupNamePreview]);

  const connMap = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const r of connList) m[r.id] = r.connected;
    return m;
  }, [connList]);

  const handleAddLead = async () => {
    if (!newLeadFormData.lead_name.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }
    if (!(selectedBoardForNewLead || selectedBoardId)) {
      toast.error('Selecione um funil');
      return;
    }

    // Guard de conexão: se a instância-autora escolhida está offline, abre o
    // seletor de outra criadora ANTES de qualquer escrita (igual ao fluxo de
    // Notícias). Status desconhecido → segue e o backend enfileira.
    if (autoCreateGroup) {
      let rows = connList;
      if (!rows.length) rows = await refreshConnStatus();
      const selected = rows.find(r => r.id === groupAuthorId);
      if (selected && !selected.connected) {
        setShowCreatorPicker(true);
        return;
      }
    }

    await proceedAddLead(groupAuthorId);
  };

  const proceedAddLead = async (creatorInstanceId: string) => {
    // CEP da visita é opcional em todos os funis (ago/2026): quem pede o CEP é o
    // dialog da tarefa de Marketing, não o salvamento do lead.
    const targetBoardId = selectedBoardForNewLead || selectedBoardId;
    if (!targetBoardId) {
      toast.error('Selecione um funil');
      return;
    }

    const targetBoard = boards.find(b => b.id === targetBoardId) || selectedBoard;
    const firstStage = targetBoard?.stages[0]?.id || 'new';

    setAddingLead(true);
    setGroupSteps({ save: 'running', group: 'idle', link: 'idle' });

    // Apply funnel naming pattern: "<prefix> <N> | <user-typed name>"
    // O nº vem do campo editável do dialog (sugerido por suggestNextSequence, que
    // olha contador + maior lead_number + grupos reais) e é confirmado contra
    // colisões na tabela leads antes de gravar.
    let finalLeadName = newLeadFormData.lead_name.trim();
    let usedSequence: number | null = null;
    try {
      const typedSeq = Number(groupSeq) > 0 ? Number(groupSeq) : 0;
      if (typedSeq > 0) {
        usedSequence = await nextFreeLeadNumber(targetBoardId, typedSeq);
        if (usedSequence !== typedSeq) setGroupSeq(String(usedSequence));
      }
      if (groupPrefix.trim() && usedSequence) {
        finalLeadName = `${groupPrefix.trim()} ${usedSequence} | ${finalLeadName}`;
      }
    } catch (err) {
      console.warn('[handleAddLead] could not resolve funnel sequence, using raw name:', err);
    }

    const leadPayload = {
      lead_name: finalLeadName,
      lead_phone: newLeadFormData.lead_phone || null,
      lead_email: newLeadFormData.lead_email || null,
      notes: newLeadFormData.notes || null,
      source: newLeadFormData.source,
      status: firstStage as LeadStatus,
      board_id: targetBoardId,
      // Campanha de origem: o vínculo do CRM (métricas) + a referência crua do Meta
      crm_campaign_id: newLeadFormData.crm_campaign_id || null,
      campaign_id: newLeadFormData.campaign_id || null,
      campaign_name: newLeadFormData.campaign_name || null,
      // Accident-specific fields
      acolhedor: newLeadFormData.acolhedor || null,
      case_type: newLeadFormData.case_type || null,
      group_link: newLeadFormData.group_link || null,
      visit_cep: newLeadFormData.visit_cep || null,
      visit_city: newLeadFormData.visit_city || null,
      visit_state: newLeadFormData.visit_state || null,
      visit_region: newLeadFormData.visit_region || null,
      visit_address: newLeadFormData.visit_address || null,
      accident_date: normalizeDateInput(newLeadFormData.accident_date),
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
      expected_birth_date: normalizeDateInput(newLeadFormData.expected_birth_date),
      ...(usedSequence ? { lead_number: usedSequence } : {}),
    } as Partial<Lead>;

    // O grupo é criado logo abaixo com o fluxo completo (autor, nº, link e
    // resumo) — `skipAutoGroup` evita que o hook dispare uma segunda criação.
    // Uma colisão na unique (product_id, lead_number) pode acontecer quando dois
    // operadores cadastram ao mesmo tempo: relê a sequência e tenta de novo.
    let createdLead: Lead | null = null;
    try {
      createdLead = await addLead(leadPayload, undefined, { skipAutoGroup: true });
      setGroupSteps(s => ({ ...s, save: 'done' }));
    } catch (err: any) {
      const isDup = /leads_product_lead_number_uniq|duplicate key/i.test(String(err?.message || ''));
      if (!isDup || !usedSequence) {
        setGroupSteps(s => ({ ...s, save: 'error' }));
        setAddingLead(false);
        return; // addLead já mostrou o toast de erro
      }
      try {
        const suggested = await suggestNextSequence(targetBoardId, groupPrefix || 'LEAD');
        const retrySeq = await nextFreeLeadNumber(targetBoardId, Math.max(usedSequence + 1, suggested || 0));
        setGroupSeq(String(retrySeq));
        const retryName = groupPrefix.trim()
          ? `${groupPrefix.trim()} ${retrySeq} | ${newLeadFormData.lead_name.trim()}`
          : finalLeadName;
        finalLeadName = retryName;
        usedSequence = retrySeq;
        createdLead = await addLead(
          { ...leadPayload, lead_name: retryName, lead_number: retrySeq } as Partial<Lead>,
          undefined,
          { skipAutoGroup: true }
        );
        setGroupSteps(s => ({ ...s, save: 'done' }));
      } catch {
        setGroupSteps(s => ({ ...s, save: 'error' }));
        setAddingLead(false);
        return;
      }
    }

    // Bump board sequence counter when prefix was applied
    if (usedSequence !== null) {
      try {
        await supabase
          .from('board_group_settings')
          .update({ current_sequence: usedSequence })
          .eq('board_id', targetBoardId);
      } catch (err) {
        console.warn('[handleAddLead] failed to bump board sequence:', err);
      }
    }

    // Grupo do WhatsApp — mesmo fluxo do modal de Notícias.
    if (autoCreateGroup && createdLead?.id) {
      const outcome = await createLeadWhatsappGroup({
        leadId: createdLead.id,
        leadName: finalLeadName,
        boardId: targetBoardId,
        creationOrigin: 'adicionar_lead',
        creatorInstanceId,
        forcedSequence: usedSequence,
        groupNameOverride: groupNameInput.trim() || null,
        phone: newLeadFormData.lead_phone || null,
        introMessage: (inviteLink) => composeGroupIntroMessage(
          {
            lead_title: finalLeadName,
            acolhedor: newLeadFormData.acolhedor,
            case_type: newLeadFormData.case_type,
            source_label: newLeadFormData.source || 'Manual',
            phone: newLeadFormData.lead_phone,
            visit_city: newLeadFormData.visit_city,
            visit_state: newLeadFormData.visit_state,
            visit_region: newLeadFormData.visit_region,
            visit_address: newLeadFormData.visit_address,
            accident_date: normalizeDateInput(newLeadFormData.accident_date) || '',
            damage: newLeadFormData.damage_description,
            victim_name: newLeadFormData.victim_name,
            victim_age: newLeadFormData.victim_age,
            accident_address: newLeadFormData.accident_address,
            contractor_company: newLeadFormData.contractor_company,
            main_company: newLeadFormData.main_company,
            news_link: newLeadFormData.news_link,
            company_size_justification: newLeadFormData.company_size_justification,
            liability_type: newLeadFormData.liability_type,
            legal_viability: newLeadFormData.legal_viability,
          },
          inviteLink,
          // Funis fora do Trabalhista não têm os campos de acidente: sem isso o
          // resumo viraria uma parede de "Não informado".
          { omitEmpty: !isTrabalhistaBoard(targetBoardId) }
        ),
        onStep: (step, state) => {
          if (step === 'group') setGroupSteps(s => ({ ...s, group: state === 'error' ? 'error' : state }));
          if (step === 'link') setGroupSteps(s => ({ ...s, link: state === 'error' ? 'error' : state }));
        },
      });

      if (outcome.queued) {
        toast.info('Lead cadastrado. Instâncias offline: grupo entrou na fila e será criado automaticamente.', { duration: 8000 });
      } else if (outcome.groupError) {
        toast.error('Lead cadastrado, mas a criação do grupo falhou', { description: outcome.groupError, duration: 8000 });
      } else if (outcome.linkError) {
        toast.warning('Grupo criado, mas não foi possível obter o link de convite agora.', { description: outcome.linkError, duration: 8000 });
      } else {
        toast.success('Grupo criado e link salvo no lead.');
      }
      if (outcome.introError) {
        toast.warning('Grupo criado, mas não consegui enviar o resumo automático.', { description: outcome.introError });
      }
      fetchLeads();
    }

    setAddingLead(false);

    // Reset form
    setNewLeadFormData({
      lead_name: '',
      lead_phone: '',
      lead_email: '',
      source: 'manual',
      notes: '',
      crm_campaign_id: '',
      campaign_id: '',
      campaign_name: '',
      acolhedor: '',
      case_type: '',
      group_link: '',
      client_classification: '',
      expected_birth_date: '',
      visit_cep: '',
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
    setSelectedBoardForNewLead(null);
    setShowAddLeadDialog(false);
    groupNameTouched.current = false;
    setGroupNameInput('');
    setGroupSteps({ save: 'idle', group: 'idle', link: 'idle' });
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
      accident_date: normalizeDateInput(data.accident_date) || prev.accident_date,
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
      // Região é derivada da UF; o extrator já manda quando caiu no local do acidente.
      visit_region: data.visit_region || regionForUf(data.visit_state) || prev.visit_region,
      visit_address: data.visit_address || prev.visit_address,
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
            boards={selectorBoards}
            selectedBoardId={selectedBoardId}
            onSelectBoard={setSelectedBoardId}
            onCreateBoard={createBoard}
            onUpdateBoard={updateBoard}
            onDeleteBoard={deleteBoard}
            leadsCountByBoard={leadsCountByBoard}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex items-center rounded-md border p-0.5"
            role="group"
            aria-label="Alternar visualização"
          >
            <Button
              variant={viewMode === 'kanban' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 px-2"
              aria-pressed={viewMode === 'kanban'}
              title="Visualização em colunas (kanban)"
              onClick={() => setViewMode('kanban')}
            >
              <Columns3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 px-2"
              aria-pressed={viewMode === 'list'}
              title="Visualização em lista"
              onClick={() => setViewMode('list')}
            >
              <List className="h-4 w-4" />
            </Button>
            {visitsViewAvailable && (
              <Button
                variant={viewMode === 'visitas' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-8 px-2 gap-1.5"
                aria-pressed={viewMode === 'visitas'}
                title="Calendário das visitas das assistentes sociais"
                onClick={() => setViewMode('visitas')}
              >
                <HeartHandshake className="h-4 w-4" />
                <span className="hidden lg:inline text-xs">Visitas</span>
              </Button>
            )}
          </div>

          {/* Filtros de lead nao valem para o calendario de visitas. */}
          {viewMode !== 'visitas' && (
            <>
            <div className="relative flex-1 min-w-[150px] max-w-[250px]">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar leads..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 w-full"
              />
            </div>
          
            <Select
              value={acolhedorFilter || '__all__'}
              onValueChange={(v) => setAcolhedorFilter(v === '__all__' ? '' : v)}
            >
              <SelectTrigger className="w-[180px] h-9" title="Filtrar por acolhedor">
                <SelectValue placeholder="Acolhedor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos os acolhedores</SelectItem>
                {acolhedorOptions.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="outline" size="icon" onClick={() => fetchLeads()}>
              <RefreshCw className="h-4 w-4" />
            </Button>

            {selectedBoard && (
              <Button variant="outline" onClick={() => setShowReport(true)}>
                <FileText className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Relatório</span>
              </Button>
            )}

            {/* Captação por escuta de grupo: o relato vira lead deste mesmo
                funil, então o caminho até a fila fica aqui, e não num canto
                do menu que ninguém abre. */}
            <Button
              variant="outline"
              onClick={() => navigate('/leads/relatos-grupos')}
              title="Relatos de acidente ouvidos nos grupos de WhatsApp"
            >
              <Ear className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Relatos nos grupos</span>
              {relatosPendentes > 0 && (
                <Badge variant="destructive" className="ml-2">{relatosPendentes}</Badge>
              )}
            </Button>
          
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
            </>
          )}
        </div>
      </div>

      {/* Advanced Filters */}
      {viewMode !== 'visitas' && (
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
      )}

      {/* Calendário das visitas dos leads deste funil */}
      {viewMode === 'visitas' && (
        selectedBoardId ? (
          <Suspense fallback={<div className="text-center py-12 text-muted-foreground">Carregando agenda de visitas...</div>}>
            <SocialVisitsModule boardId={selectedBoardId} embedded />
          </Suspense>
        ) : (
          // Sem funil não há recorte: melhor pedir a escolha do que despejar a agenda inteira.
          <div className="text-center py-12 text-sm text-muted-foreground">
            Escolha um funil acima para ver as visitas dos leads dele.
          </div>
        )
      )}

      {/* Analytics: Funnel Chart and Stage Time Metrics - Collapsible */}
      {viewMode !== 'visitas' && selectedBoard && boardLeads.length > 0 && (
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

      {/* Lista (mesmo estado de filtro/busca do kanban; dados server-side) */}
      {selectedBoard && viewMode === 'list' && (
        <LeadListView
          board={selectedBoard}
          searchQuery={searchQuery}
          acolhedorFilter={acolhedorFilter}
          advancedFilters={advancedFilters}
          checklistFilteredIds={checklistFilteredIds}
          chips={listChips}
          onChipsChange={setListChips}
          sort={listSort}
          onSortChange={setListSort}
          onOpenLead={(leadId) => setEditingLeadId(leadId)}
          onMoveToStage={handleMoveToStage}
          onAssignAcolhedor={async (leadId, acolhedor) => {
            await updateLead(leadId, { acolhedor } as any);
          }}
          onDeleteLead={deleteLead}
        />
      )}

      {/* Kanban Board */}
      {selectedBoard && viewMode !== 'kanban' ? null : selectedBoard ? (
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
          virtualCards={displayedVirtualCards}
          virtualStageId={sheetVirtualStageId}
          virtualSheetLabel={sheetVirtualLabel}
          onChangeLeadStatus={async (leadId, newStatus) => {
            try {
              // Get current lead data for history
              const { data: currentLead } = await supabase
                .from('leads')
                .select('status, board_id, lead_status, lead_name, case_type')
                .eq('id', leadId)
                .single();

              const { data: { user } } = await supabase.auth.getUser();

              // When reactivating a lead, also move it back to the first stage (Triagem/Caixa de Entrada)
              // of its board, otherwise the card stays visually in the "Fechados" column because the
              // Kanban groups by `status` (stage), not by `lead_status`.
              const updatePayload: any = { lead_status: newStatus };
              if (newStatus === 'no_response' || newStatus === 'active') {
                // Resolve target board (lead might be on a different board than the currently selected one)
                const targetBoard =
                  boards.find(b => b.id === currentLead?.board_id) || selectedBoard;
                const firstStageId = targetBoard?.stages?.[0]?.id;
                if (firstStageId) {
                  updatePayload.status = firstStageId;
                }
                // Clear closure markers so the lead is fully reopened
                updatePayload.became_client_date = null;
                updatePayload.inviavel_date = null;
                updatePayload.cancelled_date = null;
              }

              await externalSupabase.from('leads').update(updatePayload).eq('id', leadId);

              // Record in lead_stage_history so productivity metrics track it
              await externalSupabase.from('lead_stage_history').insert({
                lead_id: leadId,
                from_stage: (currentLead as any)?.lead_status || 'no_response',
                to_stage: newStatus,
                from_board_id: currentLead?.board_id || selectedBoardId,
                to_board_id: currentLead?.board_id || selectedBoardId,
                changed_by: user?.id || null,
                notes: newStatus === 'closed' ? 'Lead fechado' : newStatus === 'refused' ? 'Lead recusado' : newStatus === 'inviavel' ? 'Lead inviável' : newStatus === 'cancelled' ? 'Lead cancelado' : 'Lead reativado',
              } as any);

              // Record in lead_status_history
              await supabase.from('lead_status_history' as any).insert({
                lead_id: leadId,
                from_status: (currentLead as any)?.lead_status || 'no_response',
                to_status: newStatus,
                changed_by: user?.id || null,
                changed_by_type: 'manual',
              });

              // Auto-create legal case when closing
              if (newStatus === 'closed') {
                // Set became_client_date
                await externalSupabase.from('leads').update({
                  became_client_date: new Date().toISOString().slice(0, 10),
                } as any).eq('id', leadId);

                const { data: existingCases } = await externalSupabase
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

                  // Lookup product_service_id on lead to drive per-product sequence
                  const { data: leadProdRow } = await externalSupabase
                    .from('leads')
                    .select('product_service_id')
                    .eq('id', leadId)
                    .maybeSingle();
                  const productId = (leadProdRow as any)?.product_service_id || null;
                  const { data: caseNumber } = await externalSupabase
                    .rpc('generate_case_number', { p_product_id: productId } as any);

                  const { data: createdCase } = await externalSupabase.from('legal_cases').insert({
                    lead_id: leadId,
                    nucleus_id: matchedNucleusId,
                    case_number: caseNumber || 'CASO-0001',
                    title: `Caso - ${currentLead?.lead_name || 'Novo'}`,
                    status: 'em_andamento',
                    created_by: user?.id,
                  } as any).select('id').single();

                  // Auto-create process tracking record
                  if (createdCase?.id) {
                    try {
                      await externalSupabase.from('case_process_tracking').insert({
                        case_id: createdCase.id,
                        lead_id: leadId,
                        cliente: currentLead?.lead_name || '',
                        caso: `Caso - ${currentLead?.lead_name || 'Novo'}`,
                        tipo: (currentLead as any)?.case_type || null,
                        acolhedor: (currentLead as any)?.acolhedor || null,
                        data_criacao: new Date().toISOString().split('T')[0],
                        import_source: 'auto_lead_close',
                      } as any);
                    } catch (trackErr) {
                      console.warn('Could not auto-create tracking record:', trackErr);
                    }
                  }

                  // Auto-create ONBOARDING activity for CASO-prefixed cases
                  if (caseNumber && caseNumber.startsWith('CASO')) {
                    try {
                      const WANESSA_USER_ID = '1f788b8d-e30e-484a-9460-39a881d25128';
                      const WANESSA_NAME = 'Wanessa Vitória Rodrigues de Sousa';
                      const extAssignedTo = await remapToExternal(WANESSA_USER_ID);
                      const extCreatedBy = await remapToExternal(user?.id);
                      await externalSupabase.from('lead_activities').insert({
                        lead_id: leadId,
                        lead_name: currentLead?.lead_name || 'Novo',
                        title: 'ONBOARDING CLIENTE',
                        description: `Atividade de onboarding criada automaticamente para o caso ${caseNumber}`,
                        activity_type: 'tarefa',
                        status: 'pendente',
                        priority: 'alta',
                        assigned_to: extAssignedTo,
                        assigned_to_name: WANESSA_NAME,
                        created_by: extCreatedBy,
                        deadline: new Date().toISOString().split('T')[0],
                        // Sem case_id a atividade nasce órfã do caso que a gerou; sem
                        // notification_date, o Salvar do editor reprova qualquer edição.
                        case_id: createdCase?.id || null,
                        case_title: `${caseNumber} - Caso - ${currentLead?.lead_name || 'Novo'}`,
                        notification_date: new Date().toISOString().split('T')[0],
                      } as any);
                    } catch (onbErr) {
                      console.warn('Could not auto-create onboarding activity:', onbErr);
                    }
                  }

                  toast.success(`Lead fechado! Caso ${caseNumber} criado automaticamente.`);
                } else {
                  toast.success('Lead marcado como Fechado');
                }
              } else if (newStatus === 'inviavel') {
                await externalSupabase.from('leads').update({
                  inviavel_date: new Date().toISOString().slice(0, 10),
                } as any).eq('id', leadId);
                toast.success('Lead marcado como Inviável');
              } else if (newStatus === 'cancelled') {
                await externalSupabase.from('leads').update({
                  cancelled_date: new Date().toISOString().slice(0, 10),
                } as any).eq('id', leadId);
                toast.success('Lead marcado como Cancelado');
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

          <div className="mb-4">
            <Label>Funil de Vendas *</Label>
            <Select
              value={selectedBoardForNewLead || selectedBoardId || ''}
              onValueChange={(v) => setSelectedBoardForNewLead(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione um funil..." />
              </SelectTrigger>
              <SelectContent>
                {boards.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <AccidentLeadForm
            formData={newLeadFormData}
            onChange={(data) => setNewLeadFormData(prev => ({ ...prev, ...data }))}
            onOpenExtractor={() => setShowExtractor(true)}
            teamMembers={teamProfiles}
            classifications={classifications}
            boardId={selectedBoardForNewLead || selectedBoardId}
            boardName={boards.find(b => b.id === (selectedBoardForNewLead || selectedBoardId))?.name}
          />

          {/* Grupo do WhatsApp — mesmo fluxo do "Cadastrar Caso Viável" (Notícias) */}
          <div className="rounded-lg border p-3 bg-muted/30 space-y-3 text-sm mt-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={autoCreateGroup}
                onCheckedChange={(v) => setAutoCreateGroup(v === true)}
              />
              <span className="font-medium flex items-center gap-1.5">
                <Users className="h-4 w-4" />
                Criar grupo do WhatsApp automaticamente
              </span>
            </label>

            {autoCreateGroup && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Número do Lead (grupo)</Label>
                    <Input
                      value={groupSeq}
                      onChange={(e) => setGroupSeq(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder={groupSeqLoading ? 'Calculando...' : 'Ex: 170'}
                      disabled={groupSeqLoading}
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Sugerido a partir do último grupo criado — ajuste se estiver errado.
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Autor do grupo</Label>
                    <Select value={groupAuthorId} onValueChange={setGroupAuthorId}>
                      <SelectTrigger>
                        <SelectValue placeholder={connLoading ? 'Carregando...' : 'Selecione...'} />
                      </SelectTrigger>
                      <SelectContent>
                        {groupAuthorOptions.map((a) => (
                          <SelectItem key={a.instanceId} value={a.instanceId}>
                            <span className="flex items-center gap-2">
                              <span
                                className={`h-2 w-2 rounded-full shrink-0 ${a.connected ? 'bg-emerald-500' : 'bg-red-500'}`}
                                title={a.connected ? 'Conectada' : 'Desconectada'}
                              />
                              {a.label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {connMap[groupAuthorId] === false && (
                      <p className="text-[11px] text-red-600 mt-1">
                        Instância desconectada — ao adicionar você escolhe outra criadora do grupo.
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">Nome do grupo (editável)</Label>
                  <Input
                    value={groupNameInput}
                    onChange={(e) => { groupNameTouched.current = true; setGroupNameInput(e.target.value); }}
                    placeholder="Nome exato do grupo do WhatsApp"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Pré-preenchido com o padrão do funil — edite se quiser. Vazio, o nome vem do template do funil.
                  </p>
                </div>

                <div className="flex gap-2 flex-wrap">
                  {([
                    [groupSteps.save, 'Salvar lead', <CheckCircle2 key="s" className="h-3 w-3 mr-1" />],
                    [groupSteps.group, 'Criar grupo', <Users key="g" className="h-3 w-3 mr-1" />],
                    [groupSteps.link, 'Obter link', <Link2 key="l" className="h-3 w-3 mr-1" />],
                  ] as const).map(([state, label, icon]) => (
                    <Badge
                      key={label}
                      variant="outline"
                      className={
                        state === 'done' ? 'border-emerald-500 text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30'
                          : state === 'running' ? 'border-blue-500 text-blue-700 bg-blue-50 dark:bg-blue-900/30'
                            : state === 'error' ? 'border-red-500 text-red-700 bg-red-50 dark:bg-red-900/30'
                              : 'text-muted-foreground'
                      }
                    >
                      {state === 'running' ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : icon}
                      {label}
                    </Badge>
                  ))}
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddLeadDialog(false)} disabled={addingLead}>
              Cancelar
            </Button>
            <Button onClick={handleAddLead} disabled={addingLead} className="gap-2">
              {addingLead && <Loader2 className="h-4 w-4 animate-spin" />}
              {addingLead ? 'Adicionando...' : 'Adicionar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Seletor de instância criadora — abre quando o autor escolhido está offline */}
      <Dialog open={showCreatorPicker} onOpenChange={(v) => !addingLead && setShowCreatorPicker(v)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <WifiOff className="h-5 w-5 text-red-500" />
              Instância criadora offline
            </DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {groupAuthorOptions.find(a => a.instanceId === groupAuthorId)?.label || 'A instância selecionada'}
            </span>{' '}
            está desconectada e não pode criar o grupo. Escolha outra instância conectada para ser a
            criadora/dona do grupo.
          </p>

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {connLoading ? 'Verificando conexões...' : `${connList.filter(r => r.connected).length} instância(s) conectada(s)`}
            </span>
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => refreshConnStatus()} disabled={connLoading}>
              <RefreshCw className={`h-3 w-3 ${connLoading ? 'animate-spin' : ''}`} /> Atualizar
            </Button>
          </div>

          <div className="space-y-1 max-h-[50vh] overflow-y-auto">
            {connList.filter(r => r.connected).map((r) => (
              <button
                key={r.id}
                type="button"
                disabled={addingLead}
                onClick={() => { setGroupAuthorId(r.id); setShowCreatorPicker(false); proceedAddLead(r.id); }}
                className="w-full flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-60"
              >
                <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                {r.instance_name}
              </button>
            ))}
            {connList.filter(r => r.connected).length === 0 && !connLoading && (
              <p className="text-sm text-muted-foreground">
                Nenhuma instância conectada no momento. Ao adicionar mesmo assim, o grupo entra na fila
                e é criado automaticamente quando uma instância reconectar.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreatorPicker(false)} disabled={addingLead}>Cancelar</Button>
            <Button
              variant="secondary"
              disabled={addingLead}
              onClick={() => { setShowCreatorPicker(false); proceedAddLead(groupAuthorId); }}
            >
              Adicionar mesmo assim (fila)
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
              setLeadAsSheet(false);
            }
          }}
          lead={editingLead}
          onSave={async (leadId, updates) => {
            await updateLead(leadId, updates);
            fetchLeads();
          }}
          onDeleted={() => {
            setEditingLeadId(null);
            fetchLeads();
          }}
          adAccountId={adAccountId}
          boards={boards}
          initialTab={initialLeadTab}
          mode={leadAsSheet ? 'sheet' : 'dialog'}
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
