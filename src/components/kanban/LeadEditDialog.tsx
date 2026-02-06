import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
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
import { LeadStageHistoryPanel } from '@/components/kanban/LeadStageHistoryPanel';
import { AccidentDataExtractor, ExtractedAccidentData } from '@/components/leads/AccidentDataExtractor';
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
} from 'lucide-react';
import { classificationColors } from '@/hooks/useContactClassifications';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface LeadEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead | null;
  onSave: (leadId: string, updates: Partial<Lead>) => Promise<void>;
  adAccountId?: string;
  boards?: KanbanBoard[];
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

const sources = [
  { value: 'manual', label: 'Manual' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'form', label: 'Formulário' },
  { value: 'referral', label: 'Indicação' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'noticia', label: 'Notícia' },
  { value: 'prospecção', label: 'Prospecção Ativa' },
];

export function LeadEditDialog({
  open,
  onOpenChange,
  lead,
  onSave,
  adAccountId,
  boards = [],
}: LeadEditDialogProps) {
  // Basic fields state
  const [leadName, setLeadName] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [instagramUsername, setInstagramUsername] = useState('');
  const [source, setSource] = useState('manual');
  const [notes, setNotes] = useState('');
  const [acolhedor, setAcolhedor] = useState('');
  const [groupLink, setGroupLink] = useState('');
  const [clientClassification, setClientClassification] = useState<string>('');
  
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
  const [legalViability, setLegalViability] = useState('');
  
  // Custom fields
  const { customFields, getFieldValues, saveAllFieldValues, loading: fieldsLoading } = useLeadCustomFields(adAccountId);
  const { classifications, classificationConfig, addClassification } = useContactClassifications();
  const { fetchProfileNames, getDisplayName, loading: profilesLoading } = useProfileNames();
  const { states, cities, loadingCities, fetchCities } = useBrazilianLocations();
  const [fieldValues, setFieldValues] = useState<Record<string, CustomFieldValue>>({});
  const [localFieldValues, setLocalFieldValues] = useState<Record<string, { type: FieldType; value: string | number | boolean | null }>>({});
  const [saving, setSaving] = useState(false);
  
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

  // Load lead data when dialog opens
  useEffect(() => {
    if (lead && open) {
      const leadAny = lead as any;
      
      // Basic fields
      setLeadName(lead.lead_name || '');
      setLeadPhone(lead.lead_phone || '');
      setLeadEmail(lead.lead_email || '');
      setInstagramUsername(lead.instagram_username || '');
      setSource(lead.source || 'manual');
      setNotes(lead.notes || '');
      setAcolhedor(leadAny.acolhedor || '');
      setGroupLink(leadAny.group_link || '');
      setClientClassification(lead.client_classification || '');
      
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
      setNewsLink(lead.news_link || '');
      setLegalViability(leadAny.legal_viability || '');
      
      // Load custom field values
      loadCustomFieldValues(lead.id);
      
      // Fetch profile names for created_by and updated_by
      fetchProfileNames([leadAny.created_by, leadAny.updated_by]);
    }
  }, [lead, open, fetchProfileNames]);

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
    
    // Basic
    if (u.lead_name) setLeadName(u.lead_name);
    if (u.notes) setNotes(prev => prev ? `${prev}\n\n${u.notes}` : u.notes);
    
    // Accident
    if (u.victim_name) setVictimName(u.victim_name);
    if (u.victim_age) setVictimAge(u.victim_age.toString());
    if (u.accident_date) setAccidentDate(u.accident_date);
    if (u.case_type) setCaseType(u.case_type);
    if (u.accident_address) setAccidentAddress(u.accident_address);
    if (u.damage_description) setDamageDescription(u.damage_description);
    
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
    
    // Auto-generate lead name in pattern: City (State) | Victim x Company (Injury) - (Date)
    const city = data.visit_city || '';
    const state = data.visit_state || '';
    const victim = data.victim_name || ''; // Full victim name
    const company = data.main_company || data.contractor_company || '';
    const injury = data.damage_description || data.case_type || '';
    const accDate = data.accident_date ? format(new Date(data.accident_date), 'dd/MM/yyyy') : '';
    
    // Build lead name parts
    const parts: string[] = [];
    
    // Location part: City (State)
    if (city && state) {
      parts.push(`${city} (${state})`);
    } else if (city) {
      parts.push(city);
    } else if (state) {
      parts.push(`(${state})`);
    }
    
    // Victim x Company part
    let mainPart = '';
    if (victim && company) {
      mainPart = `${victim} x ${company}`;
    } else if (victim) {
      mainPart = victim;
    } else if (company) {
      mainPart = company;
    }
    
    // Injury and date
    const details: string[] = [];
    if (injury) details.push(injury);
    if (accDate) details.push(accDate);
    
    if (mainPart) {
      if (details.length > 0) {
        mainPart += ` (${details.join(' - ')})`;
      }
      parts.push(mainPart);
    }
    
    // Generate final name
    if (parts.length > 0) {
      const generatedName = parts.join(' | ');
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
      const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke('scrape-news', {
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
${scrapeData.data?.markdown || scrapeData.data?.content || ''}
      `.trim();

      // Call AI to analyze viability
      const { data: aiData, error: aiError } = await supabase.functions.invoke('analyze-legal-viability', {
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

  const handleSave = async () => {
    if (!lead) return;
    
    if (!leadName.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }

    setSaving(true);
    try {
      // Save all fields
      await onSave(lead.id, {
        lead_name: leadName.trim(),
        lead_phone: leadPhone || null,
        lead_email: leadEmail || null,
        instagram_username: instagramUsername || null,
        source,
        notes: notes || null,
        client_classification: (clientClassification || null) as 'client' | 'non_client' | 'prospect' | null,
        acolhedor: acolhedor || null,
        group_link: groupLink || null,
        // Accident fields
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
        news_link: newsLink || null,
        legal_viability: legalViability || null,
      } as Partial<Lead>);

      // Save custom field values
      if (Object.keys(localFieldValues).length > 0) {
        await saveAllFieldValues(lead.id, localFieldValues);
      }

      toast.success('Lead atualizado com sucesso!');
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving lead:', error);
      toast.error('Erro ao salvar lead');
    } finally {
      setSaving(false);
    }
  };

  if (!lead) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Editar Lead
          </DialogTitle>
        </DialogHeader>

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
        />

        <Tabs defaultValue="basic" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-6 h-auto">
            <TabsTrigger value="basic" className="text-xs py-2">
              <User className="h-3 w-3 mr-1" />
              Básico
            </TabsTrigger>
            <TabsTrigger value="accident" className="text-xs py-2">
              <FileText className="h-3 w-3 mr-1" />
              Acidente
            </TabsTrigger>
            <TabsTrigger value="location" className="text-xs py-2">
              <MapPin className="h-3 w-3 mr-1" />
              Local
            </TabsTrigger>
            <TabsTrigger value="companies" className="text-xs py-2">
              <Building className="h-3 w-3 mr-1" />
              Empresas
            </TabsTrigger>
            <TabsTrigger value="legal" className="text-xs py-2">
              <Briefcase className="h-3 w-3 mr-1" />
              Jurídico
            </TabsTrigger>
            <TabsTrigger value="history" className="text-xs py-2">
              <History className="h-3 w-3 mr-1" />
              Histórico
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 pr-4 mt-4">
            {/* Basic Info Tab */}
            <TabsContent value="basic" className="space-y-4 mt-0">
              {/* Meta info */}
              {(() => {
                const leadAny = lead as any;
                const creatorName = getDisplayName(leadAny.created_by);
                const editorName = getDisplayName(leadAny.updated_by);
                const hasEditor = leadAny.updated_by && leadAny.updated_by !== leadAny.created_by;
                
                return (
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mb-4">
                    <Badge variant="outline" className="gap-1">
                      <Calendar className="h-3 w-3" />
                      Criado: {format(new Date(lead.created_at), "dd/MM/yyyy", { locale: ptBR })}
                      {creatorName && (
                        <span className="ml-1 flex items-center gap-0.5">
                          <UserCheck className="h-3 w-3" />
                          {creatorName}
                        </span>
                      )}
                    </Badge>
                    <Badge variant="outline" className="gap-1">
                      <Clock className="h-3 w-3" />
                      Atualizado: {format(new Date(lead.updated_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
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
                  <Label>Telefone</Label>
                  <Input
                    value={leadPhone}
                    onChange={(e) => setLeadPhone(e.target.value)}
                    placeholder="(00) 00000-0000"
                  />
                </div>

                <div>
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={leadEmail}
                    onChange={(e) => setLeadEmail(e.target.value)}
                    placeholder="email@exemplo.com"
                  />
                </div>

                <div>
                  <Label>Origem</Label>
                  <Select value={source} onValueChange={setSource}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sources.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Acolhedor</Label>
                  <Input
                    value={acolhedor}
                    onChange={(e) => setAcolhedor(e.target.value)}
                    placeholder="Nome do acolhedor"
                  />
                </div>

                <div className="col-span-2">
                  <Label>Link do Grupo</Label>
                  <Input
                    value={groupLink}
                    onChange={(e) => setGroupLink(e.target.value)}
                    placeholder="https://chat.whatsapp.com/..."
                  />
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

                <div className="col-span-2">
                  <Label>Observações</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Notas sobre o lead..."
                    rows={2}
                  />
                </div>
              </div>
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
                  <Select value={caseType} onValueChange={setCaseType}>
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
                    value={visitState} 
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
                    value={visitCity} 
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
                  <Select value={visitRegion} onValueChange={setVisitRegion}>
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
                  <Select value={sector} onValueChange={setSector}>
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
                  <Select value={liabilityType} onValueChange={setLiabilityType}>
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
                  <Input
                    value={newsLink}
                    onChange={(e) => setNewsLink(e.target.value)}
                    placeholder="https://..."
                  />
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

            {/* History Tab */}
            <TabsContent value="history" className="mt-0">
              <LeadStageHistoryPanel leadId={lead.id} boards={boards} />
              
              {/* Custom Fields Section */}
              {customFields.length > 0 && (
                <div className="mt-6 pt-4 border-t">
                  <h4 className="font-medium mb-4 flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    Campos Personalizados
                  </h4>
                  {fieldsLoading ? (
                    <div className="text-sm text-muted-foreground py-4 text-center">
                      Carregando campos personalizados...
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {customFields.map((field) => (
                        <CustomFieldInput
                          key={field.id}
                          field={field}
                          value={fieldValues[field.id] || null}
                          onChange={handleFieldChange}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
