import { useState, useEffect, useRef } from 'react';
import { safeSelectValue } from '@/utils/selectValue';
import { sendLeadConversionEvent } from '@/utils/metaConversionTracking';
import { supabase } from '@/integrations/supabase/client';
import { useProfilesList } from '@/hooks/useProfilesList';
import { generateLeadName } from '@/utils/generateLeadName';
import { LeadLinkedContacts } from '@/components/leads/LeadLinkedContacts';
import { LeadLinkedComments } from '@/components/leads/LeadLinkedComments';
import { LeadNewsLinksManager } from '@/components/leads/LeadNewsLinksManager';
import { EntityAIChat } from '@/components/activities/EntityAIChat';
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
import { CustomFieldInput } from '@/components/leads/CustomFieldsForm';
import { CustomFieldsConfigPanel } from '@/components/leads/CustomFieldsConfigPanel';
import { LeadStageHistoryPanel } from '@/components/kanban/LeadStageHistoryPanel';
import { LeadFunnelOverview } from '@/components/kanban/LeadFunnelOverview';
import { LeadActivitiesTab } from '@/components/leads/LeadActivitiesTab';
import { AccidentDataExtractor, ExtractedAccidentData, CurrentLeadData } from '@/components/leads/AccidentDataExtractor';
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
} from 'lucide-react';
import { classificationColors } from '@/hooks/useContactClassifications';
import { ShareMenu } from '@/components/ShareMenu';
import { TeamChatPanel } from '@/components/chat/TeamChatPanel';
import { LegalCasesTab } from '@/components/leads/LegalCasesTab';
import { LeadFinancialsTab } from '@/components/leads/LeadFinancialsTab';
import { ContactDetailSheet } from '@/components/contacts/ContactDetailSheet';
import { Contact as ContactType } from '@/hooks/useContacts';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useLeadSources } from '@/hooks/useLeadSources';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Pencil, Trash2 } from 'lucide-react';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { GroupContactSyncDialog } from '@/components/kanban/GroupContactSyncDialog';

interface LeadEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead | null;
  onSave: (leadId: string, updates: Partial<Lead>) => Promise<void>;
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
  adAccountId,
  boards = [],
  mode = 'dialog',
  initialTab,
}: LeadEditDialogProps) {
  const [hydratedLead, setHydratedLead] = useState<Lead | null>(lead);
  // Basic fields state
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
  const [syncGroupData, setSyncGroupData] = useState<{ jid: string; name: string; instanceId?: string } | null>(null);
  const [clientClassification, setClientClassification] = useState<string>('');
  const [expectedBirthDate, setExpectedBirthDate] = useState('');
  const [leadOutcome, setLeadOutcome] = useState<'' | 'closed' | 'refused' | 'in_progress' | 'inviavel'>('');
  const [leadOutcomeDate, setLeadOutcomeDate] = useState('');
  const [leadOutcomeReason, setLeadOutcomeReason] = useState('');
  const [isGeneratingReason, setIsGeneratingReason] = useState(false);
  const [caseNumber, setCaseNumber] = useState('');
  
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
  const { customFields, getFieldValues, saveAllFieldValues, loading: fieldsLoading } = useLeadCustomFields(adAccountId);
  const { classifications, classificationConfig, addClassification } = useContactClassifications();
  const { fetchProfileNames, getDisplayName, loading: profilesLoading } = useProfileNames();
  const { states, cities, loadingCities, fetchCities } = useBrazilianLocations();
  const [fieldValues, setFieldValues] = useState<Record<string, CustomFieldValue>>({});
  const [localFieldValues, setLocalFieldValues] = useState<Record<string, { type: FieldType; value: string | number | boolean | null }>>({});
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');
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

  useEffect(() => {
    let cancelled = false;

    const hydrateLead = async () => {
      if (!open || !lead?.id) {
        setHydratedLead(lead);
        return;
      }

      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('id', lead.id)
        .maybeSingle();

      if (!cancelled) {
        setHydratedLead(!error && data ? (data as Lead) : lead);
      }
    };

    hydrateLead();

    return () => {
      cancelled = true;
    };
  }, [open, lead]);

  const currentLead = hydratedLead ?? lead;

  // Load lead data when dialog opens
  useEffect(() => {
    if (currentLead && open) {
      const leadAny = currentLead as any;
      
      // Reset tab (use initialTab if provided, e.g. from deep link)
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
      const loadGroups = async () => {
        const { data: groups } = await supabase
          .from('lead_whatsapp_groups')
          .select('*')
          .eq('lead_id', currentLead.id)
          .order('created_at', { ascending: true });
        if (groups) {
          setWhatsappGroups(groups.map((g: any) => ({
            id: g.id,
            group_link: g.group_link || '',
            group_jid: g.group_jid || '',
            group_name: g.group_name || '',
            label: g.label || '',
          })));
        }
        // Also migrate legacy single group if exists and no groups in new table
        if ((!groups || groups.length === 0) && (leadAny.group_link || leadAny.whatsapp_group_id)) {
          setWhatsappGroups([{
            group_link: leadAny.group_link || '',
            group_jid: leadAny.whatsapp_group_id || '',
            group_name: '',
            label: '',
          }]);
        }
      };
      loadGroups();
      setClientClassification(currentLead.client_classification || '');
      setExpectedBirthDate(leadAny.expected_birth_date || '');
      setSelectedBoardId(leadAny.board_id || '');
      // Outcome
      setCaseNumber(leadAny.case_number || '');
      setLeadOutcomeReason(leadAny.lead_status_reason || '');
      // Use lead_status field as primary source of truth
      const leadStatus = leadAny.lead_status;
      if (leadStatus === 'closed' || leadAny.became_client_date) {
        setLeadOutcome('closed');
        setLeadOutcomeDate(leadAny.became_client_date || '');
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
      
      // Load custom field values
      loadCustomFieldValues(currentLead.id);
      
      // Fetch profile names for created_by and updated_by
      fetchProfileNames([leadAny.created_by, leadAny.updated_by]);
    }
  }, [currentLead, open, fetchProfileNames]);

  const loadCustomFieldValues = async (leadId: string) => {
    const values = await getFieldValues(leadId);
    setFieldValues(values);
    
    // Initialize local values from loaded values
    const initial: Record<string, { type: FieldType; value: string | number | boolean | null }> = {};
    customFields.forEach(field => {
      const val = values[field.id];
      if (val) {
        let value: string | number | boolean | null = null;
        switch (field.field_type) {
          case 'text':
          case 'select':
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

  const handleFieldChange = (fieldId: string, type: FieldType, value: string | number | boolean | null) => {
    setLocalFieldValues(prev => ({
      ...prev,
      [fieldId]: { type, value },
    }));
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
    if (u.accident_date) setAccidentDate(u.accident_date);
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
    if (data.accident_date) setAccidentDate(data.accident_date);
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

  const handleSave = async () => {
    if (!currentLead) return;
    
    if (!leadName.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }

    console.log('[handleSave] Starting save for lead:', currentLead.id);
    setSaving(true);
    try {
      // Save WhatsApp groups to new table
      // First delete all existing groups for this lead, then insert current ones
      await supabase.from('lead_whatsapp_groups').delete().eq('lead_id', currentLead.id);
      
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
      }
      
      if (resolvedGroups.length > 0) {
        await supabase.from('lead_whatsapp_groups').insert(
          resolvedGroups.map(g => ({
            lead_id: currentLead.id,
            group_link: g.group_link || null,
            group_jid: g.group_jid || null,
            group_name: g.group_name || null,
            label: g.label || null,
          }))
        );
      }
      setWhatsappGroups(resolvedGroups);

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
        accident_date: accidentDate || null,
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
        ...(selectedBoardId && selectedBoardId !== (currentLead as any).board_id ? (() => {
          const newBoard = boards.find(b => b.id === selectedBoardId);
          const firstStage = newBoard?.stages?.[0] as any;
          return firstStage?.id ? { status: firstStage.id } : {};
        })() : {}),
        expected_birth_date: expectedBirthDate || null,
        became_client_date: leadOutcome === 'closed' ? (leadOutcomeDate || new Date().toISOString().slice(0, 10)) : null,
        classification_date: leadOutcome === 'refused' ? (leadOutcomeDate || new Date().toISOString().slice(0, 10)) : null,
        in_progress_date: leadOutcome === 'in_progress' ? (leadOutcomeDate || new Date().toISOString().slice(0, 10)) : null,
        inviavel_date: leadOutcome === 'inviavel' ? (leadOutcomeDate || new Date().toISOString().slice(0, 10)) : null,
        lead_status_reason: leadOutcomeReason || null,
        case_number: caseNumber || null,
      } as any);

      // Save custom field values
       if (Object.keys(localFieldValues).length > 0) {
         await saveAllFieldValues(currentLead.id, localFieldValues);
       }

      // Save status history if outcome changed
       const previousOutcome = (currentLead as any).became_client_date ? 'closed' : (currentLead as any).inviavel_date ? 'inviavel' : (currentLead as any).classification_date ? 'refused' : (currentLead as any).in_progress_date ? 'in_progress' : 'active';
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
         await supabase.from('lead_stage_history').insert({
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
           await supabase.from('leads').update({ lead_status: 'closed' } as any).eq('id', currentLead.id);
           // Send conversion event to Meta CAPI
           sendLeadConversionEvent({
             id: currentLead.id,
             lead_name: currentLead.lead_name,
             lead_phone: (currentLead as any).lead_phone,
             ctwa_context: (currentLead as any).ctwa_context,
             campaign_id: (currentLead as any).campaign_id,
             contract_value: (currentLead as any).contract_value,
           }, 'closed');
           // Rename WhatsApp group with closed prefix
           if ((currentLead as any).whatsapp_group_id) {
             cloudFunctions.invoke('rename-whatsapp-group', {
               body: { lead_id: currentLead.id },
             }).then((res: any) => {
               if (res?.data?.success) {
                 console.log('Group renamed:', res.data.old_name, '→', res.data.new_name);
               }
             }).catch((e: any) => console.warn('Group rename failed:', e));
           }
         }

        try {
             const { data: existingCases } = await supabase
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

            // Use case_number from UI if provided, otherwise generate
            let finalCaseNumber = caseNumber?.trim() || null;
            if (!finalCaseNumber) {
              const { data: generatedNumber } = await supabase
                .rpc('generate_case_number', { p_nucleus_id: matchedNucleusId });
              finalCaseNumber = generatedNumber || 'CASO-0001';
            }
            
            const { data: insertedCase, error: insertError } = await supabase
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
              toast.success(`Caso ${insertedCase?.case_number || finalCaseNumber} criado! Cadastre os processos na aba Casos.`);
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
         await supabase.from('leads').update({ lead_status: 'refused' } as any).eq('id', currentLead.id);
         // Send conversion event to Meta CAPI
         sendLeadConversionEvent({
           id: currentLead.id,
           lead_name: currentLead.lead_name,
           lead_phone: (currentLead as any).lead_phone,
           ctwa_context: (currentLead as any).ctwa_context,
           campaign_id: (currentLead as any).campaign_id,
         }, 'refused');
       } else if (leadOutcome === 'inviavel') {
         await supabase.from('leads').update({ lead_status: 'inviavel' } as any).eq('id', currentLead.id);
         // Send conversion event to Meta CAPI
         sendLeadConversionEvent({
           id: currentLead.id,
           lead_name: currentLead.lead_name,
           lead_phone: (currentLead as any).lead_phone,
           ctwa_context: (currentLead as any).ctwa_context,
           campaign_id: (currentLead as any).campaign_id,
         }, 'inviavel');
       } else if ((currentLead as any).became_client_date || (currentLead as any).inviavel_date) {
         // Was closed/inviável, now reopened
         await supabase.from('leads').update({ lead_status: 'active' } as any).eq('id', currentLead.id);
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

  if (!currentLead) return null;

  const Wrapper = mode === 'sheet' ? Sheet : Dialog;
  const Content = mode === 'sheet' ? SheetContent : DialogContent;
  const Header = mode === 'sheet' ? SheetHeader : DialogHeader;
  const Title = mode === 'sheet' ? SheetTitle : DialogTitle;
  const Footer = mode === 'sheet' ? SheetFooter : DialogFooter;

  const contentClassName = mode === 'sheet'
    ? 'sm:max-w-lg flex flex-col h-full overflow-y-auto'
    : 'max-w-2xl max-h-[90vh] flex flex-col';

  return (
    <>
    <Wrapper open={open} onOpenChange={onOpenChange}>
      <Content className={contentClassName} {...(mode === 'sheet' ? { side: 'right' as const } : {})}>
        <Header>
          <div className="flex items-center justify-between">
            <Title className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Editar Lead
            </Title>
            {currentLead && (
              <div className="flex items-center gap-1">
                <ShareMenu entityType="lead" entityId={currentLead.id} entityName={currentLead.lead_name || 'Lead'} />
              </div>
            )}
          </div>
        </Header>

        {/* AI Extraction Button - opens dialog directly */}
        <Button 
          type="button" 
          variant="outline" 
          onClick={() => setShowExtractor(true)}
          className="w-full gap-2 border-dashed border-primary/50 hover:border-primary"
        >
          <Sparkles className="h-4 w-4 text-primary" />
          Extrair dados de notícia ou documento com IA
        </Button>

        {/* AI Extraction Dialog */}
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

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col">
          <div className="w-full flex-shrink-0">
            <TabsList className="flex flex-wrap h-auto gap-1 p-1 bg-muted">
              <TabsTrigger value="basic" className="text-xs py-1.5 px-2.5">
                <User className="h-3 w-3 mr-1" />
                Básico
              </TabsTrigger>
              <TabsTrigger value="contacts" className="text-xs py-1.5 px-2.5">
                <Users className="h-3 w-3 mr-1" />
                Contatos
              </TabsTrigger>
              <TabsTrigger value="checklist" className="text-xs py-1.5 px-2.5">
                <CheckSquare className="h-3 w-3 mr-1" />
                {leadOutcome === 'closed' ? 'Fluxo de Trabalho' : 'Funil de Vendas'}
              </TabsTrigger>
              <TabsTrigger value="activities" className="text-xs py-1.5 px-2.5">
                <Calendar className="h-3 w-3 mr-1" />
                Atividades
              </TabsTrigger>
              <TabsTrigger value="accident" className="text-xs py-1.5 px-2.5">
                <FileText className="h-3 w-3 mr-1" />
                Acidente
              </TabsTrigger>
              <TabsTrigger value="location" className="text-xs py-1.5 px-2.5">
                <MapPin className="h-3 w-3 mr-1" />
                Local
              </TabsTrigger>
              <TabsTrigger value="companies" className="text-xs py-1.5 px-2.5">
                <Building className="h-3 w-3 mr-1" />
                Empresas
              </TabsTrigger>
              <TabsTrigger value="legal" className="text-xs py-1.5 px-2.5">
                <Briefcase className="h-3 w-3 mr-1" />
                Jurídico
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
              <TabsTrigger value="config" className="text-xs py-1.5 px-2.5">
                <Settings className="h-3 w-3 mr-1" />
                Config
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

          <div 
            className="overflow-y-scroll pr-3 mt-4 scrollbar-thin scrollbar-thumb-border scrollbar-track-muted/30" 
            style={{ height: 'calc(90vh - 280px)', minHeight: '300px' }}
          >
            {/* Basic Info Tab */}
            <TabsContent value="basic" className="space-y-4 mt-0">
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
                <div className="col-span-2">
                  <Label>Nome do Lead *</Label>
                  <Input
                    value={leadName}
                    onChange={(e) => setLeadName(e.target.value)}
                    placeholder="Nome do lead"
                  />
                </div>

                <div>
                  <Label className="flex items-center gap-1">
                    <Phone className="h-3 w-3" />
                    Telefone
                  </Label>
                  <Input
                    value={leadPhone}
                    onChange={(e) => setLeadPhone(e.target.value)}
                    placeholder="(00) 00000-0000"
                  />
                </div>

                <div>
                  <Label className="flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    Email
                  </Label>
                  <Input
                    value={leadEmail}
                    onChange={(e) => setLeadEmail(e.target.value)}
                    placeholder="email@exemplo.com"
                  />
                </div>

                <div>
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
                </div>

                <div>
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
                </div>

                <div className="col-span-2">
                  <Label>Grupos WhatsApp</Label>
                  <div className="space-y-2 mt-1">
                    {whatsappGroups.map((g, idx) => (
                      <div key={idx}>
                        <div className="flex items-center gap-2">
                          <Input
                            value={g.group_name || g.group_link || g.group_jid || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setWhatsappGroups(prev => prev.map((item, i) => i === idx ? {
                                ...item,
                                group_link: val.includes('@g.us') ? '' : val,
                                group_jid: val.includes('@g.us') ? val : item.group_jid,
                                group_name: val.includes('@g.us') || val.includes('chat.whatsapp.com') ? item.group_name : '',
                              } : item));
                            }}
                            placeholder="https://chat.whatsapp.com/... ou JID"
                            className="flex-1"
                          />
                          {(g.group_link || g.group_jid) && (
                            <a href={g.group_link?.includes('chat.whatsapp.com') ? g.group_link : `https://chat.whatsapp.com/${g.group_link || ''}`} target="_blank" rel="noopener noreferrer" className="shrink-0">
                              <Button type="button" variant="outline" size="sm" className="gap-1 text-green-600 border-green-200">
                                <ExternalLink className="h-3 w-3" /> Abrir
                              </Button>
                            </a>
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
                                    toast.info('Reparando grupo... Buscando contatos vinculados.');
                                    const { data: contactLinks } = await supabase
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
                                    toast.info('Adicionando instâncias do funil ao grupo...');
                                    const { data: { user } } = await supabase.auth.getUser();
                                    let instId: string | null = null;
                                    if (user) {
                                      const { data: profile } = await supabase.from('profiles').select('default_instance_id').eq('user_id', user.id).single();
                                      instId = (profile as any)?.default_instance_id || null;
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
                                    toast.info('Enriquecendo lead, caso e processo a partir da conversa do grupo...');
                                    const { data, error } = await supabase.functions.invoke('auto-enrich-lead', {
                                      body: {
                                        lead_id: currentLead.id,
                                        group_jid: g.group_jid,
                                        force: true,
                                      },
                                    });
                                    if (error) throw error;
                                    if (data?.skipped) {
                                      toast.warning('Enriquecimento ignorado: ' + (data.skipped === 'no_messages' ? 'sem mensagens no grupo' : data.skipped));
                                    } else {
                                      toast.success(data?.message || 'Lead, caso e processo enriquecidos com sucesso!');
                                    }
                                  } catch (err: any) {
                                    toast.error('Erro ao enriquecer: ' + (err.message || 'Erro'));
                                  }
                                }}>
                                  <Sparkles className="h-4 w-4 mr-2" /> Enriquecer lead, caso e processo
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                          <Button type="button" variant="ghost" size="sm" onClick={() => setWhatsappGroups(prev => prev.filter((_, i) => i !== idx))}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                        {g.group_jid?.includes('@g.us') ? (
                          <p className="text-xs text-green-600 flex items-center gap-1 mt-0.5">
                            ✅ {g.group_name ? <span className="font-medium">{g.group_name}</span> : null}
                            <span className="font-mono text-green-700 text-[10px]">{g.group_jid}</span>
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Cole o link do grupo. O ID será extraído ao salvar.
                          </p>
                        )}
                      </div>
                    ))}
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
                </div>

                <div>
                  <Label className="flex items-center gap-1">
                    <Instagram className="h-3 w-3" />
                    Instagram
                  </Label>
                  <Input
                    value={instagramUsername}
                    onChange={(e) => setInstagramUsername(e.target.value)}
                    placeholder="@usuario"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Classificação</Label>
                  {!isAddingClassification ? (
                    <div className="flex gap-2">
                      <Select 
                        value={clientClassification || '__none__'} 
                        onValueChange={(val) => setClientClassification(val === '__none__' ? '' : val)}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Selecione..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Sem classificação</SelectItem>
                          {classifications.map((c) => (
                            <SelectItem key={c.id} value={c.name}>
                              <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${c.color}`} />
                                {classificationConfig[c.name]?.label || c.name.replace(/_/g, ' ')}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button 
                        type="button" 
                        variant="outline" 
                        size="icon"
                        onClick={() => setIsAddingClassification(true)}
                        title="Nova classificação"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2 p-3 border rounded-lg bg-muted/30">
                      <Input
                        placeholder="Nome da classificação..."
                        value={newClassificationName}
                        onChange={(e) => setNewClassificationName(e.target.value)}
                        autoFocus
                      />
                      <div className="flex flex-wrap gap-1.5">
                        {classificationColors.slice(0, 10).map((color) => (
                          <button
                            key={color.value}
                            type="button"
                            className={`w-5 h-5 rounded-full transition-all ${color.value} ${
                              newClassificationColor === color.value ? 'ring-2 ring-offset-1 ring-primary' : ''
                            }`}
                            onClick={() => setNewClassificationColor(color.value)}
                            title={color.label}
                          />
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          size="sm" 
                          onClick={handleAddClassification} 
                          disabled={!newClassificationName.trim()}
                        >
                          Criar
                        </Button>
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          onClick={() => {
                            setIsAddingClassification(false);
                            setNewClassificationName('');
                          }}
                        >
                          <X className="h-3 w-3 mr-1" />
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {clientClassification?.toLowerCase().includes('parto') && (
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
                  <Label className="text-sm font-medium">Resultado do Lead</Label>
                  <div className="flex flex-wrap gap-2">
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
                  </div>
                  {leadOutcome && (
                    <>
                      <div>
                        <Label className="text-xs">
                          {leadOutcome === 'closed' ? 'Data de Fechamento' : leadOutcome === 'refused' ? 'Data da Recusa' : leadOutcome === 'inviavel' ? 'Data da Inviabilidade' : 'Data de Início'}
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
                                const { data: msgs } = await supabase
                                  .from('whatsapp_messages')
                                  .select('message_text, direction, created_at')
                                  .or(`phone.ilike.%${last8}%`)
                                  .order('created_at', { ascending: true })
                                  .limit(100);
                                if (!msgs || msgs.length === 0) { toast.error('Nenhuma conversa encontrada'); return; }

                                const statusLabel = leadOutcome === 'inviavel' ? 'INVIÁVEL' : leadOutcome === 'refused' ? 'RECUSADO' : leadOutcome === 'closed' ? 'FECHADO' : 'EM ANDAMENTO';
                                const { data, error } = await cloudFunctions.invoke('extract-conversation-data', {
                                  body: {
                                    messages: msgs.map(m => ({ message_text: m.message_text, direction: m.direction })),
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
                          placeholder={leadOutcome === 'inviavel' ? 'Ex: Prazo prescrito, sem direito...' : leadOutcome === 'refused' ? 'Ex: Não quis prosseguir...' : 'Motivo (opcional)'}
                          value={leadOutcomeReason}
                          onChange={(e) => setLeadOutcomeReason(e.target.value)}
                          className="mt-1"
                        />
                      </div>
                    </>
                  )}
                  {leadOutcome === 'closed' && (
                    <div>
                      <Label className="text-xs">Nº do Caso</Label>
                      <Input value={caseNumber} onChange={(e) => setCaseNumber(e.target.value)} placeholder="Número do caso..." className="mt-1" />
                    </div>
                  )}
                </div>

                <div className="col-span-2">
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
                      if (u.accident_date) setAccidentDate(u.accident_date);
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
                </div>

                <div className="col-span-2">
                  <Label>Observações</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Notas sobre o lead..."
                    rows={2}
                  />
                </div>

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
              </div>
            </TabsContent>

            {/* Contacts Tab */}
            <TabsContent value="contacts" className="mt-0">
              <LeadLinkedContacts leadId={lead.id} />
            </TabsContent>

            {/* Activities Tab */}
            <TabsContent value="activities" className="mt-0">
              <LeadActivitiesTab leadId={lead.id} leadName={lead.lead_name || ''} />
            </TabsContent>

            {/* Accident Details Tab */}
            <TabsContent value="accident" className="space-y-4 mt-0">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Nome da Vítima</Label>
                  <Input
                    value={victimName}
                    onChange={(e) => setVictimName(e.target.value)}
                    placeholder="Nome completo da vítima"
                  />
                </div>

                <div>
                  <Label>Idade da Vítima</Label>
                  <Input
                    type="number"
                    value={victimAge}
                    onChange={(e) => setVictimAge(e.target.value)}
                    placeholder="Idade"
                  />
                </div>

                <div>
                  <Label>Data do Acidente</Label>
                  <Input
                    type="date"
                    value={accidentDate}
                    onChange={(e) => setAccidentDate(e.target.value)}
                  />
                </div>

                <div>
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
                </div>

                <div className="col-span-2">
                  <Label>Endereço do Acidente</Label>
                  <Input
                    value={accidentAddress}
                    onChange={(e) => setAccidentAddress(e.target.value)}
                    placeholder="Local onde ocorreu o acidente"
                  />
                </div>

                <div className="col-span-2">
                  <Label>Descrição do Dano</Label>
                  <Textarea
                    value={damageDescription}
                    onChange={(e) => setDamageDescription(e.target.value)}
                    placeholder="Descreva as lesões ou danos sofridos..."
                    rows={3}
                  />
                </div>
              </div>
            </TabsContent>

            {/* Location Tab */}
            <TabsContent value="location" className="space-y-4 mt-0">
              <div className="grid grid-cols-2 gap-4">
                <div>
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
                </div>

                <div>
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
                </div>

                <div>
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
                </div>

                <div className="col-span-2">
                  <Label>Endereço da Visita</Label>
                  <Input
                    value={visitAddress}
                    onChange={(e) => setVisitAddress(e.target.value)}
                    placeholder="Endereço completo para visita"
                  />
                </div>
              </div>
            </TabsContent>

            {/* Companies Tab */}
            <TabsContent value="companies" className="space-y-4 mt-0">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Empresa Terceirizada</Label>
                  <Input
                    value={contractorCompany}
                    onChange={(e) => setContractorCompany(e.target.value)}
                    placeholder="Nome da empresa terceirizada"
                  />
                </div>

                <div>
                  <Label>Empresa Tomadora</Label>
                  <Input
                    value={mainCompany}
                    onChange={(e) => setMainCompany(e.target.value)}
                    placeholder="Nome da empresa tomadora"
                  />
                </div>

                <div>
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
                </div>

                <div className="col-span-2">
                  <Label>Justificativa do Porte da Empresa</Label>
                  <Textarea
                    value={companySizeJustification}
                    onChange={(e) => setCompanySizeJustification(e.target.value)}
                    placeholder="Justificativa sobre o porte da empresa..."
                    rows={2}
                  />
                </div>
              </div>
            </TabsContent>

            {/* Legal Tab */}
            <TabsContent value="legal" className="space-y-4 mt-0">
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
                <div>
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
                </div>

                <div>
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
                </div>

                <div className="col-span-2">
                  <Label>Viabilidade Jurídica</Label>
                  <Textarea
                    value={legalViability}
                    onChange={(e) => setLegalViability(e.target.value)}
                    placeholder="Análise de viabilidade jurídica do caso..."
                    rows={5}
                  />
                </div>
              </div>
            </TabsContent>

            {/* Funnel/Workflow Tab */}
            <TabsContent value="checklist" className="mt-0">
              {lead && (
                <LeadFunnelOverview
                  leadId={lead.id}
                  boardId={lead.board_id || null}
                  currentStageId={lead.status || null}
                  boards={boards}
                  isClosed={leadOutcome === 'closed'}
                />
              )}
            </TabsContent>

            {/* Casos Tab */}
            {leadOutcome === 'closed' && (
              <TabsContent value="casos" className="mt-0">
                <LegalCasesTab leadId={lead.id} boards={boards} onViewContact={handleViewContact} />
              </TabsContent>
            )}

            {/* Financeiro Tab */}
            <TabsContent value="financeiro" className="mt-0">
              <LeadFinancialsTab leadId={lead.id} />
            </TabsContent>

            <TabsContent value="history" className="mt-0 space-y-6">
              <LeadStageHistoryPanel leadId={lead.id} boards={boards} />
              
              {/* Linked Comments Section */}
              <div className="pt-4 border-t">
                <LeadLinkedComments leadId={lead.id} instagramUsername={instagramUsername} />
              </div>
            </TabsContent>

            {/* Configurações Tab */}
            <TabsContent value="config" className="mt-0">
              <CustomFieldsConfigPanel
                leadId={lead.id}
                currentBoardId={lead.board_id || selectedBoardId || null}
                boards={boards}
                adAccountId={adAccountId}
              />
            </TabsContent>

            {/* Chat IA Tab */}
            <TabsContent value="ai_chat" className="mt-0" style={{ height: 'calc(90vh - 320px)', minHeight: '300px' }}>
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
            </TabsContent>

            {/* Chat Equipe Tab */}
            <TabsContent value="team_chat" className="mt-0" style={{ height: 'calc(90vh - 320px)', minHeight: '300px' }}>
              <TeamChatPanel
                entityType="lead"
                entityId={lead.id}
                entityName={lead.lead_name || 'Lead'}
              />
            </TabsContent>
          </div>
        </Tabs>

        <Footer className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </Footer>
      </Content>
    </Wrapper>

      {/* Contact Detail Sheet for viewing parties */}
      <ContactDetailSheet
        contact={viewingContact}
        open={contactSheetOpen}
        onOpenChange={(v) => { setContactSheetOpen(v); if (!v) setViewingContact(null); }}
      />

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
    </>
  );
}
