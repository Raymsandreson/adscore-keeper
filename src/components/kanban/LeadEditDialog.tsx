import { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { safeSelectValue } from '@/utils/selectValue';
import { sendLeadConversionEvent } from '@/utils/metaConversionTracking';
import { facebookCAPI } from '@/services/facebookCAPI';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { useProfilesList } from '@/hooks/useProfilesList';
import { generateLeadName } from '@/utils/generateLeadName';
import { findClosedStageId, findRefusedStageId } from '@/utils/kanbanStageTypes';
import { useCampaigns } from '@/hooks/useCampaigns';
const LeadLinkedContacts = lazy(() => import('@/components/leads/LeadLinkedContacts').then(m => ({ default: m.LeadLinkedContacts })));
const LeadLinkedComments = lazy(() => import('@/components/leads/LeadLinkedComments').then(m => ({ default: m.LeadLinkedComments })));
const LeadNewsLinksManager = lazy(() => import('@/components/leads/LeadNewsLinksManager').then(m => ({ default: m.LeadNewsLinksManager })));
const EntityAIChat = lazy(() => import('@/components/activities/EntityAIChat').then(m => ({ default: m.EntityAIChat })));
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { Lead } from '@/hooks/useLeads';
import { useLeadCustomFields, FieldType, CustomFieldValue } from '@/hooks/useLeadCustomFields';
import { useContactClassifications } from '@/hooks/useContactClassifications';
import { useProfileNames } from '@/hooks/useProfileNames';
import { useBrazilianLocations } from '@/hooks/useBrazilianLocations';
const CustomFieldsConfigPanel = lazy(() => import('@/components/leads/CustomFieldsConfigPanel').then(m => ({ default: m.CustomFieldsConfigPanel })));
const LeadFieldsUnifiedEditor = lazy(() => import('@/components/leads/LeadFieldsUnifiedEditor').then(m => ({ default: m.LeadFieldsUnifiedEditor })));
const LeadStageHistoryPanel = lazy(() => import('@/components/kanban/LeadStageHistoryPanel').then(m => ({ default: m.LeadStageHistoryPanel })));

const LeadFunnelOverview = lazy(() => import('@/components/kanban/LeadFunnelOverview').then(m => ({ default: m.LeadFunnelOverview })));
import { CloseLeadGroupDialog, CloseLeadContactPayload } from '@/components/leads/CloseLeadGroupDialog';
const LeadActivitiesTab = lazy(() => import('@/components/leads/LeadActivitiesTab').then(m => ({ default: m.LeadActivitiesTab })));
import { LinkOrphanWhatsAppButton } from '@/components/leads/LinkOrphanWhatsAppButton';
const AccidentDataExtractor = lazy(() => import('@/components/leads/AccidentDataExtractor').then(m => ({ default: m.AccidentDataExtractor })));
import { ExtractedAccidentData, CurrentLeadData } from '@/components/leads/AccidentDataExtractor';
import { LeadAIChatExtractor } from '@/components/leads/LeadAIChatExtractor';
const EnrichReviewDialog = lazy(() => import('@/components/leads/EnrichReviewDialog').then(m => ({ default: m.EnrichReviewDialog })));
import type { EnrichReviewData } from '@/components/leads/EnrichReviewDialog';
import { useAutoImportGroupDocs } from '@/hooks/useAutoImportGroupDocs';
import { useAutoLinkGroupByName } from '@/hooks/useAutoLinkGroupByName';
import { cn } from '@/lib/utils';
import { KanbanBoard } from '@/hooks/useKanbanBoards';
import { 
  User, 
  Phone, 
  Mail, 
  MapPin, 
  Instagram, 
  FileText, 
  Settings, 
  Calendar,
  Clock,
  History,
  Plus,
  X,
  UserCheck,
  Edit3,
  Link,
  Users,
  Building,
  Briefcase,
  Sparkles,
  Loader2,
  Scale,
  RefreshCw,
  Wrench,
  CheckSquare,
  CheckCircle,
  XCircle,
  AlertTriangle,
  DollarSign,
  ExternalLink,
  MoreVertical,
  UserPlus,
  FileSignature,
  MessageSquare,
  Send,
  ShieldCheck,
  Ban,
  Wand2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { classificationColors } from '@/hooks/useContactClassifications';
import { ShareMenu } from '@/components/ShareMenu';
const TeamChatPanel = lazy(() => import('@/components/chat/TeamChatPanel').then(m => ({ default: m.TeamChatPanel })));
const LegalCasesTab = lazy(() => import('@/components/leads/LegalCasesTab').then(m => ({ default: m.LegalCasesTab })));
const LeadFinancialsTab = lazy(() => import('@/components/leads/LeadFinancialsTab').then(m => ({ default: m.LeadFinancialsTab })));
const ContactDetailSheet = lazy(() => import('@/components/contacts/ContactDetailSheet').then(m => ({ default: m.ContactDetailSheet })));
import { Contact as ContactType } from '@/hooks/useContacts';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useLeadSources } from '@/hooks/useLeadSources';
import { useLeadFieldLayout } from '@/hooks/useLeadFieldLayout';
import { useLeadTabLayout } from '@/hooks/useLeadTabLayout';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Pencil, Trash2, Search } from 'lucide-react';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { logGroupAudit } from '@/lib/groupAuditLog';
import { useLegalCases } from '@/hooks/useLegalCases';
import LeadDocumentsTab from '@/components/leads/LeadDocumentsTab';
import { OpenWhatsAppLeadButton } from '@/components/leads/OpenWhatsAppLeadButton';
import { GroupContactSyncDialog } from '@/components/kanban/GroupContactSyncDialog';
import { LeadGroupSearchDialog } from '@/components/kanban/LeadGroupSearchDialog';
import { normalizeDateInput } from '@/utils/normalizeDateInput';
import { useChecklists } from '@/hooks/useChecklists';
import { StageLabelSelect } from '@/components/kanban/StageLabelSelect';

const leadGroupsCache = new Map<string, Array<{ id?: string; group_link: string; group_jid: string; group_name: string; label: string }>>();
const leadFieldValuesCache = new Map<string, Record<string, CustomFieldValue>>();

interface LeadEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead | null;
  onSave: (leadId: string, updates: Partial<Lead>) => Promise<void>;
  onDeleted?: (leadId: string) => void;
  adAccountId?: string;
  boards?: KanbanBoard[];
  mode?: 'dialog' | 'sheet';
  initialTab?: string;
}

const brazilianStates = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 
  'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 
  'SP', 'SE', 'TO'
];

const regions = ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'];

// Mapeamento de estado para região
const stateToRegion: Record<string, string> = {
  'AC': 'Norte', 'AM': 'Norte', 'AP': 'Norte', 'PA': 'Norte', 'RO': 'Norte', 'RR': 'Norte', 'TO': 'Norte',
  'AL': 'Nordeste', 'BA': 'Nordeste', 'CE': 'Nordeste', 'MA': 'Nordeste', 'PB': 'Nordeste', 'PE': 'Nordeste', 'PI': 'Nordeste', 'RN': 'Nordeste', 'SE': 'Nordeste',
  'DF': 'Centro-Oeste', 'GO': 'Centro-Oeste', 'MT': 'Centro-Oeste', 'MS': 'Centro-Oeste',
  'ES': 'Sudeste', 'MG': 'Sudeste', 'RJ': 'Sudeste', 'SP': 'Sudeste',
  'PR': 'Sul', 'RS': 'Sul', 'SC': 'Sul',
};

const caseTypes = [
  'Queda de Altura',
  'Soterramento',
  'Choque Elétrico',
  'Acidente com Máquinas',
  'Intoxicação',
  'Explosão',
  'Incêndio',
  'Acidente de Trânsito',
  'Esmagamento',
  'Corte/Amputação',
  'Afogamento',
  'Outro',
];

const liabilityTypes = [
  'Solidária',
  'Subsidiária',
  'Objetiva',
  'Subjetiva',
  'A Definir',
];

const isAlreadyMissingLeadError = (error?: string) =>
  String(error || '').toLowerCase().includes('lead não encontrado no banco externo');

const sectors = [
  'Construção Civil',
  'Mineração',
  'Agronegócio',
  'Indústria',
  'Energia',
  'Logística',
  'Siderurgia',
  'Petróleo e Gás',
  'Alimentício',
  'Outro',
];

// Sources are now loaded from the database via useLeadSources

export function LeadEditDialog({
  open,
  onOpenChange,
  lead,
  onSave,
  onDeleted,
  adAccountId,
  boards = [],
  mode = 'dialog',
  initialTab,
}: LeadEditDialogProps) {
  // Basic fields state
  const [sheetWidth, setSheetWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 512;
    const saved = Number(localStorage.getItem('leadEditDialog.sheetWidth'));
    return Number.isFinite(saved) && saved >= 360 ? saved : 512;
  });
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sheetWidth;
    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX; // arrastar p/ esquerda aumenta
      const next = Math.min(Math.max(360, startW + delta), Math.floor(window.innerWidth * 0.95));
      setSheetWidth(next);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      try { localStorage.setItem('leadEditDialog.sheetWidth', String(sheetWidthRef.current)); } catch {}
    };
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };
  const sheetWidthRef = useRef(512);
  useEffect(() => { sheetWidthRef.current = sheetWidth; }, [sheetWidth]);
  const [leadName, setLeadName] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [instagramUsername, setInstagramUsername] = useState('');
  const [source, setSource] = useState('manual');
  const [notes, setNotes] = useState('');
  const [acolhedor, setAcolhedor] = useState('');
  const profiles = useProfilesList();
  const { sources: leadSources, addSource: addLeadSource, updateSource: updateLeadSource, deleteSource: deleteLeadSource } = useLeadSources();
  const [showSourceManager, setShowSourceManager] = useState(false);
  const [newSourceLabel, setNewSourceLabel] = useState('');
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [editingSourceLabel, setEditingSourceLabel] = useState('');
  const [whatsappGroups, setWhatsappGroups] = useState<Array<{ id?: string; group_link: string; group_jid: string; group_name: string; label: string }>>([]);
  const [groupRemovalIdx, setGroupRemovalIdx] = useState<number | null>(null);
  const [fetchingInviteJids, setFetchingInviteJids] = useState<Set<string>>(new Set());
  const autoFetchedJidsRef = useRef<Set<string>>(new Set());
  const [syncGroupData, setSyncGroupData] = useState<{ jid: string; name: string; instanceId?: string } | null>(null);
  const [groupSearchOpen, setGroupSearchOpen] = useState(false);
  const [groupSearchInstance, setGroupSearchInstance] = useState<string | undefined>(undefined);
  const [clientClassification, setClientClassification] = useState<string>('');
  const [expectedBirthDate, setExpectedBirthDate] = useState('');
  const [leadOutcome, setLeadOutcome] = useState<'' | 'no_response' | 'closed' | 'refused' | 'in_progress' | 'inviavel' | 'cancelled'>('');
  const [leadOutcomeDate, setLeadOutcomeDate] = useState('');
  const [leadOutcomeReason, setLeadOutcomeReason] = useState('');
  const [isGeneratingReason, setIsGeneratingReason] = useState(false);
  const [caseNumber, setCaseNumber] = useState('');
  const [caseSyncCheck, setCaseSyncCheck] = useState<{
    expectedCaseNumber: string;
    expectedLeadName: string;
    needsUpdate: boolean;
  } | null>(null);
  const [caseSyncApplying, setCaseSyncApplying] = useState(false);
  const [unifiedEditorOpen, setUnifiedEditorOpen] = useState(false);
  const [enrichReview, setEnrichReview] = useState<EnrichReviewData | null>(null);
  const [enrichApplying, setEnrichApplying] = useState(false);
  
  // Accident fields
  const [victimName, setVictimName] = useState('');
  const [victimAge, setVictimAge] = useState('');
  const [accidentDate, setAccidentDate] = useState('');
  const [caseType, setCaseType] = useState('');
  const [accidentAddress, setAccidentAddress] = useState('');
  const [damageDescription, setDamageDescription] = useState('');
  
  // Location fields (visit)
  const [visitCity, setVisitCity] = useState('');
  const [visitState, setVisitState] = useState('');
  const [visitRegion, setVisitRegion] = useState('');
  const [visitAddress, setVisitAddress] = useState('');
  
  // Companies fields
  const [contractorCompany, setContractorCompany] = useState('');
  const [mainCompany, setMainCompany] = useState('');
  const [sector, setSector] = useState('');
  const [companySizeJustification, setCompanySizeJustification] = useState('');
  
  // Legal fields
  const [liabilityType, setLiabilityType] = useState('');
  const [newsLink, setNewsLink] = useState('');
  const [newsLinks, setNewsLinks] = useState<string[]>([]);
  const [legalViability, setLegalViability] = useState('');
  
  // Custom fields
  const { customFields, getFieldValues, saveAllFieldValues } = useLeadCustomFields(adAccountId);
  const { classifications, classificationConfig, addClassification } = useContactClassifications();
  const { fetchProfileNames, getDisplayName, loading: profilesLoading } = useProfileNames();
  const { states, cities, loadingCities, fetchCities } = useBrazilianLocations();
  const { fetchLeadInstances, createLeadInstances } = useChecklists();
  const [localFieldValues, setLocalFieldValues] = useState<Record<string, { type: FieldType; value: string | number | boolean | null }>>({});
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');
  const [funnelPanelOpen, setFunnelPanelOpen] = useState(false);
  const [viewingContactId, setViewingContactId] = useState<string | null>(null);
  const [viewingContact, setViewingContact] = useState<ContactType | null>(null);
  const [contactSheetOpen, setContactSheetOpen] = useState(false);
  
  // New classification creation
  const [isAddingClassification, setIsAddingClassification] = useState(false);
  const [newClassificationName, setNewClassificationName] = useState('');
  const [newClassificationColor, setNewClassificationColor] = useState('bg-blue-500');
  
  // Show AI enricher
  const [showExtractor, setShowExtractor] = useState(false);
  
  // Legal viability analysis
  const [analyzingViability, setAnalyzingViability] = useState(false);
  const [showLinkConfirm, setShowLinkConfirm] = useState(false);
  const [tempNewsLink, setTempNewsLink] = useState('');
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const { data: campaignsList = [] } = useCampaigns();

  const currentLead = lead;
  const autoDrive = useAutoImportGroupDocs(
    currentLead?.id || null,
    currentLead?.lead_name || null,
    (currentLead as any)?.whatsapp_group_id || null,
  );
  // Auto-vincular grupo do WhatsApp ao abrir lead com caso fechado e sem grupo
  useAutoLinkGroupByName({
    leadId: currentLead?.id || null,
    leadName: currentLead?.lead_name || null,
    hasCaseClosed: !!(currentLead as any)?.case_number || (currentLead as any)?.lead_status === 'closed',
    currentGroupId: (currentLead as any)?.whatsapp_group_id || null,
    onLinked: () => {
      // Notifica componentes pais para recarregar o lead
      window.dispatchEvent(new CustomEvent('adscore:lead-group-linked', { detail: { leadId: currentLead?.id } }));
    },
  });
  const layoutBoardId = selectedBoardId || (currentLead as any)?.board_id || null;
  const { resolved: resolvedFieldLayout } = useLeadFieldLayout(layoutBoardId);
  const { visibleTabs: visibleLayoutTabs } = useLeadTabLayout(layoutBoardId);
  const visibleTabKeys = useMemo(() => new Set(visibleLayoutTabs.map(tab => tab.key)), [visibleLayoutTabs]);
  const visibleFieldKeys = useMemo(
    () => new Set(resolvedFieldLayout.filter(field => !field.hidden).map(field => field.field_key)),
    [resolvedFieldLayout]
  );
  const managedLayoutTabKeys = useMemo(() => new Set(['basic', 'accident', 'location', 'companies', 'legal']), []);
  const customLayoutTabs = useMemo(() => visibleLayoutTabs.filter(tab => tab.is_custom), [visibleLayoutTabs]);
  const isManagedLayoutTab = (tabKey: string) => managedLayoutTabKeys.has(tabKey);
  const isTabVisible = (tabKey: string) => !isManagedLayoutTab(tabKey) || !layoutBoardId || visibleTabKeys.has(tabKey);
  // victim_name e acolhedor são SEMPRE editáveis, independente do layout do board
  const ALWAYS_VISIBLE_FIELDS = new Set(['victim_name', 'acolhedor']);
  const isFieldVisible = (fieldKey: string) =>
    ALWAYS_VISIBLE_FIELDS.has(fieldKey) || !layoutBoardId || visibleFieldKeys.has(fieldKey);

  useEffect(() => {
    if (!isManagedLayoutTab(activeTab)) return;
    if (isTabVisible(activeTab)) return;
    setActiveTab(visibleLayoutTabs[0]?.key || 'contacts');
  }, [activeTab, visibleLayoutTabs, visibleTabKeys, layoutBoardId]);

  // Redirect away from removed 'checklist' tab (now always-visible panel on top)
  useEffect(() => {
    if (activeTab === 'checklist') setActiveTab('basic');
  }, [activeTab]);

  // Track previous lead id to only reset tab on lead change, not hydration
  const prevLeadIdRef = useRef<string | null>(null);

  // Hydrate form fields ONLY when opening the dialog or switching to a different lead.
  // We intentionally DO NOT re-hydrate on every currentLead reference change, otherwise
  // realtime/refetch updates would overwrite fields the user just edited (ex: Acolhedor
  // gets deselected immediately after picking it).
  useEffect(() => {
    if (!open) {
      // Quando fechar, zera o ref pra que reabrir o mesmo lead rehidrate com dados frescos
      prevLeadIdRef.current = null;
      return;
    }
    if (!currentLead) return;

    const isNewLead = prevLeadIdRef.current !== currentLead.id;
    if (!isNewLead) return;

    const leadAny = currentLead as any;
    prevLeadIdRef.current = currentLead.id;
    setActiveTab(initialTab || 'basic');

    // Basic fields
    setLeadName(currentLead.lead_name || '');
    setLeadPhone(currentLead.lead_phone || '');
    setLeadEmail(currentLead.lead_email || '');
    setInstagramUsername(currentLead.instagram_username || '');
    setSource(currentLead.source || 'manual');
    setNotes(currentLead.notes || '');
    setAcolhedor(leadAny.acolhedor || '');
    // Load whatsapp groups from new table
    const cachedGroups = leadGroupsCache.get(currentLead.id);
    if (cachedGroups) {
      setWhatsappGroups(cachedGroups);
    } else if (leadAny.group_link || leadAny.whatsapp_group_id) {
      setWhatsappGroups([{
        group_link: leadAny.group_link || '',
        group_jid: leadAny.whatsapp_group_id || '',
        group_name: '',
        label: '',
      }]);
    } else {
      setWhatsappGroups([]);
    }
    setClientClassification(currentLead.client_classification || '');
    setExpectedBirthDate(leadAny.expected_birth_date || '');
    setSelectedBoardId(leadAny.board_id || '');
    setSelectedCampaignId(leadAny.crm_campaign_id || '');
    // Outcome
    setCaseNumber(leadAny.case_number || '');
    setLeadOutcomeReason(leadAny.lead_status_reason || '');
    // Use lead_status field as primary source of truth.
    // Exceção: se became_client_date está setado, o lead fechou de fato (tem caso/became client)
    // — não deixar um lead_status='no_response' dessincronizado mascarar o fechamento.
    const leadStatus = leadAny.lead_status;
    if (leadStatus === 'no_response' && !leadAny.became_client_date) {
      setLeadOutcome('no_response');
      setLeadOutcomeDate('');
    } else if (leadStatus === 'closed' || leadAny.became_client_date) {
      setLeadOutcome('closed');
      setLeadOutcomeDate(leadAny.became_client_date || '');
    } else if (leadStatus === 'cancelled' || leadAny.cancelled_date) {
      setLeadOutcome('cancelled');
      setLeadOutcomeDate(leadAny.cancelled_date || '');
    } else if (leadStatus === 'inviavel' || leadAny.inviavel_date) {
      setLeadOutcome('inviavel');
      setLeadOutcomeDate(leadAny.inviavel_date || '');
    } else if (leadStatus === 'refused') {
      setLeadOutcome('refused');
      setLeadOutcomeDate(leadAny.classification_date || '');
    } else if (leadAny.in_progress_date) {
      setLeadOutcome('in_progress');
      setLeadOutcomeDate(leadAny.in_progress_date || '');
    } else {
      setLeadOutcome('');
      setLeadOutcomeDate('');
    }

    // Accident fields
    setVictimName(leadAny.victim_name || '');
    setVictimAge(leadAny.victim_age?.toString() || '');
    setAccidentDate(leadAny.accident_date || '');
    setCaseType(leadAny.case_type || '');
    setAccidentAddress(leadAny.accident_address || '');
    setDamageDescription(leadAny.damage_description || '');

    // Location fields
    const state = leadAny.visit_state || '';
    setVisitState(state);
    setVisitCity(leadAny.visit_city || '');
    setVisitRegion(leadAny.visit_region || stateToRegion[state] || '');
    setVisitAddress(leadAny.visit_address || '');

    // Fetch cities for the state
    if (state) {
      fetchCities(state);
    }

    // Companies fields
    setContractorCompany(leadAny.contractor_company || '');
    setMainCompany(leadAny.main_company || '');
    setSector(leadAny.sector || '');
    setCompanySizeJustification(leadAny.company_size_justification || '');

    // Legal fields
    setLiabilityType(leadAny.liability_type || '');
    setNewsLink(currentLead.news_link || '');
    setNewsLinks(leadAny.news_links || (currentLead.news_link ? [currentLead.news_link] : []));
    setLegalViability(leadAny.legal_viability || '');

    const profileIds = [leadAny.created_by, leadAny.updated_by].filter(Boolean) as string[];
    void Promise.all([
      loadLeadGroups(currentLead.id, leadAny),
      loadCustomFieldValues(currentLead.id),
      profileIds.length > 0 ? fetchProfileNames(profileIds) : Promise.resolve(),
      import('@/components/leads/LeadActivitiesTab').then(({ prefetchLeadActivities }) => prefetchLeadActivities(currentLead.id)),
      import('@/components/leads/LeadLinkedContacts').then(({ prefetchLeadLinkedContacts }) => prefetchLeadLinkedContacts(currentLead.id)),
      import('@/components/kanban/LeadFunnelOverview').then(({ prefetchLeadFunnelOverview }) => prefetchLeadFunnelOverview(
        currentLead.id,
        leadAny.board_id || null,
        currentLead.status || null,
        fetchLeadInstances,
        createLeadInstances,
      )),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLead?.id, open]);

  // Verifica (apenas no front, ao abrir) se o nº do caso fechado mudou de posição
  // na fila de assinaturas. Se mudou, mostra banner pedindo confirmação pra
  // re-sincronizar nome do lead/grupo. Sem job em background.
  useEffect(() => {
    if (!open || !currentLead) { setCaseSyncCheck(null); return; }
    const leadAny = currentLead as any;
    if (leadAny.lead_status !== 'closed') { setCaseSyncCheck(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await cloudFunctions.invoke<any>('regenerate-lead-name', {
          body: { lead_id: currentLead.id, dry_run: true },
        });
        if (cancelled || !data?.success) return;
        const expectedCaseNumber = data.position ? String(data.position) : '';
        const expectedLeadName = data.lead_name || '';
        const currentCaseNumber = leadAny.case_number || '';
        const currentLeadName = currentLead.lead_name || '';
        const needsUpdate =
          (!!expectedCaseNumber && expectedCaseNumber !== currentCaseNumber) ||
          (!!expectedLeadName && expectedLeadName !== currentLeadName);
        setCaseSyncCheck({ expectedCaseNumber, expectedLeadName, needsUpdate });
      } catch (e) {
        // silencioso — checagem é opcional
      }
    })();
    return () => { cancelled = true; };
  }, [open, currentLead?.id]);

  const applyCaseSync = async () => {
    if (!currentLead || caseSyncApplying) return;
    setCaseSyncApplying(true);
    try {
      const { data, error } = await cloudFunctions.invoke<any>('regenerate-lead-name', {
        body: { lead_id: currentLead.id },
      });
      if (error || data?.success === false) {
        toast.error(data?.error || error?.message || 'Falha ao sincronizar');
        return;
      }
      toast.success(
        `Nº do caso atualizado para ${data?.lead_name || ''}` +
          (data?.group_renamed ? ' (grupo renomeado)' : ''),
      );
      if (data?.lead_name) setLeadName(data.lead_name);
      if (data?.position) setCaseNumber(String(data.position));
      setCaseSyncCheck((prev) => prev ? { ...prev, needsUpdate: false } : prev);
    } finally {
      setCaseSyncApplying(false);
    }
  };

  // Reset hydration tracker when dialog closes so reopening the same lead re-hydrates from DB.
  useEffect(() => {
    if (!open) {
      prevLeadIdRef.current = null;
    }
  }, [open]);

  // Auto-preenche acolhedor a partir do criador do grupo quando o lead abre sem ninguém atribuído.
  // O edge function `backfill-acolhedor-from-group-owner` já grava no banco; aqui só refletimos
  // o resultado no state local pra UI atualizar sozinha (sem precisar reabrir).
  const autoAcolhedorTriedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!open || !currentLead?.id) return;
    if (acolhedor && acolhedor.trim()) return;
    const hasJid = whatsappGroups.some((g) => g?.group_jid);
    if (!hasJid) return;
    if (autoAcolhedorTriedRef.current.has(currentLead.id)) return;
    autoAcolhedorTriedRef.current.add(currentLead.id);

    const leadId = currentLead.id;
    (async () => {
      try {
        const res: any = await cloudFunctions.invoke('backfill-acolhedor-from-group-owner', {
          body: { lead_id: leadId },
        });
        const data = res?.data ?? res;
        const hit = (data?.results || []).find((r: any) => r?.status === 'ok' && r?.operator);
        if (hit?.operator) {
          // Só sobrescreve se o usuário ainda não escolheu nada manualmente.
          setAcolhedor((cur) => (cur && cur.trim() ? cur : hit.operator));
        }
      } catch (err: any) {
        console.warn('[acolhedor-auto-open] falhou:', err?.message || err);
      }
    })();
  }, [open, currentLead?.id, whatsappGroups, acolhedor]);

  // Limpa o controle de tentativa ao fechar o dialog.
  useEffect(() => {
    if (!open) autoAcolhedorTriedRef.current = new Set();
  }, [open]);


  const loadCustomFieldValues = async (leadId: string) => {
    const values = leadFieldValuesCache.get(leadId) || await getFieldValues(leadId);
    leadFieldValuesCache.set(leadId, values);
    
    // Initialize local values from loaded values
    const initial: Record<string, { type: FieldType; value: string | number | boolean | null }> = {};
    customFields.forEach(field => {
      const val = values[field.id];
      if (val) {
        let value: string | number | boolean | null = null;
        switch (field.field_type) {
          case 'text':
          case 'select':
          case 'url':
            value = val.value_text;
            break;
          case 'number':
            value = val.value_number;
            break;
          case 'date':
            value = val.value_date;
            break;
          case 'checkbox':
            value = val.value_boolean;
            break;
        }
        initial[field.id] = { type: field.field_type, value };
      }
    });
    setLocalFieldValues(initial);
  };

  const loadLeadGroups = async (leadId: string, leadSnapshot: any) => {
    const { data: groups } = await externalSupabase
      .from('lead_whatsapp_groups')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: true });

    let mappedGroups: Array<{ id?: string; group_link: string; group_jid: string; group_name: string; label: string }> = [];

    if (groups && groups.length > 0) {
      mappedGroups = groups.map((g: any) => ({
        id: g.id,
        group_link: g.group_link || '',
        group_jid: g.group_jid || '',
        group_name: g.group_name || '',
        label: g.label || '',
      }));
    } else if (leadSnapshot.group_link || leadSnapshot.whatsapp_group_id) {
      mappedGroups = [{
        group_link: leadSnapshot.group_link || '',
        group_jid: leadSnapshot.whatsapp_group_id || '',
        group_name: '',
        label: '',
      }];
    }

    // Fonte primária para nome do grupo: whatsapp_groups_index (sync diária da UazAPI).
    // Sempre consulta — assim refletimos renomeações sem chamar a API a cada abertura.
    const allJids = mappedGroups.filter((g) => g.group_jid?.includes('@g.us')).map((g) => g.group_jid);
    if (allJids.length > 0) {
      try {
        const { data: idx } = await (externalSupabase as any)
          .from('whatsapp_groups_index')
          .select('group_jid, contact_name, last_seen')
          .in('group_jid', allJids)
          .order('last_seen', { ascending: false });
        const nameByJid = new Map<string, string>();
        (idx || []).forEach((r: any) => {
          const nm = r.contact_name ? String(r.contact_name).trim() : '';
          if (nm && !nameByJid.has(r.group_jid)) nameByJid.set(r.group_jid, nm);
        });

        // Atualiza em memória + persiste mudanças no banco (fire-and-forget)
        const toPersist: Array<{ jid: string; name: string }> = [];
        mappedGroups = mappedGroups.map((g) => {
          const fresh = nameByJid.get(g.group_jid);
          if (fresh && fresh !== g.group_name) {
            toPersist.push({ jid: g.group_jid, name: fresh });
            return { ...g, group_name: fresh };
          }
          return g;
        });
        if (toPersist.length > 0) {
          Promise.all(
            toPersist.map((p) =>
              externalSupabase
                .from('lead_whatsapp_groups')
                .update({ group_name: p.name })
                .eq('lead_id', leadId)
                .eq('group_jid', p.jid)
            )
          ).catch((e) => console.warn('Falha ao persistir nome de grupo:', e));
        }
      } catch (err) {
        console.warn('Falha ao consultar whatsapp_groups_index:', err);
      }
    }

    // Último fallback: grupo ainda sem nome (não está no index) → UazAPI direto
    const stillMissing = mappedGroups.filter((g) => !g.group_name && g.group_jid?.includes('@g.us'));
    if (stillMissing.length > 0) {
      await Promise.all(
        stillMissing.map(async (g) => {
          try {
            const { data: infoData } = await cloudFunctions.invoke<any>('get-whatsapp-group-info', {
              body: { group_jid: g.group_jid, lead_id: leadId },
            });
            if (infoData?.success && infoData.name) {
              mappedGroups = mappedGroups.map((m) =>
                m.group_jid === g.group_jid ? { ...m, group_name: infoData.name } : m
              );
            }
          } catch (e) {
            console.warn('Falha ao buscar nome do grupo na UazAPI:', e);
          }
        })
      );
    }

    leadGroupsCache.set(leadId, mappedGroups);
    setWhatsappGroups(mappedGroups);
  };

  const handleAddClassification = async () => {
    if (!newClassificationName.trim()) return;
    
    const result = await addClassification(newClassificationName, newClassificationColor);
    if (result) {
      setClientClassification(result.name);
      setIsAddingClassification(false);
      setNewClassificationName('');
      setNewClassificationColor('bg-blue-500');
    }
  };

  // Handle AI extracted data - update form fields immediately
  const handleApplyAIData = (updates: Partial<Lead>) => {
    const u = updates as any;
    
    // Accident
    if (u.victim_name) setVictimName(u.victim_name);
    if (u.victim_age) setVictimAge(u.victim_age.toString());
    if (u.accident_date) { const nd = normalizeDateInput(u.accident_date); if (nd) setAccidentDate(nd); }
    if (u.case_type) setCaseType(u.case_type);
    if (u.accident_address) setAccidentAddress(u.accident_address);
    if (u.damage_description) setDamageDescription(u.damage_description);
    if (u.notes) setNotes(prev => prev ? `${prev}\n\n${u.notes}` : u.notes);
    
    // Location
    if (u.visit_city) setVisitCity(u.visit_city);
    if (u.visit_state) setVisitState(u.visit_state);
    if (u.visit_region) setVisitRegion(u.visit_region);
    if (u.visit_address) setVisitAddress(u.visit_address);
    
    // Companies
    if (u.contractor_company) setContractorCompany(u.contractor_company);
    if (u.main_company) setMainCompany(u.main_company);
    if (u.sector) setSector(u.sector);
    if (u.company_size_justification) setCompanySizeJustification(u.company_size_justification);
    
    // Legal
    if (u.liability_type) setLiabilityType(u.liability_type);
    if (u.news_link) setNewsLink(u.news_link);
    if (u.legal_viability) setLegalViability(u.legal_viability);

    // Auto-generate lead name in standard pattern
    const generatedName = generateLeadName({
      city: u.visit_city || undefined,
      state: u.visit_state || undefined,
      victim_name: u.victim_name || undefined,
      main_company: u.main_company || undefined,
      contractor_company: u.contractor_company || undefined,
      accident_date: u.accident_date || undefined,
      damage_description: u.damage_description || undefined,
      case_type: u.case_type || undefined,
    });
    if (generatedName) {
      setLeadName(generatedName);
    } else if (u.lead_name) {
      setLeadName(u.lead_name);
    }
  };

  // Handle extracted data from AccidentDataExtractor
  const handleExtractedData = (data: ExtractedAccidentData) => {
    // Update state with extracted data, filling in visit_region automatically
    if (data.victim_name) setVictimName(data.victim_name);
    if (data.victim_age) setVictimAge(data.victim_age.toString());
    if (data.accident_date) { const nd = normalizeDateInput(data.accident_date); if (nd) setAccidentDate(nd); }
    if (data.case_type) setCaseType(data.case_type);
    if (data.accident_address) setAccidentAddress(data.accident_address);
    if (data.damage_description) setDamageDescription(data.damage_description);
    
    // Location - also set region based on state
    if (data.visit_city) setVisitCity(data.visit_city);
    if (data.visit_state) {
      setVisitState(data.visit_state);
      setVisitRegion(stateToRegion[data.visit_state] || '');
      fetchCities(data.visit_state);
    }
    
    // Companies
    if (data.contractor_company) setContractorCompany(data.contractor_company);
    if (data.main_company) setMainCompany(data.main_company);
    if (data.sector) setSector(data.sector);
    
    // Legal
    if (data.liability_type) setLiabilityType(data.liability_type);
    if (data.legal_viability) setLegalViability(data.legal_viability);
    
    // Auto-generate lead name following standard pattern
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
    if (generatedName) {
      setLeadName(generatedName);
    }
    
    toast.success('Dados extraídos aplicados ao formulário!');
  };

  // Aplica os campos confirmados no EnrichReviewDialog: grava via auto-enrich-lead
  // (apply_fields) e sincroniza o formulário aberto pro Salvar não sobrescrever.
  const handleEnrichApply = async (selected: Record<string, any>) => {
    if (!currentLead || !enrichReview) return;
    setEnrichApplying(true);
    try {
      const { data, error } = await supabase.functions.invoke('auto-enrich-lead', {
        body: { lead_id: currentLead.id, group_jid: enrichReview.groupJid, apply_fields: selected },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (selected.full_name) setLeadName(selected.full_name);
      if (selected.email) setLeadEmail(selected.email);
      if (selected.notes) setNotes(selected.notes);
      if (selected.victim_name) setVictimName(selected.victim_name);
      if (selected.main_company) setMainCompany(selected.main_company);
      if (selected.damage_description) setDamageDescription(selected.damage_description);
      if (selected.accident_date) { const nd = normalizeDateInput(selected.accident_date); if (nd) setAccidentDate(nd); }
      if (selected.case_type) setCaseType(selected.case_type);
      if (selected.visit_city) setVisitCity(selected.visit_city);
      if (selected.visit_state) { setVisitState(selected.visit_state); setVisitRegion(stateToRegion[selected.visit_state] || ''); }
      if (selected.visit_address) setVisitAddress(selected.visit_address);
      if (selected.lead_status) {
        const mapped = selected.lead_status === 'unviable' ? 'inviavel' : selected.lead_status;
        setLeadOutcome(mapped as any);
        if (selected.lead_status_reason) setLeadOutcomeReason(selected.lead_status_reason);
      }
      const bySlug = new Map(enrichReview.customFields.map((f) => [f.slug, f]));
      setLocalFieldValues((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(selected)) {
          const f = bySlug.get(k);
          if (!f) continue;
          next[f.id] = {
            type: f.type as FieldType,
            value: f.type === 'number' ? Number(v) : f.type === 'checkbox' ? Boolean(v) : String(v),
          };
        }
        return next;
      });
      leadFieldValuesCache.delete(currentLead.id);
      const applied = Object.keys(selected).filter((k) => k !== 'lead_status_reason').length;
      toast.success(`${applied} campo(s) aplicado(s) ao lead.`);
      setEnrichReview(null);
    } catch (err: any) {
      toast.error('Erro ao aplicar: ' + (err?.message || 'Erro'));
    } finally {
      setEnrichApplying(false);
    }
  };

  const handleAnalyzeViability = async (linkToUse?: string) => {
    const urlToAnalyze = linkToUse || newsLink;
    
    if (!urlToAnalyze) {
      toast.error('Informe um link da notícia para analisar');
      return;
    }

    setAnalyzingViability(true);
    setShowLinkConfirm(false);

    try {
      // First, fetch the page content via scrape-news
      const { data: scrapeData, error: scrapeError } = await cloudFunctions.invoke('scrape-news', {
        body: { url: urlToAnalyze },
      });

      if (scrapeError || !scrapeData?.success) {
        throw new Error(scrapeData?.error || 'Erro ao buscar conteúdo da notícia');
      }

      // Build context for viability analysis
      const caseContext = `
DADOS DO CASO:
- Tipo de Caso: ${caseType || 'Não informado'}
- Data do Acidente: ${accidentDate || 'Não informada'}
- Descrição do Dano: ${damageDescription || 'Não informado'}
- Empresa Terceirizada: ${contractorCompany || 'Não informada'}
- Empresa Tomadora: ${mainCompany || 'Não informada'}
- Setor: ${sector || 'Não informado'}

CONTEÚDO DA NOTÍCIA:
${scrapeData.content || ''}
      `.trim();

      // Call AI to analyze viability
      const { data: aiData, error: aiError } = await cloudFunctions.invoke('analyze-legal-viability', {
        body: { 
          content: caseContext,
          existingData: {
            case_type: caseType,
            damage_description: damageDescription,
            contractor_company: contractorCompany,
            main_company: mainCompany,
            sector: sector,
          }
        },
      });

      if (aiError) {
        throw new Error('Erro ao analisar viabilidade');
      }

      if (aiData?.success && aiData?.data) {
        const result = aiData.data;
        
        // Update fields with AI analysis
        if (result.legal_viability) setLegalViability(result.legal_viability);
        if (result.liability_type) setLiabilityType(result.liability_type);
        if (result.company_size_justification) setCompanySizeJustification(result.company_size_justification);
        if (result.sector && !sector) setSector(result.sector);
        if (result.case_type && !caseType) setCaseType(result.case_type);
        
        // Update news link if changed
        if (linkToUse && linkToUse !== newsLink) {
          setNewsLink(linkToUse);
        }

        toast.success('Análise de viabilidade concluída!');
      } else {
        throw new Error(aiData?.error || 'Não foi possível analisar');
      }
    } catch (err) {
      console.error('Error analyzing viability:', err);
      toast.error(err instanceof Error ? err.message : 'Erro ao analisar viabilidade');
    } finally {
      setAnalyzingViability(false);
    }
  };

  const handleStartViabilityAnalysis = () => {
    if (newsLink) {
      // Already has a link, ask if want to change
      setTempNewsLink(newsLink);
      setShowLinkConfirm(true);
    } else {
      // No link, show input
      setTempNewsLink('');
      setShowLinkConfirm(true);
    }
  };

  const handleViewContact = async (contactId: string) => {
    try {
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', contactId)
        .single();
      if (data) {
        setViewingContact(data as ContactType);
        setContactSheetOpen(true);
      }
    } catch (e) {
      console.error('Error fetching contact:', e);
    }
  };

  const [closeGroupDialogOpen, setCloseGroupDialogOpen] = useState(false);
  const [pendingCloseContacts, setPendingCloseContacts] = useState<CloseLeadContactPayload[] | null>(null);

  // Traduz erros técnicos da UazAPI/edge function em mensagens acionáveis para o usuário.
  // Retorna { title, description } prontos para exibir em um toast.
  const translateInviteError = (raw: string | undefined | null): { title: string; description: string } => {
    const msg = String(raw || '').toLowerCase();

    // Sem instância conectada
    if (msg.includes('no connected whatsapp instance')) {
      return {
        title: 'Nenhuma instância WhatsApp conectada',
        description: 'Conecte ao menos uma instância de WhatsApp em Configurações → WhatsApp antes de buscar o link.',
      };
    }
    // Permissão de admin / não é admin
    if (msg.includes('admin') || msg.includes('not authorized') || msg.includes('forbidden') || msg.includes('not allowed')) {
      return {
        title: 'Sem permissão de administrador',
        description: 'A instância conectada precisa ser administradora deste grupo para gerar o link. Promova-a a admin no WhatsApp ou cole o link manualmente.',
      };
    }
    // Instância (número conectado) não participa do grupo — diferente do usuário humano!
    if (msg.includes("you're not participating") || msg.includes('not participating') || msg.includes('not a participant') || msg.includes('not in group')) {
      return {
        title: 'Instância não está no grupo',
        description: 'O número de WhatsApp conectado ao sistema não é membro deste grupo (ainda que você seja). Adicione a instância conectada ao grupo e promova-a a administradora para gerar o link.',
      };
    }
    // Grupo não encontrado
    if (msg.includes('not found') || msg.includes('group not exist') || msg.includes("doesn't exist") || msg.includes('does not exist')) {
      return {
        title: 'Grupo não encontrado',
        description: 'O JID está incorreto ou o grupo foi excluído. Confira o identificador do grupo.',
      };
    }
    // JID inválido
    if (msg.includes('invalid jid') || msg.includes('invalid group') || msg.includes('malformed')) {
      return {
        title: 'JID do grupo inválido',
        description: 'O identificador do grupo está em formato incorreto. Use o JID completo (ex.: 1203…@g.us) ou cole o link de convite.',
      };
    }
    // Token / autenticação da instância
    if (msg.includes('token') || msg.includes('unauthorized') || msg.includes('401')) {
      return {
        title: 'Instância desconectada',
        description: 'O token da instância expirou ou está inválido. Reconecte a instância em Configurações → WhatsApp e tente novamente.',
      };
    }
    // Rate limit
    if (msg.includes('rate') || msg.includes('429') || msg.includes('too many')) {
      return {
        title: 'Muitas tentativas',
        description: 'Aguarde alguns segundos antes de tentar novamente.',
      };
    }
    // Timeout / rede
    if (msg.includes('timeout') || msg.includes('network') || msg.includes('failed to fetch') || msg.includes('econn')) {
      return {
        title: 'Falha de conexão com o WhatsApp',
        description: 'Não foi possível falar com a UazAPI. Verifique sua conexão e tente de novo em instantes.',
      };
    }
    // Fallback genérico
    return {
      title: 'Não foi possível obter o link',
      description: raw
        ? `Detalhe técnico: ${raw}`
        : 'A instância precisa ser admin do grupo. Como alternativa, cole o link de convite manualmente.',
    };
  };

  // Busca link de convite do grupo via UazAPI a partir do JID e atualiza o estado local.
  const fetchInviteLink = async (groupJid: string, opts?: { silent?: boolean }) => {
    const raw = (groupJid || '').trim();
    // Aceita JID com @g.us ou apenas o número (15+ dígitos), normaliza para @g.us.
    if (!raw) return null;
    const isFullJid = raw.includes('@g.us');
    const isNumeric = /^\d{15,}$/.test(raw);
    if (!isFullJid && !isNumeric) return null;
    const jid = isFullJid ? raw : `${raw}@g.us`;
    if (fetchingInviteJids.has(jid) || fetchingInviteJids.has(raw)) return null;
    setFetchingInviteJids(prev => new Set(prev).add(jid));
    try {
      const { data, error } = await supabase.functions.invoke('get-group-invite-link', {
        body: { group_jid: jid, lead_id: currentLead?.id || null },
      });
      if (error) throw error;
      if (data?.success && data?.invite_link) {
        setWhatsappGroups(prev => prev.map(g => (g.group_jid === raw || g.group_jid === jid) ? { ...g, group_link: data.invite_link } : g));
        if (!opts?.silent) {
          const inst = data?.instance_name ? `Instância: ${data.instance_name}` : 'Link obtido';
          const tries = typeof data?.attempts_count === 'number' ? ` • ${data.attempts_count} tentativa${data.attempts_count === 1 ? '' : 's'}` : '';
          toast.success('Link do grupo obtido!', { description: `${inst}${tries}` });
        }
        return data.invite_link as string;
      } else {
        if (!opts?.silent) {
          const { title, description } = translateInviteError(data?.error);
          const attempts = Array.isArray(data?.attempts) ? data.attempts : [];
          const extra = attempts.length
            ? ` Tentativas (${attempts.length}): ${attempts.map((a: any) => `${a.instance}${a.error ? ` — ${a.error}` : ''}`).join(' | ')}`
            : '';
          toast.error(title, { description: `${description}${extra}` });
        }
        return null;
      }
    } catch (e: any) {
      if (!opts?.silent) {
        const { title, description } = translateInviteError(e?.message);
        toast.error(title, { description });
      }
      return null;
    } finally {
      setFetchingInviteJids(prev => {
        const next = new Set(prev);
        next.delete(jid);
        return next;
      });
    }
  };

  // Auto-busca link de convite para grupos com JID mas sem link de convite válido.
  useEffect(() => {
    if (!open || !currentLead?.id) return;
    for (const g of whatsappGroups) {
      const raw = (g.group_jid || '').trim();
      if (!raw) continue;
      const isFullJid = raw.includes('@g.us');
      const isNumeric = /^\d{15,}$/.test(raw);
      if (!isFullJid && !isNumeric) continue;
      const link = (g.group_link || '').trim();
      if (link.includes('chat.whatsapp.com')) continue;
      if (autoFetchedJidsRef.current.has(raw)) continue;
      autoFetchedJidsRef.current.add(raw);
      fetchInviteLink(raw, { silent: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentLead?.id, whatsappGroups]);

  const handleSaveClick = () => {
    if (!currentLead) return;
    const wasAlreadyClosed = !!(currentLead as any).became_client_date;
    const isFreshClose = leadOutcome === 'closed' && !wasAlreadyClosed;
    const hasGroup = !!(currentLead as any).whatsapp_group_id;
    if (isFreshClose && hasGroup) {
      setCloseGroupDialogOpen(true);
      return;
    }
    handleSave();
  };

  const handleDeleteLead = async () => {
    if (!currentLead) return;
    setDeleting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const { data, error } = await cloudFunctions.invoke('permanent-delete-lead', {
        body: { leadId: currentLead.id },
        authToken: sessionData.session?.access_token,
      });
      if (error) throw error;
      const alreadyDeleted = data?.alreadyDeleted || isAlreadyMissingLeadError(data?.error);
      if (!data?.success && !alreadyDeleted) throw new Error(data?.error || 'Exclusão permanente não confirmada');
      onDeleted?.(currentLead.id);
      window.dispatchEvent(new CustomEvent('adscore:lead-deleted', { detail: { leadId: currentLead.id } }));
      toast.success(alreadyDeleted ? 'Lead removido da tela; ele já não existia no banco externo' : 'Lead excluído permanentemente');
      setShowDeleteConfirm(false);
      onOpenChange(false);
    } catch (err: any) {
      console.error('Error deleting lead:', err);
      toast.error(`Erro ao excluir lead: ${err?.message || 'desconhecido'}`);
    } finally {
      setDeleting(false);
    }
  };

  // Remoção de grupo: se o usuário confirmar que é caso fechado, o lead vira Fechado
  // com data de fechamento = data de criação do grupo. O grupo é MANTIDO vinculado
  // (lead fechado exige grupo — validação do handleSave).
  const handleGroupRemovalClosedCase = async () => {
    const idx = groupRemovalIdx;
    if (idx === null) return;
    const g = whatsappGroups[idx];
    setGroupRemovalIdx(null);
    // Data de criação do grupo: 1) data no nome do grupo (dd/mm/aa), 2) primeira mensagem do grupo, 3) hoje
    let closeDate = '';
    const nameSource = g?.group_name || g?.label || '';
    const dateMatches = nameSource.match(/(\d{2})\/(\d{2})\/(\d{2,4})/g);
    const lastDate = dateMatches?.[dateMatches.length - 1];
    if (lastDate) {
      const [d, m, y] = lastDate.split('/');
      const iso = `${y.length === 2 ? `20${y}` : y}-${m}-${d}`;
      if (!isNaN(new Date(`${iso}T00:00:00`).getTime())) closeDate = iso;
    }
    if (!closeDate && g?.group_jid) {
      try {
        const bareJid = g.group_jid.replace('@g.us', '');
        const { data: firstMsg } = await externalSupabase
          .from('whatsapp_messages')
          .select('created_at')
          .eq('phone', bareJid)
          .order('created_at', { ascending: true })
          .limit(1);
        if (firstMsg?.[0]?.created_at) closeDate = String(firstMsg[0].created_at).slice(0, 10);
      } catch (err) {
        console.warn('Falha ao buscar primeira mensagem do grupo:', err);
      }
    }
    if (!closeDate) closeDate = new Date().toISOString().slice(0, 10);
    setLeadOutcome('closed');
    setLeadOutcomeDate(closeDate);
    const [yy, mm, dd] = closeDate.split('-');
    toast.info(`Lead marcado como Fechado (data ${dd}/${mm}/${yy} — criação do grupo).`, {
      description: 'O grupo foi mantido vinculado: lead fechado exige grupo. Cadastre o processo do caso antes de salvar.',
    });
  };

  const handleSave = async (contactsPayload?: CloseLeadContactPayload[]) => {
    if (!currentLead) return;

    if (!leadName.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }

    // Validação obrigatória: resultado do lead é obrigatório quando o lead está/vai para etapa de fechamento.
    {
      const targetBoardId = selectedBoardId || (currentLead as any).board_id;
      const targetBoard = boards.find(b => b.id === targetBoardId);
      const stages = (targetBoard?.stages as any[]) || [];
      const currentStageId = (currentLead as any).status;
      const closedStageId = stages.length ? findClosedStageId(stages) : null;
      const refusedStageId = stages.length ? findRefusedStageId(stages) : null;
      const isOnFinalStage = currentStageId && (currentStageId === closedStageId || currentStageId === refusedStageId);
      if (isOnFinalStage && !leadOutcome) {
        toast.error('Selecione o resultado do lead (ganho, recusado, inviável ou cancelado) antes de salvar.');
        setActiveTab('basic');
        return;
      }
    }

    // Validação obrigatória ao fechar: grupo WhatsApp vinculado + pelo menos 1 contato registrado.
    if (leadOutcome === 'closed') {
      const hasGroup = whatsappGroups.some(g => (g.group_jid || '').trim() || (g.group_link || '').trim());
      if (!hasGroup) {
        toast.error('Lead fechado precisa ter um grupo do WhatsApp vinculado.', {
          description: 'Adicione o grupo na seção "Grupos WhatsApp" antes de salvar.',
        });
        setActiveTab('basic');
        return;
      }
      if (!contactsPayload?.length) {
        const { count, error: contactCountErr } = await externalSupabase
          .from('contact_leads')
          .select('contact_id', { count: 'exact', head: true })
          .eq('lead_id', currentLead.id);
        if (!contactCountErr && (count ?? 0) === 0) {
          toast.error('Lead fechado precisa ter pelo menos 1 contato registrado.', {
            description: 'Vincule um contato na aba "Contatos" antes de salvar.',
          });
          setActiveTab('contacts');
          return;
        }
      }
      // Não existe caso fechado sem processo: se o lead já tem caso, exige ao menos 1 processo.
      // (Se ainda não tem caso, o fluxo abaixo cria o caso e para na aba Casos — a trava pega no próximo salvar.)
      const { data: closingCases, error: closingCasesErr } = await externalSupabase
        .from('legal_cases')
        .select('id')
        .eq('lead_id', currentLead.id)
        .limit(1);
      if (!closingCasesErr && closingCases && closingCases.length > 0) {
        const { count: processCount, error: processCountErr } = await externalSupabase
          .from('lead_processes')
          .select('id', { count: 'exact', head: true })
          .eq('lead_id', currentLead.id)
          .is('deleted_at', null);
        if (!processCountErr && (processCount ?? 0) === 0) {
          toast.error('Não existe caso fechado sem processo.', {
            description: 'Cadastre o processo vinculado ao caso na aba "Casos" antes de salvar o lead como fechado.',
          });
          setActiveTab('casos');
          return;
        }
      }
    }

    // Nº do Caso é AUTO-gerado pelo prefixo do produto ao fechar o lead.
    // Não há mais validação manual aqui — se faltar produto, avisamos no fluxo de criação do caso.


    console.log('[handleSave] Starting save for lead:', currentLead.id);
    setSaving(true);
    try {
      // Save WhatsApp groups to new table
      // First fetch existing groups (for audit), delete all, then insert current ones
      const { data: existingGroups } = await externalSupabase
        .from('lead_whatsapp_groups')
        .select('group_jid, group_name')
        .eq('lead_id', currentLead.id);

      const { error: deleteErr } = await externalSupabase
        .from('lead_whatsapp_groups')
        .delete()
        .eq('lead_id', currentLead.id);

      // Audit unlinks: groups that existed before but are not in the new list
      const newJids = new Set(whatsappGroups.map(g => g.group_jid).filter(Boolean));
      for (const old of existingGroups || []) {
        if (!old.group_jid || !newJids.has(old.group_jid)) {
          await logGroupAudit({
            action: 'unlink',
            group_jid: old.group_jid,
            group_name: old.group_name,
            lead_id: currentLead.id,
            lead_name: currentLead.lead_name || null,
            result: deleteErr ? 'error' : 'success',
            error_message: deleteErr?.message || null,
            source: 'LeadEditDialog.handleSave',
          });
        }
      }

      const resolvedGroups = [...whatsappGroups];
      for (let i = 0; i < resolvedGroups.length; i++) {
        const g = resolvedGroups[i];
        const rawLink = g.group_link || '';
        const isLink = rawLink.includes('chat.whatsapp.com');
        
        if (isLink && !g.group_jid?.includes('@g.us')) {
          try {
            const { data: resolveData } = await cloudFunctions.invoke('send-whatsapp', {
              body: { action: 'resolve_group_link', group_link: rawLink },
            });
            if (resolveData?.success && resolveData.group_id) {
              resolvedGroups[i] = { ...g, group_jid: resolveData.group_id, group_name: resolveData.group_name || '' };
            }
          } catch (e) {
            console.warn('Error resolving group link:', e);
          }
        } else if (rawLink.includes('@g.us')) {
          resolvedGroups[i] = { ...g, group_jid: rawLink, group_link: '' };
        }

        // Se ainda não temos o nome do grupo, busca via UazAPI /group/info
        // (uma vez só — depois fica salvo em lead_whatsapp_groups.group_name)
        const cur = resolvedGroups[i];
        if (cur.group_jid?.includes('@g.us') && !cur.group_name) {
          try {
            const { data: infoData } = await cloudFunctions.invoke<any>('get-whatsapp-group-info', {
              body: { group_jid: cur.group_jid },
            });
            if (infoData?.success && infoData.name) {
              resolvedGroups[i] = { ...cur, group_name: infoData.name };
            }
          } catch (e) {
            console.warn('Falha ao buscar nome do grupo na UazAPI:', e);
          }
        }
      }
      
      if (resolvedGroups.length > 0) {
        const { error: insertErr } = await externalSupabase.from('lead_whatsapp_groups').insert(
          resolvedGroups.map(g => ({
            lead_id: currentLead.id,
            group_link: g.group_link || null,
            group_jid: g.group_jid || null,
            group_name: g.group_name || null,
            label: g.label || null,
          }))
        );
        // Audit links for groups that weren't there before
        const oldJids = new Set((existingGroups || []).map(g => g.group_jid).filter(Boolean));
        for (const g of resolvedGroups) {
          if (!g.group_jid) continue;
          await logGroupAudit({
            action: 'link',
            group_jid: g.group_jid,
            group_name: g.group_name || null,
            lead_id: currentLead.id,
            lead_name: currentLead.lead_name || null,
            result: insertErr ? 'error' : (oldJids.has(g.group_jid) ? 'duplicate_skipped' : 'success'),
            error_message: insertErr?.message || null,
            source: 'LeadEditDialog.handleSave',
          });
        }
      }
      setWhatsappGroups(resolvedGroups);
      leadGroupsCache.set(currentLead.id, resolvedGroups);

      // Auto-sync group contacts: trigger for first group with a resolved JID
      const groupWithJid = resolvedGroups.find(g => g.group_jid?.includes('@g.us'));
      if (groupWithJid) {
        // Get the user's default instance for the API call
        let userInstanceId: string | undefined;
        try {
          const { data: { user: authUser } } = await supabase.auth.getUser();
          if (authUser) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('default_instance_id')
              .eq('user_id', authUser.id)
              .maybeSingle();
            userInstanceId = (profile as any)?.default_instance_id || undefined;
          }
        } catch {}
        setSyncGroupData({ jid: groupWithJid.group_jid, name: groupWithJid.group_name || '', instanceId: userInstanceId });
      }

      // Auto-detect acolhedor from group owner (fire-and-forget).
      // Runs only when user did NOT pick an acolhedor manually and there is at least one resolved group JID.
      if (!acolhedor && groupWithJid?.group_jid) {
        try {
          cloudFunctions
            .invoke('backfill-acolhedor-from-group-owner', {
              body: { lead_id: currentLead.id },
            })
            .then((res: any) => {
              console.log('[acolhedor-auto] backfill triggered for lead', currentLead.id, res?.data || res?.error);
            })
            .catch((err: any) => {
              console.warn('[acolhedor-auto] backfill invoke failed:', err?.message || err);
            });
        } catch (e) {
          console.warn('[acolhedor-auto] dispatch error:', (e as Error).message);
        }
      }

      // Keep legacy fields in sync (first group)
      const firstGroup = resolvedGroups[0];
      const finalGroupLink = firstGroup?.group_link || null;
      const finalGroupId = firstGroup?.group_jid || null;

      console.log('[handleSave] Calling onSave with updates...');
      await onSave(currentLead.id, {
        lead_name: leadName.trim(),
        lead_phone: leadPhone || null,
        lead_email: leadEmail || null,
        instagram_username: instagramUsername || null,
        source,
        notes: notes || null,
        client_classification: (clientClassification || null) as 'client' | 'non_client' | 'prospect' | null,
        acolhedor: acolhedor || null,
        group_link: finalGroupLink,
        whatsapp_group_id: finalGroupId,
        victim_name: victimName || null,
        victim_age: victimAge ? parseInt(victimAge) : null,
        accident_date: normalizeDateInput(accidentDate),
        case_type: caseType || null,
        accident_address: accidentAddress || null,
        damage_description: damageDescription || null,
        // Location fields
        visit_city: visitCity || null,
        visit_state: visitState || null,
        visit_region: visitRegion || null,
        visit_address: visitAddress || null,
        // Companies fields
        contractor_company: contractorCompany || null,
        main_company: mainCompany || null,
        sector: sector || null,
        company_size_justification: companySizeJustification || null,
        // Legal fields
        liability_type: liabilityType || null,
        news_link: newsLinks.length > 0 ? newsLinks[0] : (newsLink || null),
        news_links: newsLinks.length > 0 ? newsLinks : (newsLink ? [newsLink] : []),
        legal_viability: legalViability || null,
        board_id: selectedBoardId || null,
        crm_campaign_id: selectedCampaignId || null,
        ...(selectedBoardId && selectedBoardId !== (currentLead as any).board_id ? (() => {
          const newBoard = boards.find(b => b.id === selectedBoardId);
          const firstStage = newBoard?.stages?.[0] as any;
          return firstStage?.id ? { status: firstStage.id } : {};
        })() : {}),
        // Auto-move to closed/refused stage when outcome changes
        ...(() => {
          const targetBoardId = selectedBoardId || (currentLead as any).board_id;
          const targetBoard = boards.find(b => b.id === targetBoardId);
          const stages = (targetBoard?.stages as any[]) || [];
          if (stages.length === 0) return {};
          const currentStageId = (currentLead as any).status;
          if (leadOutcome === 'closed') {
            const closedId = findClosedStageId(stages);
            if (closedId && closedId !== currentStageId) return { status: closedId };
          } else if (leadOutcome === 'refused' || leadOutcome === 'inviavel' || leadOutcome === 'cancelled') {
            const refusedId = findRefusedStageId(stages);
            if (refusedId && refusedId !== currentStageId) return { status: refusedId };
          }
          return {};
        })(),
        expected_birth_date: normalizeDateInput(expectedBirthDate),
        lead_status: leadOutcome || 'no_response',
        became_client_date: leadOutcome === 'closed' ? (normalizeDateInput(leadOutcomeDate) || new Date().toISOString().slice(0, 10)) : null,
        classification_date: leadOutcome === 'refused' ? (normalizeDateInput(leadOutcomeDate) || new Date().toISOString().slice(0, 10)) : null,
        in_progress_date: leadOutcome === 'in_progress' ? (normalizeDateInput(leadOutcomeDate) || new Date().toISOString().slice(0, 10)) : null,
        inviavel_date: leadOutcome === 'inviavel' ? (normalizeDateInput(leadOutcomeDate) || new Date().toISOString().slice(0, 10)) : null,
        cancelled_date: leadOutcome === 'cancelled' ? (normalizeDateInput(leadOutcomeDate) || new Date().toISOString().slice(0, 10)) : null,
        lead_status_reason: leadOutcomeReason || null,
        case_number: caseNumber || null,
      } as any);

      // Save custom field values
       if (Object.keys(localFieldValues).length > 0) {
         await saveAllFieldValues(currentLead.id, localFieldValues);
          leadFieldValuesCache.delete(currentLead.id);
       }

      // Save status history if outcome changed
       const previousOutcome = (currentLead as any).became_client_date ? 'closed' : (currentLead as any).cancelled_date ? 'cancelled' : (currentLead as any).inviavel_date ? 'inviavel' : (currentLead as any).classification_date ? 'refused' : (currentLead as any).in_progress_date ? 'in_progress' : ((currentLead as any).lead_status || 'no_response');
       if (leadOutcome && leadOutcome !== previousOutcome) {
         const { data: { user } } = await supabase.auth.getUser();
         await supabase.from('lead_status_history' as any).insert({
           lead_id: currentLead.id,
          from_status: previousOutcome,
          to_status: leadOutcome,
          reason: leadOutcomeReason || null,
          changed_by: user?.id || null,
          changed_by_type: 'manual',
        });
        // Also record in lead_stage_history so metrics/ranking can track who closed
         await externalSupabase.from('lead_stage_history').insert({
           lead_id: currentLead.id,
           from_stage: (currentLead as any).status || previousOutcome,
           to_stage: leadOutcome,
           changed_by: user?.id || null,
           to_board_id: (currentLead as any).board_id || null,
           from_board_id: (currentLead as any).board_id || null,
         });
       }

      // Auto-create legal case when lead is marked as closed (or was already closed but has no case yet)
       const wasAlreadyClosed = !!(currentLead as any).became_client_date;
       if (leadOutcome === 'closed') {
         if (!wasAlreadyClosed) {
           // Also update lead_status
           await externalSupabase.from('leads').update({ lead_status: 'closed' } as any).eq('id', currentLead.id);
           // Envia conversão ao Meta via Pixel/CAPI (casa por email+telefone hasheados).
           // Leads vêm de formulário, não de Click-to-WhatsApp: o path CTWA
           // (metaConversionTracking) exigiria ctwa_clid e abortaria sem enviar nada.
           facebookCAPI.sendPurchaseEvent({
             leadId: currentLead.id,
             email: (currentLead as any).lead_email || undefined,
             phone: (currentLead as any).lead_phone || undefined,
             name: currentLead.lead_name || undefined,
             value: (currentLead as any).conversion_value || 0,
           }).then((result) => {
             if (result.success) {
               console.log('[Meta CAPI] Purchase (Pixel) enviado no fechamento do lead', currentLead.id);
             } else {
               console.warn('[Meta CAPI] Falha ao enviar Purchase no fechamento:', result.error);
             }
           });
            // Rename WhatsApp group with closed prefix + sync participants/contacts
            if ((currentLead as any).whatsapp_group_id) {
              cloudFunctions.invoke('rename-whatsapp-group', {
                body: {
                  lead_id: currentLead.id,
                  contacts_to_add: contactsPayload || [],
                },
              }).then((res: any) => {
                if (res?.data?.success) {
                  console.log('Group renamed:', res.data.old_name, '→', res.data.new_name, res.data.sync, res.data.contacts);
                }
              }).catch((e: any) => console.warn('Group rename failed:', e));
            }
         }

        try {
             const { data: existingCases } = await externalSupabase
             .from('legal_cases')
             .select('id')
             .eq('lead_id', currentLead.id)
             .limit(1);
          
          if (!existingCases || existingCases.length === 0) {
            const { data: { user } } = await supabase.auth.getUser();

            // Try to match case_type to a specialized nucleus for proper numbering
            let matchedNucleusId: string | null = null;
            if (caseType) {
              const caseTypeLower = caseType.toLowerCase();
              const { data: nuclei } = await supabase
                .from('specialized_nuclei')
                .select('id, name, prefix');
              
              if (nuclei) {
                const match = nuclei.find(n => {
                  const nameLower = n.name.toLowerCase();
                  return caseTypeLower.includes(nameLower) || nameLower.includes(caseTypeLower) ||
                    // Common mappings
                    (caseTypeLower.includes('maternidade') && nameLower.includes('maternidade')) ||
                    (caseTypeLower.includes('trabalho') && nameLower.includes('trabalho')) ||
                    (caseTypeLower.includes('trânsito') && nameLower.includes('trânsito')) ||
                    (caseTypeLower.includes('transito') && nameLower.includes('trânsito')) ||
                    (caseTypeLower.includes('doença') && nameLower.includes('doença')) ||
                    (caseTypeLower.includes('consumo') && nameLower.includes('consumo')) ||
                    (caseTypeLower.includes('profissional') && nameLower.includes('profission')) ||
                    (caseTypeLower.includes('grave') && nameLower.includes('grave')) ||
                    (caseTypeLower.includes('bpc') && nameLower.includes('grave')) ||
                    (caseTypeLower.includes('loas') && nameLower.includes('grave')) ||
                    (caseTypeLower.includes('inss') && nameLower.includes('grave')) ||
                    (caseTypeLower.includes('benefício') && nameLower.includes('grave')) ||
                    (caseTypeLower.includes('beneficio') && nameLower.includes('grave'));
                });
                if (match) matchedNucleusId = match.id;
              }
            }

            // Nº do caso é AUTO-gerado pelo prefixo do produto vinculado ao lead.
            // Buscamos o product_service_id do lead e chamamos a RPC no Externo.
            const { data: leadProdRow } = await externalSupabase
              .from('leads')
              .select('product_service_id')
              .eq('id', currentLead.id)
              .maybeSingle();
            const productId = (leadProdRow as any)?.product_service_id || null;
            if (!productId) {
              toast.error('Lead sem Produto definido. Preencha o Produto antes de fechar (Nº do caso é gerado por produto).');
              setActiveTab('basic');
              setSaving(false);
              return;
            }
            const { data: generated, error: genErr } = await externalSupabase
              .rpc('generate_case_number', { p_product_id: productId } as any);
            if (genErr || !generated) {
              toast.error(`Erro ao gerar Nº do Caso: ${genErr?.message || 'desconhecido'}`);
              setSaving(false);
              return;
            }
            const finalCaseNumber = String(generated);
            const { data: insertedCase, error: insertError } = await externalSupabase
              .from('legal_cases')
                .insert({
                 lead_id: currentLead.id,
                nucleus_id: matchedNucleusId,
                case_number: finalCaseNumber,
                title: leadName.trim() || lead.lead_name || 'Novo Caso',
                status: 'em_andamento',
                created_by: user?.id,
              } as any)
              .select('id, case_number')
              .single();
            
            if (insertError) {
              console.error('Error inserting legal case:', insertError);
              toast.error(`Erro ao criar caso: ${insertError.message}`);
            } else {
              toast.success(`Caso ${insertedCase?.case_number || finalCaseNumber} criado automaticamente! Cadastre os processos na aba Casos.`);
              setCaseNumber(insertedCase?.case_number || finalCaseNumber);
              // Switch to Casos tab so user can add processes
              setActiveTab('casos');
              setSaving(false);
              return; // Keep dialog open for process registration
            }
          }

        } catch (caseErr) {
          console.error('Error auto-creating case:', caseErr);
          // Don't block the save
        }
       } else if (leadOutcome === 'refused') {
         await externalSupabase.from('leads').update({ lead_status: 'refused' } as any).eq('id', currentLead.id);
         // Send conversion event to Meta CAPI
         sendLeadConversionEvent({
           id: currentLead.id,
           lead_name: currentLead.lead_name,
           lead_phone: (currentLead as any).lead_phone,
           ctwa_context: (currentLead as any).ctwa_context,
           campaign_id: (currentLead as any).campaign_id,
         }, 'refused');
       } else if (leadOutcome === 'inviavel') {
         await externalSupabase.from('leads').update({ lead_status: 'inviavel' } as any).eq('id', currentLead.id);
         sendLeadConversionEvent({
           id: currentLead.id,
           lead_name: currentLead.lead_name,
           lead_phone: (currentLead as any).lead_phone,
           ctwa_context: (currentLead as any).ctwa_context,
           campaign_id: (currentLead as any).campaign_id,
         }, 'inviavel');
       } else if (leadOutcome === 'cancelled') {
         await externalSupabase.from('leads').update({ lead_status: 'cancelled' } as any).eq('id', currentLead.id);
         sendLeadConversionEvent({
           id: currentLead.id,
           lead_name: currentLead.lead_name,
           lead_phone: (currentLead as any).lead_phone,
           ctwa_context: (currentLead as any).ctwa_context,
           campaign_id: (currentLead as any).campaign_id,
         }, 'cancelled');
        } else if (!leadOutcome && (
         (currentLead as any).became_client_date ||
         (currentLead as any).inviavel_date ||
         (currentLead as any).cancelled_date ||
         ['closed', 'refused', 'inviavel', 'cancelled'].includes((currentLead as any).lead_status)
        )) {
         await externalSupabase.from('leads').update({ lead_status: 'no_response' } as any).eq('id', currentLead.id);
       }

      // Se o funil mudou, renomeia o grupo conforme board_group_settings do novo funil.
      // Fire-and-forget: não bloqueia o save. O regenerate-lead-name lê o template
      // (prefixo/sufixo/padrão fechado) do board atual e renomeia na UazAPI + leads.lead_name.
      const prevBoardId = (currentLead as any).board_id || null;
      if (selectedBoardId && selectedBoardId !== prevBoardId) {
        try {
          const res: any = await cloudFunctions.invoke('regenerate-lead-name', {
            body: { lead_id: currentLead.id },
          });
          const d = res?.data || {};
          if (d.success) {
            // Reflete o novo nome no objeto local + estado do form pra UI/kanban não mostrar o antigo
            (currentLead as any).lead_name = d.lead_name || (currentLead as any).lead_name;
            if (d.lead_name) setLeadName(d.lead_name);
            if (d.group_renamed) {
              toast.success(`Nome do lead e grupo atualizados: ${d.lead_name}`);
            } else {
              toast.success(`Nome do lead atualizado: ${d.lead_name}`);
              if (d.missing_fields?.length) {
                toast.message('Atenção', { description: `Campos faltando no template: ${d.missing_fields.join(', ')}` });
              }
            }
          } else {
            console.warn('[regenerate-lead-name] falhou:', d.error);
            toast.error(`Não foi possível renomear: ${d.error || 'erro desconhecido'}`);
          }
        } catch (e: any) {
          console.warn('[regenerate-lead-name] erro:', e?.message || e);
          toast.error(`Erro ao renomear: ${e?.message || e}`);
        }
      }

      toast.success('Lead atualizado com sucesso!');
      onOpenChange(false);
    } catch (error) {
      console.error('[handleSave] Error saving lead:', error);
      toast.error('Erro ao salvar lead: ' + (error instanceof Error ? error.message : 'Erro desconhecido'));
    } finally {
      setSaving(false);
    }
  };

  const { cases: linkedCases, fetchCases: fetchLinkedCases } = useLegalCases(currentLead?.id);

  // Garante que o resumo do topo exiba os casos vinculados (hook não auto-fetch)
  useEffect(() => {
    if (currentLead?.id) {
      fetchLinkedCases(currentLead.id);
    }
  }, [currentLead?.id, fetchLinkedCases]);

  if (!currentLead) return null;

  const Wrapper = mode === 'sheet' ? Sheet : Dialog;
  const Content = mode === 'sheet' ? SheetContent : DialogContent;
  const Header = mode === 'sheet' ? SheetHeader : DialogHeader;
  const Title = mode === 'sheet' ? SheetTitle : DialogTitle;
  const Footer = mode === 'sheet' ? SheetFooter : DialogFooter;

  const contentClassName = mode === 'sheet'
    ? 'flex flex-col h-full overflow-y-auto !max-w-none'
    : 'max-w-2xl max-h-[90vh] flex flex-col';

  const sheetContentStyle = mode === 'sheet'
    ? { width: `${sheetWidth}px`, maxWidth: '95vw' }
    : undefined;

  return (
    <>
    <Wrapper open={open} onOpenChange={onOpenChange}>
      <Content className={contentClassName} style={sheetContentStyle} {...(mode === 'sheet' ? { side: 'right' as const } : {})}>
        {mode === 'sheet' && (
          <div
            role="separator"
            aria-orientation="vertical"
            title="Arraste para redimensionar"
            onMouseDown={startResize}
            onDoubleClick={() => { setSheetWidth(512); localStorage.setItem('leadEditDialog.sheetWidth', '512'); }}
            className="absolute left-0 top-0 h-full w-1.5 cursor-col-resize bg-transparent hover:bg-primary/40 active:bg-primary/60 transition-colors z-30"
          />
        )}
        <Header>
          <div className="flex items-center justify-between">
            <Title className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Editar Lead
            </Title>
            {currentLead && (
              <div className="flex items-center gap-1">
                {autoDrive.total > 0 && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] gap-1 px-2 py-0.5",
                      autoDrive.running
                        ? "border-blue-400 text-blue-700 bg-blue-50 dark:bg-blue-950/30"
                        : autoDrive.done >= autoDrive.total
                          ? "border-emerald-400 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30"
                          : "border-amber-400 text-amber-700 bg-amber-50 dark:bg-amber-950/30"
                    )}
                    title={
                      autoDrive.running
                        ? 'Enviando mídias do grupo para o Google Drive…'
                        : autoDrive.done >= autoDrive.total
                          ? 'Todas as mídias do grupo estão no Drive'
                          : `${autoDrive.total - autoDrive.done} mídia(s) ainda fora do Drive`
                    }
                  >
                    {autoDrive.running ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                    Drive {autoDrive.done}/{autoDrive.total}
                  </Badge>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 h-7 text-xs"
                  onClick={() => setUnifiedEditorOpen(true)}
                  disabled={!currentLead.board_id}
                  title={!currentLead.board_id ? 'Selecione um funil primeiro' : 'Personalizar campos'}
                >
                  <Wand2 className="h-3 w-3" />
                  Personalizar
                </Button>
                <OpenWhatsAppLeadButton leadPhone={(currentLead as any).lead_phone} />
                <ShareMenu entityType="lead" entityId={currentLead.id} entityName={currentLead.lead_name || 'Lead'} />
              </div>
            )}
          </div>
        </Header>

        {/* Corpo rolável: tudo entre header e footer rola junto; o footer fica fixo na base */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4 scrollbar-thin scrollbar-thumb-border scrollbar-track-muted/30">

        {/* Resumo fixo: Lead + Casos vinculados */}
        <div className="flex-shrink-0 rounded-md border bg-muted/40 px-3 py-2 space-y-1.5">
          <div className="flex items-start gap-2">
            <User className="h-3.5 w-3.5 mt-0.5 text-muted-foreground flex-shrink-0" />
            <div className="text-sm font-medium leading-tight break-words">
              {currentLead.lead_name || 'Lead sem nome'}
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Scale className="h-3.5 w-3.5 mt-0.5 text-muted-foreground flex-shrink-0" />
            {linkedCases && linkedCases.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {linkedCases.map((c) => (
                  <Badge
                    key={c.id}
                    variant="outline"
                    className="text-[10px] py-0 px-1.5 cursor-pointer hover:bg-accent"
                    onClick={() => setActiveTab('casos')}
                    title={c.title}
                  >
                    {c.case_number}
                    {c.title ? ` · ${c.title}` : ''}
                  </Badge>
                ))}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">Nenhum caso vinculado</span>
            )}
          </div>
        </div>

        {/* AI Extraction Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowExtractor(true)}
            className="w-full gap-2 border-dashed border-primary/50 hover:border-primary"
          >
            <Sparkles className="h-4 w-4 text-primary" />
            Extrair de notícia/documento
          </Button>
          {currentLead && (
            <LeadAIChatExtractor
              leadId={currentLead.id}
              leadPhone={(currentLead as any).lead_phone}
              whatsappGroups={whatsappGroups}
              onDataExtracted={handleExtractedData}
            />
          )}
        </div>

        {/* AI Extraction Dialog */}
        {showExtractor && (
          <Suspense fallback={null}>
            <AccidentDataExtractor
              open={showExtractor}
              onOpenChange={setShowExtractor}
              onDataExtracted={handleExtractedData}
              currentData={{
                victim_name: victimName || null,
                victim_age: victimAge ? parseInt(victimAge) : null,
                accident_date: accidentDate || null,
                accident_address: accidentAddress || null,
                damage_description: damageDescription || null,
                contractor_company: contractorCompany || null,
                main_company: mainCompany || null,
                sector: sector || null,
                case_type: caseType || null,
                liability_type: liabilityType || null,
                legal_viability: legalViability || null,
                visit_city: visitCity || null,
                visit_state: visitState || null,
              }}
            />
          </Suspense>
        )}

        {/* Funil de Vendas — header sempre visível com barra de progresso; clique expande */}
        {lead && (
          <div className="rounded-lg border bg-card">
            <div className="flex items-center gap-2 px-3 py-2">
              <CheckSquare className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Funil de Vendas</span>
              {boards.length > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 ml-1 gap-1 px-2 text-xs"
                      title="Trocar funil"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Pencil className="h-3 w-3" />
                      Trocar
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-2 z-[10000]" align="start" onClick={(e) => e.stopPropagation()}>
                    <Label className="text-xs px-1">Trocar funil</Label>
                    <Select
                      value={selectedBoardId || '__none__'}
                      onValueChange={(val) => {
                        const newBoardId = val === '__none__' ? '' : val;
                        setSelectedBoardId(newBoardId);
                      }}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                      <SelectContent className="z-[10001]">
                        <SelectItem value="__none__">Sem funil</SelectItem>
                        {boards.map(b => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground mt-2 px-1">
                      Ao salvar, o nome do lead e do grupo serão atualizados conforme a configuração do novo funil.
                    </p>
                  </PopoverContent>
                </Popover>
              )}
              <div className="ml-auto">
                {funnelPanelOpen
                  ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </div>
            </div>
            <div className="px-3 pb-3 space-y-3">
              <Suspense fallback={<div className="flex items-center justify-center p-4"><Loader2 className="h-4 w-4 animate-spin" /></div>}>
                <LeadFunnelOverview
                  leadId={lead.id}
                  boardId={selectedBoardId || lead.board_id || null}
                  currentStageId={lead.status || null}
                  boards={boards}
                  isClosed={leadOutcome === 'closed'}
                  hideStagesList={!funnelPanelOpen}
                  autoExpandStageId={funnelPanelOpen ? (lead.status || null) : null}
                  onHeaderClick={() => setFunnelPanelOpen(o => !o)}
                />
              </Suspense>
              {(selectedBoardId || lead.board_id) && (
                <StageLabelSelect
                  leadId={lead.id}
                  boardId={selectedBoardId || lead.board_id!}
                  currentStageId={lead.status || null}
                  variant="dialog"
                />
              )}
            </div>
          </div>
        )}


        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col">
          <div className="w-full flex-shrink-0">
            <TabsList className="flex flex-wrap h-auto gap-1 p-1 bg-muted">
              {isTabVisible('basic') && (
                <TabsTrigger value="basic" className="text-xs py-1.5 px-2.5">
                  <User className="h-3 w-3 mr-1" />
                  Básico
                </TabsTrigger>
              )}
              <TabsTrigger value="contacts" className="text-xs py-1.5 px-2.5">
                <Users className="h-3 w-3 mr-1" />
                Contatos
              </TabsTrigger>
              <TabsTrigger value="activities" className="text-xs py-1.5 px-2.5">
                <Calendar className="h-3 w-3 mr-1" />
                Atividades
              </TabsTrigger>
              {isTabVisible('accident') && (
                <TabsTrigger value="accident" className="text-xs py-1.5 px-2.5">
                  <FileText className="h-3 w-3 mr-1" />
                  Acidente
                </TabsTrigger>
              )}
              {isTabVisible('location') && (
                <TabsTrigger value="location" className="text-xs py-1.5 px-2.5">
                  <MapPin className="h-3 w-3 mr-1" />
                  Local
                </TabsTrigger>
              )}
              {isTabVisible('companies') && (
                <TabsTrigger value="companies" className="text-xs py-1.5 px-2.5">
                  <Building className="h-3 w-3 mr-1" />
                  Empresas
                </TabsTrigger>
              )}
              {isTabVisible('legal') && (
                <TabsTrigger value="legal" className="text-xs py-1.5 px-2.5">
                  <Briefcase className="h-3 w-3 mr-1" />
                  Jurídico
                </TabsTrigger>
              )}
              {customLayoutTabs.map((tab) => (
                <TabsTrigger key={tab.key} value={tab.key} className="text-xs py-1.5 px-2.5">
                  <FileText className="h-3 w-3 mr-1" />
                  {tab.label}
                </TabsTrigger>
              ))}
              <TabsTrigger value="documents" className="text-xs py-1.5 px-2.5">
                <FileText className="h-3 w-3 mr-1" />
                Documentos
              </TabsTrigger>
              <TabsTrigger value="history" className="text-xs py-1.5 px-2.5">
                <History className="h-3 w-3 mr-1" />
                Histórico
              </TabsTrigger>
              {leadOutcome === 'closed' && (
                <TabsTrigger value="casos" className="text-xs py-1.5 px-2.5">
                  <Scale className="h-3 w-3 mr-1" />
                  Casos
                </TabsTrigger>
              )}
              <TabsTrigger value="financeiro" className="text-xs py-1.5 px-2.5">
                <DollarSign className="h-3 w-3 mr-1" />
                Financeiro
              </TabsTrigger>
              <TabsTrigger value="ai_chat" className="text-xs py-1.5 px-2.5">
                <Sparkles className="h-3 w-3 mr-1" />
                Chat IA
              </TabsTrigger>
              <TabsTrigger value="team_chat" className="text-xs py-1.5 px-2.5">
                <Users className="h-3 w-3 mr-1" />
                Chat Equipe
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="pr-3 mt-4">
            {/* Basic Info Tab */}
            <TabsContent value="basic" className="space-y-4 mt-0">
              {activeTab === 'basic' && (<>
              {/* Meta info */}
              {(() => {
                const leadAny = lead as any;
                if (!leadAny) return null;
                const creatorName = getDisplayName(leadAny.created_by);
                const editorName = getDisplayName(leadAny.updated_by);
                const hasEditor = leadAny.updated_by && leadAny.updated_by !== leadAny.created_by;
                
                return (
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mb-4">
                    {/* Current stage badge */}
                    {(() => {
                      const board = boards.find(b => b.id === lead.board_id);
                      const stage = board?.stages?.find((s: any) => s.id === lead.status || s.name === lead.status);
                      if (board) {
                        return (
                          <Badge variant="default" className="gap-1 bg-primary/10 text-primary border-primary/20">
                            <Briefcase className="h-3 w-3" />
                            {board.name}{stage ? ` › ${stage.name}` : ''}
                          </Badge>
                        );
                      }
                      return null;
                    })()}
                    <Badge variant="outline" className="gap-1">
                      <Calendar className="h-3 w-3" />
                      Criado: {lead.created_at ? format(new Date(lead.created_at), "dd/MM/yyyy", { locale: ptBR }) : '—'}
                      {creatorName && (
                        <span className="ml-1 flex items-center gap-0.5">
                          <UserCheck className="h-3 w-3" />
                          {creatorName}
                        </span>
                      )}
                    </Badge>
                    <Badge variant="outline" className="gap-1">
                      <Clock className="h-3 w-3" />
                      Atualizado: {lead.updated_at ? format(new Date(lead.updated_at), "dd/MM/yyyy HH:mm", { locale: ptBR }) : '—'}
                      {hasEditor && editorName && (
                        <span className="ml-1 flex items-center gap-0.5">
                          <Edit3 className="h-3 w-3" />
                          {editorName}
                        </span>
                      )}
                    </Badge>
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-4">
                {isFieldVisible('lead_name') && (
                  <div className="col-span-2">
                    <Label>Nome do Lead *</Label>
                    <Input
                      value={leadName}
                      onChange={(e) => setLeadName(e.target.value)}
                      placeholder="Nome do lead"
                    />
                  </div>
                )}

                {/* Telefone e Email removidos do form do Lead — são dados do Contato.
                    Os valores continuam sendo persistidos via lead_phone/lead_email para
                    não quebrar busca, vínculo de WhatsApp e CTWA. Edite via aba Contatos. */}


                {isFieldVisible('source') && (<div>
                  <div className="flex items-center justify-between">
                    <Label>Origem</Label>
                    <Popover open={showSourceManager} onOpenChange={setShowSourceManager}>
                      <PopoverTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs text-muted-foreground">
                          <Settings className="h-3 w-3 mr-1" /> Gerenciar
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72 p-3" align="start">
                        <div className="space-y-2">
                          <p className="text-xs font-semibold text-muted-foreground mb-2">Gerenciar Origens</p>
                          <div className="max-h-48 overflow-y-auto space-y-1">
                            {leadSources.map(s => (
                              <div key={s.id} className="flex items-center gap-1 group">
                                {editingSourceId === s.id ? (
                                  <>
                                    <Input
                                      value={editingSourceLabel}
                                      onChange={e => setEditingSourceLabel(e.target.value)}
                                      className="h-7 text-xs flex-1"
                                      autoFocus
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                          updateLeadSource(s.id, editingSourceLabel);
                                          setEditingSourceId(null);
                                        }
                                        if (e.key === 'Escape') setEditingSourceId(null);
                                      }}
                                    />
                                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { updateLeadSource(s.id, editingSourceLabel); setEditingSourceId(null); }}>
                                      <CheckCircle className="h-3 w-3 text-green-500" />
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <span className="text-sm flex-1 truncate">{s.label}</span>
                                    <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100" onClick={() => { setEditingSourceId(s.id); setEditingSourceLabel(s.label); }}>
                                      <Pencil className="h-3 w-3" />
                                    </Button>
                                    <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive" onClick={() => deleteLeadSource(s.id)}>
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="flex gap-1 pt-1 border-t">
                            <Input
                              value={newSourceLabel}
                              onChange={e => setNewSourceLabel(e.target.value)}
                              placeholder="Nova origem..."
                              className="h-7 text-xs flex-1"
                              onKeyDown={e => {
                                if (e.key === 'Enter' && newSourceLabel.trim()) {
                                  addLeadSource(newSourceLabel.trim());
                                  setNewSourceLabel('');
                                }
                              }}
                            />
                            <Button size="sm" className="h-7 px-2" disabled={!newSourceLabel.trim()} onClick={() => { addLeadSource(newSourceLabel.trim()); setNewSourceLabel(''); }}>
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <Select value={safeSelectValue(source)} onValueChange={setSource}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {leadSources.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* CTWA Ad Source Badge */}
                  {(lead as any)?.ctwa_context && (
                    <div className="mt-2 p-2 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                      <p className="text-xs font-medium text-blue-700 dark:text-blue-300 flex items-center gap-1">
                        📢 Veio de anúncio Click-to-WhatsApp
                      </p>
                      {(lead as any).ctwa_context.title && (
                        <p className="text-xs text-blue-600 dark:text-blue-400 mt-1 truncate">
                          {(lead as any).ctwa_context.title}
                        </p>
                      )}
                      {(lead as any).ctwa_context.source_url && (
                        <a 
                          href={(lead as any).ctwa_context.source_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-xs text-blue-500 underline mt-0.5 block truncate"
                        >
                          {(lead as any).ctwa_context.source_url}
                        </a>
                      )}
                    </div>
                  )}
                </div>)}

                {isFieldVisible('victim_name') && (<div>
                  <Label>Vítima</Label>
                  <Input
                    value={victimName}
                    onChange={(e) => setVictimName(e.target.value)}
                    placeholder="Nome completo da vítima"
                  />
                </div>)}

                {isFieldVisible('acolhedor') && (<div>
                  <Label>Acolhedor</Label>
                  <Select value={acolhedor || '__none__'} onValueChange={(v) => setAcolhedor(v === '__none__' ? '' : v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o acolhedor" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Nenhum</SelectItem>
                      {profiles.map((p) => (
                        <SelectItem key={p.id} value={p.full_name || p.email || p.id}>
                          {p.full_name || p.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>)}

                {isFieldVisible('group_link') && (<div className="col-span-2">
                  <div className="flex items-center justify-between">
                    <Label>Grupos WhatsApp</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1 h-7"
                      onClick={async () => {
                        if (!currentLead?.id) {
                          toast.error('Salve o lead antes de buscar grupos.');
                          return;
                        }
                        let instName: string | undefined;
                        try {
                          const { data: instMsg } = await externalSupabase
                            .from('whatsapp_messages')
                            .select('instance_name')
                            .eq('lead_id', currentLead.id)
                            .not('instance_name', 'is', null)
                            .order('created_at', { ascending: false })
                            .limit(1);
                          instName = (instMsg?.[0] as any)?.instance_name || undefined;
                        } catch {}
                        if (!instName) {
                          const { data: { user } } = await supabase.auth.getUser();
                          if (user) {
                            const { data: profile } = await supabase
                              .from('profiles')
                              .select('default_instance_id')
                              .eq('user_id', user.id)
                              .single();
                            const defaultId = (profile as any)?.default_instance_id;
                            if (defaultId) {
                              const { data: inst } = await supabase
                                .from('whatsapp_instances')
                                .select('instance_name')
                                .eq('id', defaultId)
                                .maybeSingle();
                              instName = (inst as any)?.instance_name || undefined;
                            }
                          }
                        }
                        if (!instName) {
                          toast.error('Não consegui descobrir a instância WhatsApp deste lead.');
                          return;
                        }
                        // Sem telefone: o dialog abre em modo "busca por nome do lead"
                        setGroupSearchInstance(instName);
                        setGroupSearchOpen(true);
                      }}
                    >
                      <Search className="h-3 w-3" /> Buscar grupos
                    </Button>
                  </div>
                  <div className="space-y-2 mt-1">
                    {whatsappGroups.map((g, idx) => {
                      // Computa URL final clicável: prioriza group_link se for chat.whatsapp.com,
                      // senão tenta extrair código de convite. JID puro NÃO abre — exige link de convite.
                      const rawLink = (g.group_link || '').trim();
                      const inviteUrl = rawLink.includes('chat.whatsapp.com')
                        ? (rawLink.startsWith('http') ? rawLink : `https://${rawLink.replace(/^\/+/, '')}`)
                        : (rawLink && !rawLink.includes('@g.us') && /^[A-Za-z0-9_-]{15,}$/.test(rawLink)
                            ? `https://chat.whatsapp.com/${rawLink}`
                            : '');
                      const canOpen = !!inviteUrl;
                      return (
                      <div key={idx} className="space-y-2 p-2 border rounded-md bg-muted/20">
                        <div className="flex items-center gap-2">
                          <Input
                            value={g.group_name || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setWhatsappGroups(prev => prev.map((item, i) => i === idx ? { ...item, group_name: val } : item));
                            }}
                            placeholder="Nome do grupo"
                            className="flex-1"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Input
                            value={g.group_link || g.group_jid || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setWhatsappGroups(prev => prev.map((item, i) => i === idx ? {
                                ...item,
                                group_link: val.includes('@g.us') ? '' : val,
                                group_jid: val.includes('@g.us') ? val : item.group_jid,
                              } : item));
                            }}
                            placeholder="https://chat.whatsapp.com/... ou JID (@g.us)"
                            className="flex-1 font-mono text-xs"
                          />
                          {canOpen ? (
                            <a href={inviteUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
                              <Button type="button" variant="outline" size="sm" className="gap-1 text-green-600 border-green-200">
                                <ExternalLink className="h-3 w-3" /> Abrir
                              </Button>
                            </a>
                          ) : (g.group_jid?.includes('@g.us') || /^\d{15,}$/.test((g.group_jid || '').trim())) ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="gap-1 text-blue-600 border-blue-200 shrink-0"
                              disabled={fetchingInviteJids.has(g.group_jid) || fetchingInviteJids.has(`${g.group_jid}@g.us`)}
                              onClick={() => fetchInviteLink(g.group_jid)}
                              title="Buscar link de convite via WhatsApp (a instância precisa ser admin do grupo)"
                            >
                              {(fetchingInviteJids.has(g.group_jid) || fetchingInviteJids.has(`${g.group_jid}@g.us`)) ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <ExternalLink className="h-3 w-3" />
                              )}
                              {(fetchingInviteJids.has(g.group_jid) || fetchingInviteJids.has(`${g.group_jid}@g.us`)) ? 'Buscando...' : 'Buscar link'}
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="gap-1 text-muted-foreground shrink-0"
                              disabled
                              title="Cole o link de convite (chat.whatsapp.com/…) para poder abrir"
                            >
                              <ExternalLink className="h-3 w-3" /> Abrir
                            </Button>
                          )}
                          {g.group_jid?.includes('@g.us') && currentLead && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button type="button" variant="outline" size="sm" className="gap-1 text-orange-600 border-orange-200">
                                  <Wrench className="h-3 w-3" /> Ações <MoreVertical className="h-3 w-3" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuItem onClick={async () => {
                                   try {
                                     const ls = (currentLead as any)?.lead_status;
                                     if ((currentLead as any)?.is_blocked || ls === 'refused' || ls === 'inviavel') {
                                       toast.error('Lead encerrado/bloqueado — não é possível modificar o grupo.');
                                       return;
                                     }
                                     toast.info('Reparando grupo... Buscando contatos vinculados.');
                                    const { data: contactLinks } = await externalSupabase
                                      .from('contact_leads')
                                      .select('contact_id, contacts(phone)')
                                      .eq('lead_id', currentLead.id);
                                    const phones = (contactLinks || [])
                                      .map((cl: any) => cl.contacts?.phone?.replace(/\D/g, ''))
                                      .filter((p: string) => p && p.length >= 10);
                                    const leadPhoneClean = currentLead.lead_phone?.replace(/\D/g, '') || '';
                                    if (leadPhoneClean.length >= 10 && !phones.includes(leadPhoneClean)) {
                                      phones.push(leadPhoneClean);
                                    }
                                    if (phones.length === 0) { toast.warning('Nenhum contato encontrado.'); return; }
                                    const { data: { user } } = await supabase.auth.getUser();
                                    let instId: string | null = null;
                                    if (user) {
                                      const { data: profile } = await supabase.from('profiles').select('default_instance_id').eq('user_id', user.id).single();
                                      instId = (profile as any)?.default_instance_id || null;
                                    }
                                    const parts = phones.map((p: string) => `${p}@s.whatsapp.net`);
                                    const { error } = await supabase.functions.invoke('repair-whatsapp-group', {
                                      body: { lead_id: currentLead.id, group_jid: g.group_jid, participants: parts, instance_id: instId, forward_docs: false },
                                    });
                                    if (error) throw error;
                                    toast.success(`${parts.length} participante(s) sendo adicionado(s) ao grupo.`);
                                  } catch (err: any) {
                                    toast.error('Erro ao reparar: ' + (err.message || 'Erro'));
                                  }
                                }}>
                                  <UserPlus className="h-4 w-4 mr-2" /> Reparar participantes
                                </DropdownMenuItem>

                                <DropdownMenuItem onClick={async () => {
                                   try {
                                     const ls = (currentLead as any)?.lead_status;
                                     if ((currentLead as any)?.is_blocked || ls === 'refused' || ls === 'inviavel') {
                                       toast.error('Lead encerrado/bloqueado — não é possível modificar o grupo.');
                                       return;
                                     }
                                     toast.info('Adicionando instâncias do funil ao grupo...');
                                    const { data: { user } } = await supabase.auth.getUser();
                                    let instId: string | null = null;
                                    if (user) {
                                      const { data: profile } = await supabase.from('profiles').select('default_instance_id').eq('user_id', user.id).single();
                                      instId = (profile as any)?.default_instance_id || null;
                                    }
                                    if (!currentLead.board_id) {
                                      toast.error('Lead sem funil definido. Defina o funil antes de adicionar as instâncias do funil.');
                                      return;
                                    }
                                    const { data, error } = await supabase.functions.invoke('repair-whatsapp-group', {
                                      body: { group_jid: g.group_jid, instance_id: instId, action: 'add_instances', board_id: currentLead.board_id },
                                    });
                                    if (error) throw error;
                                    toast.success(data?.message || `${data?.added || 0} instância(s) adicionada(s).`);
                                  } catch (err: any) {
                                    toast.error('Erro: ' + (err.message || 'Erro'));
                                  }
                                }}>
                                  <Users className="h-4 w-4 mr-2" /> Adicionar instâncias do funil
                                </DropdownMenuItem>

                                <DropdownMenuItem onClick={async () => {
                                   try {
                                     const ls = (currentLead as any)?.lead_status;
                                     if ((currentLead as any)?.is_blocked || ls === 'refused' || ls === 'inviavel') {
                                       toast.error('Lead encerrado/bloqueado — não é possível modificar o grupo.');
                                       return;
                                     }
                                     toast.info('Promovendo todas as instâncias conectadas a administrador...');
                                    const { data: { user } } = await supabase.auth.getUser();
                                    let instId: string | null = null;
                                    if (user) {
                                      const { data: profile } = await supabase.from('profiles').select('default_instance_id').eq('user_id', user.id).single();
                                      instId = (profile as any)?.default_instance_id || null;
                                    }
                                    const { data, error } = await supabase.functions.invoke('repair-whatsapp-group', {
                                      body: {
                                        group_jid: g.group_jid,
                                        instance_id: instId,
                                        action: 'add_instances',
                                        promote_to_admin: true,
                                        scope: 'all_active',
                                      },
                                    });
                                    if (error) throw error;
                                    const promoted = data?.promoted ?? data?.added ?? 0;
                                    toast.success(data?.message || `${promoted} instância(s) promovida(s) a admin.`);
                                  } catch (err: any) {
                                    toast.error('Erro ao promover instâncias: ' + (err.message || 'Erro'));
                                  }
                                }}>
                                  <ShieldCheck className="h-4 w-4 mr-2" /> Promover instâncias a admin
                                </DropdownMenuItem>

                                <DropdownMenuSeparator />

                                <DropdownMenuItem onClick={async () => {
                                  try {
                                    toast.info('Reenviando procuração assinada...');
                                    const { data: { user } } = await supabase.auth.getUser();
                                    let instId: string | null = null;
                                    if (user) {
                                      const { data: profile } = await supabase.from('profiles').select('default_instance_id').eq('user_id', user.id).single();
                                      instId = (profile as any)?.default_instance_id || null;
                                    }
                                    const { data, error } = await supabase.functions.invoke('repair-whatsapp-group', {
                                      body: { group_jid: g.group_jid, lead_id: currentLead.id, instance_id: instId, action: 'resend_signed_docs' },
                                    });
                                    if (error) throw error;
                                    if (data?.docs_forwarded > 0) {
                                      toast.success(`${data.docs_forwarded} documento(s) reenviado(s)!`);
                                    } else {
                                      toast.warning('Nenhum documento assinado encontrado.');
                                    }
                                  } catch (err: any) {
                                    toast.error('Erro: ' + (err.message || 'Erro'));
                                  }
                                }}>
                                  <FileSignature className="h-4 w-4 mr-2" /> Reenviar procuração assinada
                                </DropdownMenuItem>

                                <DropdownMenuItem onClick={async () => {
                                  try {
                                    toast.info('Reenviando mensagem inicial...');
                                    const { data: { user } } = await supabase.auth.getUser();
                                    let instId: string | null = null;
                                    if (user) {
                                      const { data: profile } = await supabase.from('profiles').select('default_instance_id').eq('user_id', user.id).single();
                                      instId = (profile as any)?.default_instance_id || null;
                                    }
                                    const { data, error } = await supabase.functions.invoke('repair-whatsapp-group', {
                                      body: { group_jid: g.group_jid, lead_id: currentLead.id, instance_id: instId, action: 'resend_initial_message', board_id: currentLead.board_id },
                                    });
                                    if (error) throw error;
                                    toast.success(data?.message || 'Mensagem inicial reenviada!');
                                  } catch (err: any) {
                                    toast.error('Erro: ' + (err.message || 'Erro'));
                                  }
                                }}>
                                  <Send className="h-4 w-4 mr-2" /> Reenviar mensagem inicial
                                </DropdownMenuItem>

                                <DropdownMenuSeparator />

                                <DropdownMenuItem onClick={async () => {
                                  try {
                                    toast.info('Analisando conversa do grupo com IA...');
                                    const { data, error } = await supabase.functions.invoke('auto-enrich-lead', {
                                      body: {
                                        lead_id: currentLead.id,
                                        group_jid: g.group_jid,
                                        force: true,
                                        dry_run: true,
                                      },
                                    });
                                    if (error) throw error;
                                    if (data?.skipped) {
                                      toast.warning('Enriquecimento ignorado: ' + (data.skipped === 'no_messages' ? 'sem mensagens no grupo' : data.skipped));
                                      return;
                                    }
                                    // dry_run: nada gravado ainda → revisão. Fallback: função
                                    // antiga ignora dry_run e grava direto → mostra o que aplicou.
                                    const extracted = data?.dry_run ? data.extracted : data?.enriched;
                                    if (!extracted || Object.keys(extracted).length === 0) {
                                      toast.warning('A IA não encontrou informações na conversa.');
                                      return;
                                    }
                                    setEnrichReview({
                                      extracted,
                                      current: data?.current || {},
                                      customFields: data?.custom_fields || [],
                                      leadNameLocked: data?.lead_name_locked !== false,
                                      alreadyApplied: !data?.dry_run,
                                      groupJid: g.group_jid,
                                    });
                                  } catch (err: any) {
                                    toast.error('Erro ao enriquecer: ' + (err.message || 'Erro'));
                                  }
                                }}>
                                  <Sparkles className="h-4 w-4 mr-2" /> Enriquecer lead com IA (com revisão)
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                          <Button type="button" variant="ghost" size="sm" onClick={() => setGroupRemovalIdx(idx)}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                        {!canOpen && g.group_jid?.includes('@g.us') && (
                          <p className="text-xs text-muted-foreground">
                            {fetchingInviteJids.has(g.group_jid)
                              ? '🔄 Buscando link de convite do grupo automaticamente...'
                              : '💡 Clique em "Buscar link" para obter o convite (requer instância admin do grupo) ou cole o link manualmente.'}
                          </p>
                        )}
                        {!canOpen && g.group_link && !g.group_jid?.includes('@g.us') && (
                          <p className="text-xs text-amber-600">
                            ⚠ Cole o link de convite (chat.whatsapp.com/…) para habilitar o botão Abrir.
                          </p>
                        )}
                        {g.group_jid?.includes('@g.us') ? (
                          <p className="text-xs text-green-600 flex items-center gap-1 mt-0.5" title={g.group_jid}>
                            ✅ <span className="font-medium truncate">
                              {g.group_name || `Grupo ${g.group_jid.replace('@g.us', '').slice(-6)}`}
                            </span>
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Cole o link do grupo. O ID será extraído ao salvar.
                          </p>
                        )}
                      </div>
                      );
                    })}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={() => setWhatsappGroups(prev => [...prev, { group_link: '', group_jid: '', group_name: '', label: '' }])}
                    >
                      <Plus className="h-3 w-3" /> Adicionar grupo
                    </Button>
                  </div>
                </div>)}

                {/* Instagram e Classificação removidos do form do Lead — são dados do Contato.
                    Os valores continuam sendo persistidos (instagram_username / client_classification)
                    para não quebrar integrações. Edite via aba Contatos. */}


                {isFieldVisible('expected_birth_date') && clientClassification?.toLowerCase().includes('parto') && (
                  <div>
                    <Label>Previsão do Parto</Label>
                    <Input
                      type="date"
                      value={expectedBirthDate}
                      onChange={(e) => setExpectedBirthDate(e.target.value)}
                    />
                  </div>
                )}

                {/* Lead Outcome - Fechado/Recusado/Inviável */}
                <div className="col-span-2 space-y-3 p-3 border rounded-lg bg-muted/20">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <Label className="text-sm font-medium">Resultado do Lead</Label>
                    {(currentLead as any)?.is_blocked && (
                      <Badge variant="destructive" className="gap-1">
                        <Ban className="h-3 w-3" /> Bloqueado pelo cliente
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant={leadOutcome === 'no_response' ? 'default' : 'outline'}
                      size="sm"
                      className={`flex-1 min-w-[100px] ${leadOutcome === 'no_response' ? 'bg-slate-600 hover:bg-slate-700 text-white' : ''}`}
                      onClick={() => {
                        if (leadOutcome === 'no_response') { setLeadOutcome(''); setLeadOutcomeDate(''); }
                        else { setLeadOutcome('no_response'); setLeadOutcomeDate(''); }
                      }}
                    >
                      <MessageSquare className="h-4 w-4 mr-1" /> Não respondeu
                    </Button>
                    <Button
                      type="button"
                      variant={leadOutcome === 'in_progress' ? 'default' : 'outline'}
                      size="sm"
                      className={`flex-1 min-w-[100px] ${leadOutcome === 'in_progress' ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}`}
                      onClick={() => {
                        if (leadOutcome === 'in_progress') { setLeadOutcome(''); setLeadOutcomeDate(''); }
                        else { setLeadOutcome('in_progress'); if (!leadOutcomeDate) setLeadOutcomeDate(new Date().toISOString().slice(0, 10)); }
                      }}
                    >
                      <Clock className="h-4 w-4 mr-1" /> Em Andamento
                    </Button>
                    <Button
                      type="button"
                      variant={leadOutcome === 'closed' ? 'default' : 'outline'}
                      size="sm"
                      className={`flex-1 min-w-[100px] ${leadOutcome === 'closed' ? 'bg-green-600 hover:bg-green-700 text-white' : ''}`}
                      onClick={() => {
                        if (leadOutcome === 'closed') { setLeadOutcome(''); setLeadOutcomeDate(''); }
                        else { setLeadOutcome('closed'); if (!leadOutcomeDate) setLeadOutcomeDate(new Date().toISOString().slice(0, 10)); }
                      }}
                    >
                      <CheckCircle className="h-4 w-4 mr-1" /> Fechado
                    </Button>
                    <Button
                      type="button"
                      variant={leadOutcome === 'refused' ? 'default' : 'outline'}
                      size="sm"
                      className={`flex-1 min-w-[100px] ${leadOutcome === 'refused' ? 'bg-destructive hover:bg-destructive/90 text-white' : ''}`}
                      onClick={() => {
                        if (leadOutcome === 'refused') { setLeadOutcome(''); setLeadOutcomeDate(''); }
                        else { setLeadOutcome('refused'); if (!leadOutcomeDate) setLeadOutcomeDate(new Date().toISOString().slice(0, 10)); }
                      }}
                    >
                      <XCircle className="h-4 w-4 mr-1" /> Recusado
                    </Button>
                    <Button
                      type="button"
                      variant={leadOutcome === 'inviavel' ? 'default' : 'outline'}
                      size="sm"
                      className={`flex-1 min-w-[100px] ${leadOutcome === 'inviavel' ? 'bg-amber-500 hover:bg-amber-600 text-white' : ''}`}
                      onClick={() => {
                        if (leadOutcome === 'inviavel') { setLeadOutcome(''); setLeadOutcomeDate(''); }
                        else { setLeadOutcome('inviavel'); if (!leadOutcomeDate) setLeadOutcomeDate(new Date().toISOString().slice(0, 10)); }
                      }}
                    >
                      <AlertTriangle className="h-4 w-4 mr-1" /> Inviável
                    </Button>
                    <Button
                      type="button"
                      variant={leadOutcome === 'cancelled' ? 'default' : 'outline'}
                      size="sm"
                      className={`flex-1 min-w-[100px] ${leadOutcome === 'cancelled' ? 'bg-purple-600 hover:bg-purple-700 text-white' : ''}`}
                      onClick={() => {
                        if (leadOutcome === 'cancelled') { setLeadOutcome(''); setLeadOutcomeDate(''); }
                        else { setLeadOutcome('cancelled'); if (!leadOutcomeDate) setLeadOutcomeDate(new Date().toISOString().slice(0, 10)); }
                      }}
                    >
                      <Ban className="h-4 w-4 mr-1" /> Cancelado
                    </Button>
                  </div>
                  {leadOutcome && (
                    <>
                      <div>
                        <Label className="text-xs">
                          {leadOutcome === 'closed' ? 'Data de Fechamento' : leadOutcome === 'refused' ? 'Data da Recusa' : leadOutcome === 'inviavel' ? 'Data da Inviabilidade' : leadOutcome === 'cancelled' ? 'Data do Cancelamento' : 'Data de Início'}
                        </Label>
                        <Input type="date" value={leadOutcomeDate} onChange={(e) => setLeadOutcomeDate(e.target.value)} className="mt-1" />
                      </div>
                      <div>
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">Motivo</Label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs gap-1"
                            disabled={isGeneratingReason}
                            onClick={async () => {
                              if (!lead) return;
                              setIsGeneratingReason(true);
                              try {
                                const phone = lead.lead_phone?.replace(/\D/g, '');
                                if (!phone) { toast.error('Lead sem telefone para análise'); return; }
                                const last8 = phone.slice(-8);
                                // Find instance_name from recent messages
                                const { data: instMsg } = await supabase
                                  .from('whatsapp_messages')
                                  .select('instance_name')
                                  .or(`phone.ilike.%${last8}%`)
                                  .not('instance_name', 'is', null)
                                  .order('created_at', { ascending: false })
                                  .limit(1);
                                const leadInstanceName = instMsg?.[0]?.instance_name;
                                if (!leadInstanceName) { toast.error('Nenhuma conversa encontrada'); return; }

                                const statusLabel = leadOutcome === 'inviavel' ? 'INVIÁVEL' : leadOutcome === 'refused' ? 'RECUSADO' : leadOutcome === 'closed' ? 'FECHADO' : leadOutcome === 'cancelled' ? 'CANCELAMENTO' : 'EM ANDAMENTO';
                                const { data, error } = await cloudFunctions.invoke('extract-conversation-data', {
                                  body: {
                                    phone,
                                    instance_name: leadInstanceName,
                                    targetType: 'reason',
                                    customPrompt: `Analise a conversa e determine o MOTIVO pelo qual este lead foi classificado como "${statusLabel}". Retorne APENAS um JSON: {"reason": "motivo resumido em 1-2 frases"}. Seja objetivo e direto.`
                                  }
                                });
                                if (error) throw error;
                                const reason = data?.data?.reason;
                                if (reason) {
                                  setLeadOutcomeReason(reason);
                                  toast.success('Motivo preenchido pela IA');
                                } else {
                                  toast.warning('IA não conseguiu determinar o motivo');
                                }
                              } catch (e: any) {
                                console.error('AI reason error:', e);
                                toast.error('Erro ao gerar motivo com IA');
                              } finally {
                                setIsGeneratingReason(false);
                              }
                            }}
                          >
                            {isGeneratingReason ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                            {isGeneratingReason ? 'Analisando...' : 'Preencher com IA'}
                          </Button>
                        </div>
                        <Input 
                          placeholder={leadOutcome === 'inviavel' ? 'Ex: Prazo prescrito, sem direito...' : leadOutcome === 'refused' ? 'Ex: Não quis prosseguir...' : leadOutcome === 'cancelled' ? 'Ex: Cliente desistiu, cancelou contrato...' : 'Motivo (opcional)'}
                          value={leadOutcomeReason}
                          onChange={(e) => setLeadOutcomeReason(e.target.value)}
                          className="mt-1"
                        />
                      </div>
                    </>
                  )}
                  <div>
                    <Label className="flex items-center gap-1">
                      Nº do Caso <span className="text-[10px] text-muted-foreground font-normal">(auto-gerado pelo Produto)</span>
                    </Label>
                    <Input
                      value={caseNumber}
                      readOnly
                      placeholder="Será gerado automaticamente ao fechar o lead"
                      className="font-mono bg-muted/40 cursor-not-allowed"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      O número é <strong>gerado automaticamente</strong> a partir do <strong>prefixo do Produto</strong> vinculado ao lead (ex: <span className="font-mono">PREV-1</span>, <span className="font-mono">PREV-2</span>...). Configure o prefixo no cadastro do produto em <strong>Custos & Organização</strong>.
                    </p>
                    {caseSyncCheck?.needsUpdate && (
                      <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-2 text-xs flex items-start gap-2">
                        <div className="flex-1">
                          <p className="font-medium text-amber-900 dark:text-amber-200">Sugestão de Nº do caso</p>
                          <p className="text-amber-800 dark:text-amber-300 mt-0.5">
                            Posição na fila de assinatura: <span className="font-mono font-semibold">{caseSyncCheck.expectedCaseNumber || '—'}</span>
                            {caseSyncCheck.expectedLeadName && (
                              <> · sugestão de nome: <span className="font-mono">{caseSyncCheck.expectedLeadName}</span></>
                            )}
                          </p>
                          <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">Apenas sugestão — confirme antes de aplicar.</p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={applyCaseSync}
                          disabled={caseSyncApplying}
                        >
                          {caseSyncApplying ? 'Aplicando...' : 'Usar sugestão'}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {isFieldVisible('news_link') && (<div className="col-span-2">
                  <LeadNewsLinksManager
                    newsLinks={newsLinks}
                    onChange={(links) => {
                      setNewsLinks(links);
                      setNewsLink(links[0] || '');
                    }}
                    currentData={{
                      victim_name: victimName,
                      victim_age: victimAge,
                      accident_date: accidentDate,
                      accident_address: accidentAddress,
                      damage_description: damageDescription,
                      case_type: caseType,
                      contractor_company: contractorCompany,
                      main_company: mainCompany,
                      sector,
                      liability_type: liabilityType,
                      legal_viability: legalViability,
                      visit_city: visitCity,
                      visit_state: visitState,
                      notes,
                    }}
                    onApplyUpdates={(updates) => {
                      const u = updates as any;
                      if (u.victim_name) setVictimName(u.victim_name);
                      if (u.victim_age) setVictimAge(u.victim_age);
                      if (u.accident_date) { const nd = normalizeDateInput(u.accident_date); if (nd) setAccidentDate(nd); }
                      if (u.accident_address) setAccidentAddress(u.accident_address);
                      if (u.damage_description) setDamageDescription(u.damage_description);
                      if (u.case_type) setCaseType(u.case_type);
                      if (u.contractor_company) setContractorCompany(u.contractor_company);
                      if (u.main_company) setMainCompany(u.main_company);
                      if (u.sector) setSector(u.sector);
                      if (u.liability_type) setLiabilityType(u.liability_type);
                      if (u.visit_city) setVisitCity(u.visit_city);
                      if (u.visit_state) setVisitState(u.visit_state);
                      if (u.notes) setNotes(u.notes);
                    }}
                  />
                </div>)}

                {isFieldVisible('notes') && (<div className="col-span-2">
                  <Label>Observações</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Notas sobre o lead..."
                    rows={2}
                  />
                </div>)}

                {boards.length > 0 && (
                  <div className="col-span-2">
                    <Label>Funil / Quadro Kanban</Label>
                    <Select 
                      value={selectedBoardId || '__none__'} 
                      onValueChange={(val) => {
                        const newBoardId = val === '__none__' ? '' : val;
                        setSelectedBoardId(newBoardId);
                        // Reset stage to the first stage of the new board
                        if (newBoardId && newBoardId !== (lead as any)?.board_id) {
                          const newBoard = boards.find(b => b.id === newBoardId);
                          if (newBoard?.stages?.length > 0) {
                            const firstStage = (newBoard.stages as any[])[0];
                            if (firstStage?.id) {
                              // We'll include status reset in the save
                            }
                          }
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um funil..." />
                      </SelectTrigger>
                      <SelectContent className="pointer-events-auto z-[9999]" position="popper" sideOffset={4}>
                        <SelectItem value="__none__">Sem funil</SelectItem>
                        {boards.map(b => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="col-span-2">
                  <Label>Campanha (opcional)</Label>
                  <Select
                    value={selectedCampaignId || '__none__'}
                    onValueChange={(val) => setSelectedCampaignId(val === '__none__' ? '' : val)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sem campanha" />
                    </SelectTrigger>
                    <SelectContent className="pointer-events-auto z-[9999]" position="popper" sideOffset={4}>
                      <SelectItem value="__none__">Sem campanha</SelectItem>
                      {campaignsList.filter(c => c.status !== 'closed').map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Vincula o lead a uma campanha para consolidar métricas de ROI/CAC.
                  </p>
                </div>
              </div>
              <div className="pt-4 border-t">
                <Suspense fallback={<div className="flex items-center justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div>}>
                  <CustomFieldsConfigPanel
                    leadId={lead.id}
                    currentBoardId={layoutBoardId}
                    boards={boards}
                    adAccountId={adAccountId}
                    tabKey="basic"
                    hideHeader
                    hideEmptyStateButton
                  />
                </Suspense>
              </div>
              </>)}
            </TabsContent>

            {/* Contacts Tab */}
            <TabsContent value="contacts" className="mt-0">
              {activeTab === 'contacts' && (
                <Suspense fallback={<div className="flex items-center justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div>}>
                  <LeadLinkedContacts leadId={lead.id} />
                </Suspense>
              )}
            </TabsContent>

            {/* Activities Tab */}
            <TabsContent value="activities" className="mt-0">
              {activeTab === 'activities' && (
                <Suspense fallback={<div className="flex items-center justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div>}>
                  <LeadActivitiesTab leadId={lead.id} leadName={lead.lead_name || ''} />
                </Suspense>
              )}
            </TabsContent>

            {/* Accident Details Tab */}
            <TabsContent value="accident" className="space-y-4 mt-0">
              {activeTab === 'accident' && (<>
              <div className="grid grid-cols-2 gap-4">
                {isFieldVisible('victim_name') && (<div>
                  <Label>Nome da Vítima</Label>
                  <Input
                    value={victimName}
                    onChange={(e) => setVictimName(e.target.value)}
                    placeholder="Nome completo da vítima"
                  />
                </div>)}

                {isFieldVisible('victim_age') && (<div>
                  <Label>Idade da Vítima</Label>
                  <Input
                    type="number"
                    value={victimAge}
                    onChange={(e) => setVictimAge(e.target.value)}
                    placeholder="Idade"
                  />
                </div>)}

                {isFieldVisible('accident_date') && (<div>
                  <Label>Data do Acidente</Label>
                  <Input
                    type="date"
                    value={accidentDate}
                    onChange={(e) => setAccidentDate(e.target.value)}
                  />
                </div>)}

                {isFieldVisible('case_type') && (<div>
                  <Label>Tipo de Caso</Label>
                  <Select value={safeSelectValue(caseType)} onValueChange={setCaseType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {caseTypes.map((type) => (
                        <SelectItem key={type} value={type}>{type}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>)}

                {isFieldVisible('accident_address') && (<div className="col-span-2">
                  <Label>Endereço do Acidente</Label>
                  <Input
                    value={accidentAddress}
                    onChange={(e) => setAccidentAddress(e.target.value)}
                    placeholder="Local onde ocorreu o acidente"
                  />
                </div>)}

                {isFieldVisible('damage_description') && (<div className="col-span-2">
                  <Label>Descrição do Dano</Label>
                  <Textarea
                    value={damageDescription}
                    onChange={(e) => setDamageDescription(e.target.value)}
                    placeholder="Descreva as lesões ou danos sofridos..."
                    rows={3}
                  />
                </div>)}
              </div>
              <CustomFieldsConfigPanel
                leadId={lead.id}
                currentBoardId={layoutBoardId}
                boards={boards}
                adAccountId={adAccountId}
                tabKey="accident"
                hideHeader
                hideEmptyStateButton
              />
              </>)}
            </TabsContent>

            {/* Location Tab */}
            <TabsContent value="location" className="space-y-4 mt-0">
              {activeTab === 'location' && (<>
              <div className="grid grid-cols-2 gap-4">
                {isFieldVisible('visit_state') && (<div>
                  <Label>Estado da Visita</Label>
                  <Select 
                    value={safeSelectValue(visitState)} 
                    onValueChange={(value) => {
                      setVisitState(value);
                      setVisitCity(''); // Reset city when state changes
                      setVisitRegion(stateToRegion[value] || ''); // Auto-fill region
                      fetchCities(value); // Fetch cities for selected state
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o estado..." />
                    </SelectTrigger>
                    <SelectContent>
                      {states.map((state) => (
                        <SelectItem key={state.sigla} value={state.sigla}>
                          {state.sigla} - {state.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>)}

                {isFieldVisible('visit_city') && (<div>
                  <Label>Cidade da Visita</Label>
                  <Select 
                    value={safeSelectValue(visitCity)} 
                    onValueChange={setVisitCity}
                    disabled={!visitState || loadingCities}
                  >
                    <SelectTrigger>
                      {loadingCities ? (
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Carregando...
                        </span>
                      ) : (
                        <SelectValue placeholder={visitState ? "Selecione a cidade..." : "Selecione o estado primeiro"} />
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      {cities.map((city) => (
                        <SelectItem key={city.id} value={city.nome}>
                          {city.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>)}

                {isFieldVisible('visit_region') && (<div>
                  <Label>Região da Visita</Label>
                  <Select value={safeSelectValue(visitRegion)} onValueChange={setVisitRegion}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {regions.map((region) => (
                        <SelectItem key={region} value={region}>{region}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>)}

                {isFieldVisible('visit_address') && (<div className="col-span-2">
                  <Label>Endereço da Visita</Label>
                  <Input
                    value={visitAddress}
                    onChange={(e) => setVisitAddress(e.target.value)}
                    placeholder="Endereço completo para visita"
                  />
                </div>)}
              </div>
              <CustomFieldsConfigPanel
                leadId={lead.id}
                currentBoardId={layoutBoardId}
                boards={boards}
                adAccountId={adAccountId}
                tabKey="location"
                hideHeader
                hideEmptyStateButton
              />
              </>)}
            </TabsContent>

            {/* Companies Tab */}
            <TabsContent value="companies" className="space-y-4 mt-0">
              {activeTab === 'companies' && (<>
              <div className="grid grid-cols-2 gap-4">
                {isFieldVisible('contractor_company') && (<div>
                  <Label>Empresa Terceirizada</Label>
                  <Input
                    value={contractorCompany}
                    onChange={(e) => setContractorCompany(e.target.value)}
                    placeholder="Nome da empresa terceirizada"
                  />
                </div>)}

                {isFieldVisible('main_company') && (<div>
                  <Label>Empresa Tomadora</Label>
                  <Input
                    value={mainCompany}
                    onChange={(e) => setMainCompany(e.target.value)}
                    placeholder="Nome da empresa tomadora"
                  />
                </div>)}

                {isFieldVisible('sector') && (<div>
                  <Label>Setor</Label>
                  <Select value={safeSelectValue(sector)} onValueChange={setSector}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {sectors.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>)}

                {isFieldVisible('company_size_justification') && (<div className="col-span-2">
                  <Label>Justificativa do Porte da Empresa</Label>
                  <Textarea
                    value={companySizeJustification}
                    onChange={(e) => setCompanySizeJustification(e.target.value)}
                    placeholder="Justificativa sobre o porte da empresa..."
                    rows={2}
                  />
                </div>)}
              </div>
              <CustomFieldsConfigPanel
                leadId={lead.id}
                currentBoardId={layoutBoardId}
                boards={boards}
                adAccountId={adAccountId}
                tabKey="companies"
                hideHeader
                hideEmptyStateButton
              />
              </>)}
            </TabsContent>

            {/* Legal Tab */}
            <TabsContent value="legal" className="space-y-4 mt-0">
              {activeTab === 'legal' && (<>
              {/* AI Analysis Button */}
              <div className="bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/20 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium flex items-center gap-2">
                      <Scale className="h-4 w-4 text-primary" />
                      Análise de Viabilidade com IA
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      Analisa porte da empresa, responsabilidade e potencial do caso
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleStartViabilityAnalysis}
                    disabled={analyzingViability}
                    className="gap-2"
                  >
                    {analyzingViability ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Analisando...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Analisar Caso
                      </>
                    )}
                  </Button>
                </div>

                {/* Link confirmation dialog */}
                {showLinkConfirm && (
                  <div className="mt-4 pt-4 border-t border-primary/20 space-y-3">
                    <div>
                      <Label className="text-sm">Link da notícia para análise</Label>
                      <div className="flex gap-2 mt-1">
                        <Input
                          value={tempNewsLink}
                          onChange={(e) => setTempNewsLink(e.target.value)}
                          placeholder="https://..."
                          className="flex-1"
                        />
                      </div>
                      {newsLink && tempNewsLink !== newsLink && (
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                          <RefreshCw className="h-3 w-3" />
                          Link atual será substituído
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleAnalyzeViability(tempNewsLink)}
                        disabled={!tempNewsLink || analyzingViability}
                      >
                        {analyzingViability ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-1" />
                            Analisando...
                          </>
                        ) : (
                          <>
                            <Scale className="h-4 w-4 mr-1" />
                            Analisar
                          </>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setShowLinkConfirm(false)}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                {isFieldVisible('liability_type') && (<div>
                  <Label>Tipo de Responsabilidade</Label>
                  <Select value={safeSelectValue(liabilityType)} onValueChange={setLiabilityType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {liabilityTypes.map((type) => (
                        <SelectItem key={type} value={type}>{type}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>)}

                {isFieldVisible('news_link') && (<div>
                  <Label>Link da Notícia</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Gerencie os links na aba "Dados do Caso" acima
                  </p>
                  {newsLinks.length > 0 && (
                    <div className="mt-1 space-y-1">
                      {newsLinks.map((l, i) => (
                        <a key={i} href={l} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline block truncate">{l}</a>
                      ))}
                    </div>
                  )}
                </div>)}

                {isFieldVisible('legal_viability') && (<div className="col-span-2">
                  <Label>Viabilidade Jurídica</Label>
                  <Textarea
                    value={legalViability}
                    onChange={(e) => setLegalViability(e.target.value)}
                    placeholder="Análise de viabilidade jurídica do caso..."
                    rows={5}
                  />
                </div>)}
              </div>
              <CustomFieldsConfigPanel
                leadId={lead.id}
                currentBoardId={layoutBoardId}
                boards={boards}
                adAccountId={adAccountId}
                tabKey="legal"
                hideHeader
                hideEmptyStateButton
              />
              </>)}
            </TabsContent>

            {customLayoutTabs.map((tab) => (
              <TabsContent key={tab.key} value={tab.key} className="space-y-4 mt-0">
                {activeTab === tab.key && lead && (
                  <CustomFieldsConfigPanel
                    leadId={lead.id}
                    currentBoardId={layoutBoardId}
                    boards={boards}
                    adAccountId={adAccountId}
                    tabKey={tab.key}
                    hideHeader
                    hideEmptyStateButton
                  />
                )}
              </TabsContent>
            ))}

            {/* Casos Tab */}
            {leadOutcome === 'closed' && (
              <TabsContent value="casos" className="mt-0">
                {activeTab === 'casos' && (
                  <Suspense fallback={<div className="flex items-center justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div>}>
                    <LegalCasesTab leadId={lead.id} boards={boards} onViewContact={handleViewContact} />
                  </Suspense>
                )}
              </TabsContent>
            )}

            {/* Financeiro Tab */}
            <TabsContent value="financeiro" className="mt-0">
              {activeTab === 'financeiro' && (
                <Suspense fallback={<div className="flex items-center justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div>}>
                  <LeadFinancialsTab leadId={lead.id} />
                </Suspense>
              )}
            </TabsContent>

            <TabsContent value="documents" className="mt-0">
              {activeTab === 'documents' && lead && (
                <LeadDocumentsTab
                  leadId={lead.id}
                  leadName={(currentLead as any)?.lead_name || lead.lead_name || 'Lead'}
                  whatsappGroupId={(currentLead as any)?.whatsapp_group_id || (lead as any).whatsapp_group_id || null}
                  customFields={customFields.map((f) => ({
                    id: f.id,
                    name: f.field_name,
                    type: f.field_type,
                    options: f.field_options,
                  }))}
                  onApplyExtractedFields={async (values) => {
                    await saveAllFieldValues(lead.id, values as any);
                    setLocalFieldValues((prev) => ({ ...prev, ...values }));
                  }}
                />
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-0 space-y-6">
              {activeTab === 'history' && (
                <Suspense fallback={<div className="flex items-center justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div>}>
                  <LinkOrphanWhatsAppButton leadId={lead.id} leadPhone={leadPhone || (currentLead as any)?.lead_phone} />
                  <LeadStageHistoryPanel leadId={lead.id} boards={boards} />
                  <div className="pt-4 border-t">
                    <LeadLinkedComments leadId={lead.id} instagramUsername={instagramUsername} />
                  </div>
                </Suspense>
              )}
            </TabsContent>

            {/* Chat IA Tab */}
            <TabsContent value="ai_chat" className="mt-0" style={{ height: 'calc(90vh - 320px)', minHeight: '300px' }}>
              {activeTab === 'ai_chat' && (
                <Suspense fallback={<div className="flex items-center justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div>}>
                  <EntityAIChat
                    leadId={lead.id}
                    entityType="lead"
                    onApplyLeadFields={(fields) => {
                      if (fields.victim_name) setVictimName(fields.victim_name);
                      if (fields.main_company) setMainCompany(fields.main_company);
                      if (fields.contractor_company) setContractorCompany(fields.contractor_company);
                      if (fields.case_type) setCaseType(fields.case_type);
                      if (fields.damage_description) setDamageDescription(fields.damage_description);
                      if (fields.visit_city) setVisitCity(fields.visit_city);
                      if (fields.visit_state) setVisitState(fields.visit_state);
                      if (fields.sector) setSector(fields.sector);
                      if (fields.liability_type) setLiabilityType(fields.liability_type);
                      if (fields.notes) setNotes(prev => prev ? `${prev}\n\n${fields.notes}` : fields.notes);
                    }}
                  />
                </Suspense>
              )}
            </TabsContent>

            {/* Chat Equipe Tab */}
            <TabsContent value="team_chat" className="mt-0" style={{ height: 'calc(90vh - 320px)', minHeight: '300px' }}>
              {activeTab === 'team_chat' && (
                <Suspense fallback={<div className="flex items-center justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div>}>
                  <TeamChatPanel
                    entityType="lead"
                    entityId={lead.id}
                    entityName={lead.lead_name || 'Lead'}
                  />
                </Suspense>
              )}
            </TabsContent>
          </div>
        </Tabs>
        </div>

        <Footer className="mt-4 flex-shrink-0 flex-row sm:justify-between gap-2 border-t pt-4">
          {currentLead ? (
            <Button
              variant="outline"
              onClick={() => setShowDeleteConfirm(true)}
              className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Excluir Lead
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveClick} disabled={saving}>
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </Footer>

        <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir lead?</AlertDialogTitle>
              <AlertDialogDescription>
                O lead <strong>{currentLead?.lead_name || 'sem nome'}</strong> será excluído permanentemente. Esta ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); handleDeleteLead(); }}
                disabled={deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? 'Excluindo...' : 'Excluir'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={groupRemovalIdx !== null} onOpenChange={(open) => { if (!open) setGroupRemovalIdx(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Esse grupo é de um caso fechado?</AlertDialogTitle>
              <AlertDialogDescription>
                {groupRemovalIdx !== null && (
                  <>Grupo: <strong>{whatsappGroups[groupRemovalIdx]?.group_name || whatsappGroups[groupRemovalIdx]?.label || whatsappGroups[groupRemovalIdx]?.group_jid || 'sem nome'}</strong>.{' '}</>
                )}
                Se for caso fechado, o lead será marcado como <strong>Fechado</strong> com a data de criação do grupo, o grupo continuará vinculado e será obrigatório cadastrar o processo do caso antes de salvar.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const idx = groupRemovalIdx;
                  setGroupRemovalIdx(null);
                  if (idx !== null) setWhatsappGroups(prev => prev.filter((_, i) => i !== idx));
                }}
              >
                Não, só remover
              </Button>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); handleGroupRemovalClosedCase(); }}
                className="bg-green-600 text-white hover:bg-green-700"
              >
                Sim, é caso fechado
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Content>
    </Wrapper>

      {currentLead && (
        <CloseLeadGroupDialog
          open={closeGroupDialogOpen}
          leadId={currentLead.id}
          boardId={(currentLead as any).board_id}
          onClose={() => setCloseGroupDialogOpen(false)}
          onConfirm={(payload) => {
            setCloseGroupDialogOpen(false);
            setPendingCloseContacts(payload.contacts_to_add);
            handleSave(payload.contacts_to_add);
          }}
        />
      )}

      {/* Contact Detail Sheet for viewing parties */}
      {contactSheetOpen && (
        <Suspense fallback={null}>
          <ContactDetailSheet
            contact={viewingContact}
            open={contactSheetOpen}
            onOpenChange={(v) => { setContactSheetOpen(v); if (!v) setViewingContact(null); }}
          />
        </Suspense>
      )}

      {/* Group Contact Sync Dialog */}
      {syncGroupData && currentLead && (
        <GroupContactSyncDialog
          open={!!syncGroupData}
          onClose={() => setSyncGroupData(null)}
          leadId={currentLead.id}
          leadName={currentLead.lead_name || ''}
          groupJid={syncGroupData.jid}
          groupName={syncGroupData.name}
          instanceId={syncGroupData.instanceId}
        />
      )}
      {currentLead?.id && (
        <LeadGroupSearchDialog
          open={groupSearchOpen}
          onOpenChange={setGroupSearchOpen}
          leadId={currentLead.id}
          contactPhone={leadPhone}
          instanceName={groupSearchInstance}
          leadName={currentLead.lead_name || ''}
          onGroupSelected={(g) => {
            setWhatsappGroups((prev) => {
              const exists = prev.find((x) => x.group_jid === g.jid);
              if (exists) return prev;
              return [
                ...prev.filter((x) => x.group_jid || x.group_link || x.group_name),
                {
                  group_jid: g.jid,
                  group_link: g.invite_link || '',
                  group_name: g.name || '',
                  label: '',
                },
              ];
            });
            toast.success('Grupo vinculado ao lead. Lembre de salvar.');
            // Auto-sugere acolhedor a partir do CRIADOR real do grupo
            // (consulta /group/info via backfill em modo lookup). Só preenche
            // se o campo estiver vazio — respeita escolha manual.
            if (!acolhedor && g.jid) {
              cloudFunctions
                .invoke('backfill-acolhedor-from-group-owner', {
                  body: { group_jid: g.jid, dry_run: true },
                })
                .then((res: any) => {
                  const r = res?.data?.results?.[0];
                  if (r?.status === 'ok' && r.operator) {
                    setAcolhedor(r.operator);
                    toast.success(`Acolhedor detectado pelo criador do grupo: ${r.operator}`);
                  }
                })
                .catch((err: any) => {
                  console.warn('[acolhedor-from-group-creator] falhou:', err?.message || err);
                });
            }
          }}
        />
      )}

      {currentLead && (
        <Suspense fallback={null}>
          <LeadFieldsUnifiedEditor
            open={unifiedEditorOpen}
            onOpenChange={setUnifiedEditorOpen}
            boardId={currentLead.board_id || selectedBoardId || ''}
            boardName={boards.find(b => b.id === (currentLead.board_id || selectedBoardId))?.name}
            adAccountId={adAccountId}
          />
        </Suspense>
      )}

      {/* Revisão do enriquecimento por IA (dry-run → confirmar individual/lote) */}
      {enrichReview && (
        <Suspense fallback={null}>
          <EnrichReviewDialog
            open={!!enrichReview}
            onOpenChange={(o) => { if (!o && !enrichApplying) setEnrichReview(null); }}
            data={enrichReview}
            applying={enrichApplying}
            onApply={handleEnrichApply}
          />
        </Suspense>
      )}
    </>
  );
}
