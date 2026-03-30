import { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Plus, 
  Users, 
  DollarSign, 
  TrendingUp, 
  Phone,
  Mail,
  Edit2,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  MessageSquare,
  Target,
  AlertCircle,
  LayoutGrid,
  TableIcon,
  Download,
  Loader2,
  Facebook,
  Upload,
  FileSpreadsheet,
  Calendar,
  PlayCircle,
  Filter,
  X,
  Settings
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useContactLeads } from '@/hooks/useContactLeads';
import { useLeads, Lead, LeadStatus } from '@/hooks/useLeads';
import { CampaignInsight } from '@/services/metaAPI';
import LeadsPipeline from './LeadsPipeline';
import { format, differenceInDays, getDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useLeadCustomFields, FieldType } from '@/hooks/useLeadCustomFields';
import { CustomFieldsManager } from './leads/CustomFieldsManager';
import { CustomFieldsForm } from './leads/CustomFieldsForm';
import { CardFieldsSettings } from './leads/CardFieldsSettings';
import { useBrazilianLocations } from '@/hooks/useBrazilianLocations';
import { useCardFieldsSettings } from '@/hooks/useCardFieldsSettings';
import { FollowupAnalytics } from './leads/FollowupAnalytics';
import { StagnationSettings } from './leads/StagnationSettings';
import { StagnantLeadsList } from './leads/StagnantLeadsList';
import { useStagnationAlerts, StagnantLead } from '@/hooks/useStagnationAlerts';
import { BarChart3 } from 'lucide-react';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

const daysOfWeek = [
  { value: 0, label: 'Domingo', short: 'Dom' },
  { value: 1, label: 'Segunda-feira', short: 'Seg' },
  { value: 2, label: 'Terça-feira', short: 'Ter' },
  { value: 3, label: 'Quarta-feira', short: 'Qua' },
  { value: 4, label: 'Quinta-feira', short: 'Qui' },
  { value: 5, label: 'Sexta-feira', short: 'Sex' },
  { value: 6, label: 'Sábado', short: 'Sáb' },
];

interface LeadManagerProps {
  adAccountId?: string;
  campaigns?: CampaignInsight[];
  totalSpend?: number;
}

const statusConfig: Record<LeadStatus, { label: string; color: string; icon: React.ReactNode }> = {
  new: { label: 'Novo', color: 'bg-blue-500', icon: <Clock className="h-3 w-3" /> },
  contacted: { label: 'Contatado', color: 'bg-yellow-500', icon: <MessageSquare className="h-3 w-3" /> },
  qualified: { label: 'Qualificado', color: 'bg-green-500', icon: <Target className="h-3 w-3" /> },
  not_qualified: { label: 'Não Qualificado', color: 'bg-gray-500', icon: <XCircle className="h-3 w-3" /> },
  converted: { label: 'Convertido', color: 'bg-emerald-600', icon: <CheckCircle2 className="h-3 w-3" /> },
  lost: { label: 'Perdido', color: 'bg-red-500', icon: <XCircle className="h-3 w-3" /> },
  comment: { label: 'Comentário', color: 'bg-pink-500', icon: <MessageSquare className="h-3 w-3" /> },
};

const LeadManager = ({ adAccountId, campaigns = [], totalSpend = 0 }: LeadManagerProps) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { leads, stats, loading, addLead, updateLead, deleteLead, updateLeadStatus, fetchLeads, toggleFollower, updateClientClassification } = useLeads(adAccountId);
  const { customFields, getFieldValues, saveAllFieldValues } = useLeadCustomFields(adAccountId);
  const { states, cities, loadingCities, fetchCities } = useBrazilianLocations();
  const { config: cardFieldsConfig, updateField: updateCardField, resetToDefaults: resetCardFields } = useCardFieldsSettings();
  const {
    thresholds,
    enabledStatuses,
    updateThreshold,
    toggleStatusAlert,
    resetToDefaults: resetStagnationDefaults,
    stagnantLeads,
    stagnantCount,
    stagnantByStatus,
    isLeadStagnant,
  } = useStagnationAlerts(leads);
  
  // State for contact linking after lead creation
  const [pendingContactLink, setPendingContactLink] = useState<string | null>(null);
  const { linkLead } = useContactLeads(pendingContactLink || undefined);
  
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [viewMode, setViewMode] = useState<'pipeline' | 'table'>('pipeline');
  const [isImporting, setIsImporting] = useState(false);
  const [csvPreview, setCsvPreview] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, { type: FieldType; value: string | number | boolean | null }>>({});
  const [activeTab, setActiveTab] = useState('leads');
  const [newLead, setNewLead] = useState({
    lead_name: '',
    lead_phone: '',
    lead_email: '',
    campaign_id: '',
    campaign_name: '',
    ad_name: '',
    ad_start_date: '',
    notes: '',
    ad_spend_at_conversion: 0,
    state: '',
    city: '',
    neighborhood: '',
  });
  const [testEventCode, setTestEventCode] = useState('');
  const [dayOfWeekFilter, setDayOfWeekFilter] = useState<number | null>(null);

  // Handle URL params for pre-filling lead form from contacts page
  useEffect(() => {
    const newLeadParam = searchParams.get('newLead');
    const name = searchParams.get('name');
    const phone = searchParams.get('phone');
    const email = searchParams.get('email');
    const city = searchParams.get('city');
    const state = searchParams.get('state');
    const linkContact = searchParams.get('linkContact');

    if (newLeadParam === 'true') {
      // Pre-fill form with contact data
      setNewLead(prev => ({
        ...prev,
        lead_name: name || '',
        lead_phone: phone || '',
        lead_email: email || '',
        city: city || '',
        state: state || '',
      }));
      
      // Set pending contact link if provided
      if (linkContact) {
        setPendingContactLink(linkContact);
      }
      
      // Load cities if state is provided
      if (state) {
        fetchCities(state);
      }
      
      // Open dialog
      setIsAddDialogOpen(true);
      
      // Clean up URL params
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, fetchCities]);

  // Calculate leads by day of week
  const leadsByDayOfWeek = leads.reduce((acc, lead) => {
    const dayIndex = getDay(new Date(lead.created_at));
    acc[dayIndex] = (acc[dayIndex] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  // Find best day
  const bestDay = Object.entries(leadsByDayOfWeek).reduce(
    (best, [day, count]) => (count > best.count ? { day: parseInt(day), count } : best),
    { day: -1, count: 0 }
  );

  // Load cities when editing a lead with a state already set
  useEffect(() => {
    if (editingLead?.state) {
      fetchCities(editingLead.state);
    }
  }, [editingLead?.id]);

  const filteredLeads = dayOfWeekFilter !== null
    ? leads.filter(lead => getDay(new Date(lead.created_at)) === dayOfWeekFilter)
    : leads;

  const handleImportFacebookLeads = async () => {
    if (!adAccountId) {
      toast.error('Para importar leads do Facebook, conecte sua conta Meta no Dashboard (Modo Pro → Conectar Business Manager).');
      return;
    }

    setIsImporting(true);
    try {
      const { data, error } = await cloudFunctions.invoke('fetch-facebook-leads', {
        body: { adAccountId }
      });

      if (error) {
        console.error('Error importing leads:', error);
        toast.error('Erro ao importar leads do Facebook. Verifique se o token tem permissão "leads_retrieval".');
        return;
      }

      if (data.error) {
        console.error('API error:', data.error);
        if (data.error.includes('permission') || data.error.includes('Permission')) {
          toast.error('Sem permissão para acessar leads. Verifique se o token tem as permissões: leads_retrieval, pages_read_engagement');
        } else {
          toast.error(`Erro: ${data.error}`);
        }
        return;
      }

      if (data.imported === 0 && data.duplicates === 0) {
        toast.info('Nenhum lead novo encontrado. Verifique se você tem formulários de lead ativos nas campanhas.');
      } else {
        toast.success(`Importação concluída! ${data.imported} novos leads, ${data.duplicates} já existentes.`);
      }
      fetchLeads();
    } catch (error) {
      console.error('Error:', error);
      toast.error('Erro ao importar leads. Verifique sua conexão com o Facebook.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const lines = text.split('\n').filter(line => line.trim());
        
        if (lines.length < 2) {
          toast.error('O arquivo CSV precisa ter pelo menos uma linha de dados além do cabeçalho');
          return;
        }

        // Parse header
        const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
        
        // Find column indices - support multiple column name variations
        const findColumn = (names: string[]) => {
          return header.findIndex(h => names.some(n => h.includes(n)));
        };

        const nameIdx = findColumn(['full_name', 'full name', 'nome', 'name', 'lead_name']);
        const emailIdx = findColumn(['email', 'e-mail', 'lead_email']);
        const phoneIdx = findColumn(['phone', 'phone_number', 'telefone', 'lead_phone', 'whatsapp']);
        const campaignIdx = findColumn(['campaign', 'campanha', 'campaign_name']);
        const adsetIdx = findColumn(['adset', 'ad set', 'conjunto', 'adset_name']);
        const leadIdIdx = findColumn(['lead_id', 'facebook_lead_id', 'id']);

        // Parse data rows
        const parsedLeads = lines.slice(1).map(line => {
          // Handle CSV with quoted values
          const values: string[] = [];
          let current = '';
          let inQuotes = false;
          
          for (const char of line) {
            if (char === '"') {
              inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
              values.push(current.trim());
              current = '';
            } else {
              current += char;
            }
          }
          values.push(current.trim());

          return {
            lead_name: nameIdx >= 0 ? values[nameIdx]?.replace(/"/g, '') : '',
            lead_email: emailIdx >= 0 ? values[emailIdx]?.replace(/"/g, '') : '',
            lead_phone: phoneIdx >= 0 ? values[phoneIdx]?.replace(/"/g, '') : '',
            campaign_name: campaignIdx >= 0 ? values[campaignIdx]?.replace(/"/g, '') : '',
            adset_name: adsetIdx >= 0 ? values[adsetIdx]?.replace(/"/g, '') : '',
            facebook_lead_id: leadIdIdx >= 0 ? values[leadIdIdx]?.replace(/"/g, '') : '',
          };
        }).filter(lead => lead.lead_name || lead.lead_email || lead.lead_phone);

        if (parsedLeads.length === 0) {
          toast.error('Nenhum lead válido encontrado no arquivo. Verifique as colunas.');
          return;
        }

        setCsvPreview(parsedLeads);
        setIsImportDialogOpen(true);
        toast.success(`${parsedLeads.length} leads encontrados no arquivo`);
      } catch (error) {
        console.error('Error parsing CSV:', error);
        toast.error('Erro ao processar o arquivo CSV');
      }
    };
    reader.readAsText(file);
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleImportCSV = async () => {
    if (csvPreview.length === 0) return;

    setIsImporting(true);
    let imported = 0;
    let errors = 0;

    for (const lead of csvPreview) {
      try {
        const { error } = await supabase
          .from('leads')
          .insert({
            ...lead,
            ad_account_id: adAccountId,
            source: 'facebook',
            status: 'new',
            sync_status: 'synced',
          });

        if (error) {
          console.error('Error inserting lead:', error);
          errors++;
        } else {
          imported++;
        }
      } catch (error) {
        console.error('Error:', error);
        errors++;
      }
    }

    setIsImporting(false);
    setCsvPreview([]);
    setIsImportDialogOpen(false);
    fetchLeads();

    if (errors > 0) {
      toast.warning(`Importação concluída: ${imported} leads importados, ${errors} erros`);
    } else {
      toast.success(`${imported} leads importados com sucesso!`);
    }
  };

  const handleAddLead = async () => {
    if (!newLead.lead_name && !newLead.lead_phone) {
      return;
    }

    // Convert empty strings to null for database compatibility
    const leadData = {
      lead_name: newLead.lead_name || null,
      lead_phone: newLead.lead_phone || null,
      lead_email: newLead.lead_email || null,
      campaign_id: newLead.campaign_id || null,
      campaign_name: newLead.campaign_name || null,
      ad_name: newLead.ad_name || null,
      ad_start_date: newLead.ad_start_date || null,
      notes: newLead.notes || null,
      ad_spend_at_conversion: newLead.ad_spend_at_conversion || 0,
      state: newLead.state || null,
      city: newLead.city || null,
      neighborhood: newLead.neighborhood || null,
      source: 'whatsapp',
      status: 'new' as const,
    };

    const createdLead = await addLead(leadData, testEventCode || undefined);

    // Link to contact if pending
    if (createdLead && pendingContactLink) {
      try {
        await supabase
          .from('contact_leads' as any)
          .insert({
            contact_id: pendingContactLink,
            lead_id: createdLead.id,
          });
        toast.success('Lead criado e vinculado ao contato!');
      } catch (error) {
        console.error('Error linking lead to contact:', error);
      }
      setPendingContactLink(null);
    }

    setNewLead({
      lead_name: '',
      lead_phone: '',
      lead_email: '',
      campaign_id: '',
      campaign_name: '',
      ad_name: '',
      ad_start_date: '',
      notes: '',
      ad_spend_at_conversion: 0,
      state: '',
      city: '',
      neighborhood: '',
    });
    setIsAddDialogOpen(false);
  };

  const handleStatusChange = async (leadId: string, status: LeadStatus) => {
    if (status === 'converted') {
      const value = prompt('Qual foi o valor da conversão? (R$)');
      if (value) {
        await updateLeadStatus(leadId, status, parseFloat(value));
      }
    } else {
      await updateLeadStatus(leadId, status);
    }
  };

  const handleDeleteLead = async (id: string) => {
    if (confirm('Tem certeza que deseja remover este lead?')) {
      await deleteLead(id);
    }
  };

  const handleEditLead = async () => {
    if (!editingLead) return;
    
    await updateLead(editingLead.id, {
      lead_name: editingLead.lead_name,
      lead_phone: editingLead.lead_phone,
      lead_email: editingLead.lead_email,
      campaign_name: editingLead.campaign_name,
      ad_name: editingLead.ad_name,
      notes: editingLead.notes,
      classification_date: editingLead.classification_date,
      became_client_date: editingLead.became_client_date,
      city: editingLead.city,
      state: editingLead.state,
      neighborhood: editingLead.neighborhood,
    });

    // Save custom field values
    if (Object.keys(customFieldValues).length > 0) {
      try {
        await saveAllFieldValues(editingLead.id, customFieldValues);
      } catch (error) {
        console.error('Error saving custom fields:', error);
      }
    }
    
    setEditingLead(null);
    setCustomFieldValues({});
    toast.success('Lead atualizado com sucesso!');
  };

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total</span>
            </div>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Qualificados</span>
            </div>
            <div className="text-2xl font-bold text-green-500">{stats.qualified}</div>
            <div className="text-xs text-muted-foreground">{stats.qualificationRate.toFixed(1)}%</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span className="text-xs text-muted-foreground">Convertidos</span>
            </div>
            <div className="text-2xl font-bold text-emerald-600">{stats.converted}</div>
            <div className="text-xs text-muted-foreground">{stats.conversionRate.toFixed(1)}%</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">CPL</span>
            </div>
            <div className="text-2xl font-bold">R$ {stats.costPerLead.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">por lead</div>
          </CardContent>
        </Card>
        
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">CPL Convertido</span>
            </div>
            <div className="text-2xl font-bold text-primary">
              R$ {stats.costPerConvertedLead > 0 ? stats.costPerConvertedLead.toFixed(2) : '—'}
            </div>
            <div className="text-xs text-muted-foreground">custo real por venda</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Receita</span>
            </div>
            <div className="text-2xl font-bold text-green-500">
              R$ {(stats.totalRevenue ?? 0).toLocaleString('pt-BR')}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Info Card */}
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-blue-500 mt-0.5" />
            <div>
              <p className="font-medium text-sm">Custo por Lead Convertido (CPL Real)</p>
              <p className="text-xs text-muted-foreground mt-1">
                Este é o custo real por venda/conversão. Diferente do custo por clique ou lead do Facebook, 
                este valor considera apenas os leads que realmente compraram. 
                Use este número para calcular seu ROAS real e decidir se deve escalar campanhas.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Day of Week Analysis */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-4 w-4" />
            Leads por Dia da Semana
          </CardTitle>
          <CardDescription>
            Identifique os melhores dias para receber leads
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 mb-4">
            <Button
              variant={dayOfWeekFilter === null ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDayOfWeekFilter(null)}
              className="gap-1"
            >
              {dayOfWeekFilter === null && <X className="h-3 w-3" />}
              Todos
            </Button>
            {daysOfWeek.map((day) => {
              const count = leadsByDayOfWeek[day.value] || 0;
              const isBest = day.value === bestDay.day && count > 0;
              return (
                <Button
                  key={day.value}
                  variant={dayOfWeekFilter === day.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDayOfWeekFilter(dayOfWeekFilter === day.value ? null : day.value)}
                  className={`gap-1 ${isBest ? 'border-green-500 bg-green-500/10' : ''}`}
                >
                  <span>{day.short}</span>
                  <Badge variant="secondary" className={`ml-1 ${isBest ? 'bg-green-500 text-white' : ''}`}>
                    {count}
                  </Badge>
                  {isBest && <span className="text-green-500">🏆</span>}
                </Button>
              );
            })}
          </div>
          {bestDay.day >= 0 && (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-500" />
              <span>
                Melhor dia: <strong className="text-foreground">{daysOfWeek[bestDay.day].label}</strong> com{' '}
                <strong className="text-green-500">{bestDay.count}</strong> leads (
                {((bestDay.count / leads.length) * 100).toFixed(1)}%)
              </span>
            </div>
          )}
          {dayOfWeekFilter !== null && (
            <div className="mt-2 text-sm flex items-center gap-2">
              <Filter className="h-4 w-4 text-primary" />
              <span>
                Filtrando por <strong>{daysOfWeek[dayOfWeekFilter].label}</strong>:{' '}
                <strong className="text-primary">{filteredLeads.length}</strong> leads
              </span>
              <Button variant="ghost" size="sm" onClick={() => setDayOfWeekFilter(null)} className="h-6 px-2">
                <X className="h-3 w-3" />
                Limpar
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="leads" className="gap-2">
            <Users className="h-4 w-4" />
            Leads
          </TabsTrigger>
          <TabsTrigger value="followups" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Análise Follow-ups
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="h-4 w-4" />
            Configurações
          </TabsTrigger>
        </TabsList>

        <TabsContent value="leads" className="mt-4">
          {/* Leads Section */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Leads do WhatsApp
                  </CardTitle>
                  <CardDescription>
                    Registre e acompanhe seus leads para calcular o custo real por conversão
                  </CardDescription>
                </div>
            <div className="flex items-center gap-2">
              {/* View Toggle */}
              <div className="flex items-center border rounded-lg p-1">
                <Button
                  variant={viewMode === 'pipeline' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('pipeline')}
                  className="gap-1"
                >
                  <LayoutGrid className="h-4 w-4" />
                  Pipeline
                </Button>
                <Button
                  variant={viewMode === 'table' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('table')}
                  className="gap-1"
                >
                  <TableIcon className="h-4 w-4" />
                  Tabela
                </Button>
              </div>

              {/* Stagnation Settings */}
              <StagnationSettings
                thresholds={thresholds}
                enabledStatuses={enabledStatuses}
                onUpdateThreshold={updateThreshold}
                onToggleStatus={toggleStatusAlert}
                onReset={resetStagnationDefaults}
                stagnantCount={stagnantCount}
              />

              {/* Facebook Import */}
              <Button
                variant="outline"
                onClick={handleImportFacebookLeads}
                disabled={isImporting}
                className="gap-2"
              >
                {isImporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Facebook className="h-4 w-4" />
                )}
                {isImporting ? 'Importando...' : 'Importar do Facebook'}
              </Button>

              {/* CSV Import */}
              <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                ref={fileInputRef}
                className="hidden"
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="gap-2"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Importar CSV
              </Button>
              
              <Button onClick={() => setIsAddDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Adicionar Lead
              </Button>
              
              <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                <DialogContent className="max-h-[85vh] flex flex-col">
                  <DialogHeader className="flex-shrink-0">
                    <DialogTitle>Adicionar Novo Lead</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 flex-1 overflow-y-auto pr-2">
                    <div>
                      <Label>Nome</Label>
                      <Input
                        placeholder="Nome do lead"
                        value={newLead.lead_name}
                        onChange={(e) => setNewLead({ ...newLead, lead_name: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Telefone (WhatsApp)</Label>
                      <Input
                        placeholder="(11) 99999-9999"
                        value={newLead.lead_phone}
                        onChange={(e) => setNewLead({ ...newLead, lead_phone: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Email (opcional)</Label>
                      <Input
                        type="email"
                        placeholder="email@exemplo.com"
                        value={newLead.lead_email}
                        onChange={(e) => setNewLead({ ...newLead, lead_email: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Campanha</Label>
                      <Select
                        value={newLead.campaign_id}
                        onValueChange={(value) => {
                          const campaign = campaigns.find(c => c.id === value);
                          setNewLead({ 
                            ...newLead, 
                            campaign_id: value,
                            campaign_name: campaign?.name || ''
                          });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione a campanha" />
                        </SelectTrigger>
                        <SelectContent>
                          {campaigns.map((campaign) => (
                            <SelectItem key={campaign.id} value={campaign.id}>
                              {campaign.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Nome do Anúncio</Label>
                      <Input
                        placeholder="Ex: Campanha Verão 2024 - Carrossel"
                        value={newLead.ad_name}
                        onChange={(e) => setNewLead({ ...newLead, ad_name: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Data de Início do Anúncio</Label>
                      <Input
                        type="date"
                        value={newLead.ad_start_date}
                        onChange={(e) => setNewLead({ ...newLead, ad_start_date: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Quando o anúncio começou a rodar
                      </p>
                    </div>
                    <div>
                      <Label>Gasto em Ads (estimado)</Label>
                      <Input
                        type="number"
                        placeholder="0.00"
                        value={newLead.ad_spend_at_conversion}
                        onChange={(e) => setNewLead({ ...newLead, ad_spend_at_conversion: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                    <div>
                      <Label>Código de Teste (Facebook Events Manager)</Label>
                      <Input
                        placeholder="TEST12345"
                        value={testEventCode}
                        onChange={(e) => setTestEventCode(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Encontre em Events Manager → Test Events → Código de Teste
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <Label>Estado</Label>
                        <Select
                          value={newLead.state}
                          onValueChange={(value) => {
                            setNewLead({ ...newLead, state: value, city: '' });
                            fetchCities(value);
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="UF" />
                          </SelectTrigger>
                          <SelectContent className="bg-background border z-50 max-h-60">
                            {states.map((state) => (
                              <SelectItem key={state.sigla} value={state.sigla}>
                                {state.sigla} - {state.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Cidade</Label>
                        <Select
                          value={newLead.city}
                          onValueChange={(value) => setNewLead({ ...newLead, city: value })}
                          disabled={!newLead.state || loadingCities}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={loadingCities ? 'Carregando...' : 'Cidade'} />
                          </SelectTrigger>
                          <SelectContent className="bg-background border z-50 max-h-60">
                            {cities.map((city) => (
                              <SelectItem key={city.id} value={city.nome}>
                                {city.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Bairro</Label>
                        <Input
                          placeholder="Bairro"
                          value={newLead.neighborhood}
                          onChange={(e) => setNewLead({ ...newLead, neighborhood: e.target.value })}
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Observações</Label>
                      <Textarea
                        placeholder="Notas sobre o lead..."
                        value={newLead.notes}
                        onChange={(e) => setNewLead({ ...newLead, notes: e.target.value })}
                      />
                    </div>
                  </div>
                  <DialogFooter className="flex-shrink-0 pt-4 border-t">
                    <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                      Cancelar
                    </Button>
                    <Button onClick={handleAddLead}>
                      Adicionar
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* CSV Import Preview Dialog */}
              <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
                <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <FileSpreadsheet className="h-5 w-5" />
                      Importar Leads do CSV
                    </DialogTitle>
                  </DialogHeader>
                  <div className="flex-1 overflow-auto">
                    <p className="text-sm text-muted-foreground mb-4">
                      {csvPreview.length} leads encontrados. Confira os dados antes de importar:
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Nome</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Telefone</TableHead>
                          <TableHead>Campanha</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {csvPreview.slice(0, 10).map((lead, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{lead.lead_name || '—'}</TableCell>
                            <TableCell>{lead.lead_email || '—'}</TableCell>
                            <TableCell>{lead.lead_phone || '—'}</TableCell>
                            <TableCell>{lead.campaign_name || '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {csvPreview.length > 10 && (
                      <p className="text-xs text-muted-foreground mt-2 text-center">
                        ...e mais {csvPreview.length - 10} leads
                      </p>
                    )}
                  </div>
                  <DialogFooter className="mt-4">
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        setIsImportDialogOpen(false);
                        setCsvPreview([]);
                      }}
                    >
                      Cancelar
                    </Button>
                    <Button onClick={handleImportCSV} disabled={isImporting}>
                      {isImporting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Importando...
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4 mr-2" />
                          Importar {csvPreview.length} leads
                        </>
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Stagnant Leads Alert */}
          {stagnantCount > 0 && (
            <div className="mb-4">
              <StagnantLeadsList
                stagnantLeads={stagnantLeads}
                stagnantByStatus={stagnantByStatus}
                onOpenLead={(lead) => setEditingLead(lead)}
              />
            </div>
          )}

          {viewMode === 'pipeline' ? (
            <LeadsPipeline
              leads={filteredLeads}
              loading={loading}
              onStatusChange={handleStatusChange}
              onDeleteLead={handleDeleteLead}
              onEditLead={(lead) => setEditingLead(lead)}
              onToggleFollower={toggleFollower}
              onClassificationChange={updateClientClassification}
              cardFieldsConfig={cardFieldsConfig}
              onLeadsRefresh={fetchLeads}
              isLeadStagnant={isLeadStagnant}
            />
          ) : (
            <>
              {loading ? (
                <div className="text-center py-8 text-muted-foreground">Carregando leads...</div>
              ) : filteredLeads.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">
                    {dayOfWeekFilter !== null ? 'Nenhum lead encontrado para este dia da semana' : 'Nenhum lead registrado ainda'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {dayOfWeekFilter !== null ? 'Tente remover o filtro para ver todos os leads' : 'Adicione leads do WhatsApp para calcular seu custo real por conversão'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Lead</TableHead>
                        <TableHead>Contato</TableHead>
                        <TableHead>Campanha / Anúncio</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Valor</TableHead>
                        <TableHead>Data / Horário</TableHead>
                        <TableHead>Dia da Semana</TableHead>
                        <TableHead>Anúncio Ativo</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLeads.map((lead) => (
                        <TableRow key={lead.id}>
                          <TableCell>
                            <div className="font-medium">{lead.lead_name || 'Sem nome'}</div>
                            {lead.notes && (
                              <div className="text-xs text-muted-foreground truncate max-w-[150px]">
                                {lead.notes}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              {lead.lead_phone && (
                                <div className="flex items-center gap-1 text-xs">
                                  <Phone className="h-3 w-3" />
                                  {lead.lead_phone}
                                </div>
                              )}
                              {lead.lead_email && (
                                <div className="flex items-center gap-1 text-xs">
                                  <Mail className="h-3 w-3" />
                                  {lead.lead_email}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <span className="text-xs">{lead.campaign_name || '—'}</span>
                              {lead.ad_name && (
                                <div className="text-xs text-muted-foreground">
                                  📢 {lead.ad_name}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Select
                              value={lead.status}
                              onValueChange={(value) => handleStatusChange(lead.id, value as LeadStatus)}
                            >
                              <SelectTrigger className="h-8 w-[140px]">
                                <SelectValue>
                                  <Badge className={`${statusConfig[lead.status].color} text-white`}>
                                    <span className="flex items-center gap-1">
                                      {statusConfig[lead.status].icon}
                                      {statusConfig[lead.status].label}
                                    </span>
                                  </Badge>
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(statusConfig).map(([key, config]) => (
                                  <SelectItem key={key} value={key}>
                                    <span className="flex items-center gap-2">
                                      {config.icon}
                                      {config.label}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            {lead.status === 'converted' && (lead.conversion_value ?? 0) > 0 ? (
                              <span className="text-green-500 font-medium">
                                R$ {(lead.conversion_value ?? 0).toLocaleString('pt-BR')}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="space-y-1">
                                    <div className="text-xs font-medium">
                                      {format(new Date(lead.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                                    </div>
                                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                                      <Clock className="h-3 w-3" />
                                      {format(new Date(lead.created_at), 'HH:mm', { locale: ptBR })}
                                    </div>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Lead chegou em {format(new Date(lead.created_at), "dd 'de' MMMM 'às' HH:mm", { locale: ptBR })}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {format(new Date(lead.created_at), 'EEEE', { locale: ptBR })}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {lead.ad_start_date ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="space-y-1">
                                      <div className="text-xs flex items-center gap-1">
                                        <PlayCircle className="h-3 w-3 text-green-500" />
                                        {format(new Date(lead.ad_start_date), 'dd/MM/yyyy', { locale: ptBR })}
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        {differenceInDays(new Date(lead.created_at), new Date(lead.ad_start_date))} dias ativo
                                      </div>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>Anúncio iniciou em {format(new Date(lead.ad_start_date), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteLead(lead.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="followups" className="mt-4">
          <FollowupAnalytics />
        </TabsContent>

        <TabsContent value="settings" className="mt-4 space-y-6">
          <CardFieldsSettings 
            config={cardFieldsConfig} 
            onUpdateField={updateCardField} 
            onReset={resetCardFields} 
          />
          <CustomFieldsManager adAccountId={adAccountId} />
        </TabsContent>
      </Tabs>
      <Dialog open={!!editingLead} onOpenChange={(open) => !open && setEditingLead(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Lead</DialogTitle>
          </DialogHeader>
          {editingLead && (
            <div className="space-y-4">
              <div>
                <Label>Nome</Label>
                <Input
                  placeholder="Nome do lead"
                  value={editingLead.lead_name || ''}
                  onChange={(e) => setEditingLead({ ...editingLead, lead_name: e.target.value })}
                />
              </div>
              <div>
                <Label>Telefone (WhatsApp)</Label>
                <Input
                  placeholder="(11) 99999-9999"
                  value={editingLead.lead_phone || ''}
                  onChange={(e) => setEditingLead({ ...editingLead, lead_phone: e.target.value })}
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  placeholder="email@exemplo.com"
                  value={editingLead.lead_email || ''}
                  onChange={(e) => setEditingLead({ ...editingLead, lead_email: e.target.value })}
                />
              </div>
              <div>
                <Label>Campanha</Label>
                <Input
                  placeholder="Nome da campanha"
                  value={editingLead.campaign_name || ''}
                  onChange={(e) => setEditingLead({ ...editingLead, campaign_name: e.target.value })}
                />
              </div>
              <div>
                <Label>Anúncio</Label>
                <Input
                  placeholder="Nome do anúncio"
                  value={editingLead.ad_name || ''}
                  onChange={(e) => setEditingLead({ ...editingLead, ad_name: e.target.value })}
                />
              </div>
              <div>
                <Label>Data da Classificação</Label>
                <Input
                  type="date"
                  value={editingLead.classification_date || format(new Date(), 'yyyy-MM-dd')}
                  onChange={(e) => setEditingLead({ ...editingLead, classification_date: e.target.value })}
                />
              </div>
              <div>
                <Label>Data que Virou Cliente</Label>
                <Input
                  type="date"
                  value={editingLead.became_client_date || ''}
                  onChange={(e) => setEditingLead({ ...editingLead, became_client_date: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label>Estado</Label>
                  <Select
                    value={editingLead.state || ''}
                    onValueChange={(value) => {
                      setEditingLead({ ...editingLead, state: value, city: '' });
                      fetchCities(value);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o estado" />
                    </SelectTrigger>
                    <SelectContent className="bg-background border z-50 max-h-60">
                      {states.map((state) => (
                        <SelectItem key={state.sigla} value={state.sigla}>
                          {state.sigla} - {state.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Cidade</Label>
                  <Select
                    value={editingLead.city || ''}
                    onValueChange={(value) => setEditingLead({ ...editingLead, city: value })}
                    disabled={!editingLead.state || loadingCities}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={loadingCities ? 'Carregando...' : 'Selecione a cidade'} />
                    </SelectTrigger>
                    <SelectContent className="bg-background border z-50 max-h-60">
                      {cities.map((city) => (
                        <SelectItem key={city.id} value={city.nome}>
                          {city.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Bairro</Label>
                  <Input
                    placeholder="Bairro"
                    value={editingLead.neighborhood || ''}
                    onChange={(e) => setEditingLead({ ...editingLead, neighborhood: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label>Observações</Label>
                <Textarea
                  placeholder="Anotações sobre o lead..."
                  value={editingLead.notes || ''}
                  onChange={(e) => setEditingLead({ ...editingLead, notes: e.target.value })}
                />
              </div>

              {/* Custom Fields */}
              {customFields.length > 0 && (
                <CustomFieldsForm
                  customFields={customFields}
                  leadId={editingLead.id}
                  getFieldValues={getFieldValues}
                  onValuesChange={setCustomFieldValues}
                />
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => { setEditingLead(null); setCustomFieldValues({}); }}>
                  Cancelar
                </Button>
                <Button onClick={handleEditLead}>
                  Salvar Alterações
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LeadManager;
