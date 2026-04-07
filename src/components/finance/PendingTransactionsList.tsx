import { useState, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AccidentLeadForm, AccidentLeadFormData } from '@/components/leads/AccidentLeadForm';
import { useProfilesList } from '@/hooks/useProfilesList';
import { useCompanies } from '@/hooks/useCompanies';
import { useCostCenters } from '@/hooks/useCostCenters';
import { useBeneficiaries } from '@/hooks/useBeneficiaries';
import { AccidentDataExtractor, ExtractedAccidentData } from '@/components/leads/AccidentDataExtractor';
import { generateLeadName } from '@/utils/generateLeadName';
import { 
  CreditCard, 
  MapPin,
  Calendar,
  Tag,
  CheckCircle2,
  X,
  Edit2,
  Save,
  ChevronDown,
  ChevronUp,
  User,
  Users,
  Clock,
  Building2,
  Link2,
  Plus,
  Eye,
  MessageCircle,
  Loader2
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { buildExpenseFormUrl } from '@/utils/publicAppUrl';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useExpenseCategories, ExpenseCategory } from '@/hooks/useExpenseCategories';
import { useBrazilianLocations } from '@/hooks/useBrazilianLocations';
import { useGeolocation } from '@/hooks/useGeolocation';
import { translateCategory } from '@/utils/categoryTranslations';
import { toast } from 'sonner';
import { CategorySelector } from '@/components/finance/CategorySelector';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface Transaction {
  id: string;
  pluggy_account_id: string;
  pluggy_transaction_id: string;
  description: string | null;
  amount: number;
  currency_code: string | null;
  transaction_date: string;
  transaction_time: string | null;
  category: string | null;
  payment_data: Record<string, any>;
  card_last_digits: string | null;
  merchant_name: string | null;
  merchant_cnpj: string | null;
  merchant_city: string | null;
  merchant_state: string | null;
  created_at: string;
}

interface Lead {
  id: string;
  lead_name: string | null;
  city: string | null;
  state: string | null;
}

interface Contact {
  id: string;
  full_name: string;
  city: string | null;
  state: string | null;
}

interface PendingTransactionsListProps {
  transactions: Transaction[];
  leads: Lead[];
  contacts: Contact[];
  onComplete?: () => void;
}

export function PendingTransactionsList({ 
  transactions, 
  leads, 
  contacts,
  onComplete 
}: PendingTransactionsListProps) {
  const { user } = useAuth();
  const { 
    categories, 
    overrides,
    setTransactionOverride,
    getTransactionOverride,
    getCategoryById,
    getCardAssignment
  } = useExpenseCategories();
  
  const { states, cities, loadingCities, fetchCities } = useBrazilianLocations();
  const { fetchLocation, loading: geoLoading } = useGeolocation();
  const teamProfiles = useProfilesList();
  const { activeCompanies } = useCompanies();
  const { activeCostCenters, getByCompany } = useCostCenters();
  const { activeBeneficiaries, addBeneficiary: addNewBeneficiary } = useBeneficiaries();
  
  const NONE_SELECTED = 'NONE';
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [generatingLink, setGeneratingLink] = useState(false);
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);
  const [editData, setEditData] = useState<{
    categoryId: string | null;
    linkType: 'lead' | 'contact';
    linkId: string | null;
    notes: string;
    manualState: string;
    manualCity: string;
    companyId: string;
    costCenterId: string;
    nature: string;
    recurrence: string;
    beneficiaryId: string;
    paymentMethod: string;
    invoiceNumber: string;
  }>({
    categoryId: null,
    linkType: 'lead',
    linkId: null,
    notes: '',
    manualState: '',
    manualCity: '',
    companyId: '',
    costCenterId: '',
    nature: '',
    recurrence: '',
    beneficiaryId: '',
    paymentMethod: '',
    invoiceNumber: '',
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Sheet state for create/edit/view lead or contact
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<'create' | 'edit' | 'view'>('create');
  const [sheetType, setSheetType] = useState<'lead' | 'contact'>('lead');
  const [extractorOpen, setExtractorOpen] = useState(false);

  const defaultLeadFormData: AccidentLeadFormData = {
    lead_name: '', lead_phone: '', lead_email: '', source: 'manual', notes: '',
    acolhedor: '', case_type: '', group_link: '',
    client_classification: '', expected_birth_date: '',
    visit_city: '', visit_state: '', visit_region: '', visit_address: '',
    accident_date: '', damage_description: '', victim_name: '', victim_age: '',
    accident_address: '', contractor_company: '', main_company: '', sector: '',
    news_link: '', company_size_justification: '', liability_type: '', legal_viability: '',
  };
  const [leadFormData, setLeadFormData] = useState<AccidentLeadFormData>({ ...defaultLeadFormData });
  const [leadSheetId, setLeadSheetId] = useState('');

  // Contact sheet data
  const [contactSheetData, setContactSheetData] = useState({ id: '', name: '', phone: '', email: '', city: '', state: '', notes: '', instagram: '' });
  
  const [savingSheet, setSavingSheet] = useState(false);

  // Local copies of leads/contacts to append newly created ones
  const [localLeads, setLocalLeads] = useState<Lead[]>(leads);
  const [localContacts, setLocalContacts] = useState<Contact[]>(contacts);
  
  // Keep in sync with props
  useMemo(() => { setLocalLeads(leads); }, [leads]);
  useMemo(() => { setLocalContacts(contacts); }, [contacts]);

  const openCreateSheet = (type: 'lead' | 'contact') => {
    setSheetType(type);
    setSheetMode('create');
    if (type === 'lead') {
      setLeadFormData({ ...defaultLeadFormData });
      setLeadSheetId('');
    } else {
      setContactSheetData({ id: '', name: '', phone: '', email: '', city: '', state: '', notes: '', instagram: '' });
    }
    setSheetOpen(true);
  };

  const openViewSheet = async (type: 'lead' | 'contact', id: string) => {
    setSheetType(type);
    setSheetMode('view');
    
    if (type === 'lead') {
      const { data } = await supabase.from('leads').select('*').eq('id', id).single();
      if (data) {
        setLeadSheetId(data.id);
        setLeadFormData({
          lead_name: data.lead_name || '', lead_phone: data.lead_phone || '', lead_email: data.lead_email || '',
          source: data.source || 'manual', notes: data.notes || '', acolhedor: data.acolhedor || '',
          case_type: data.case_type || '', group_link: data.group_link || '',
          client_classification: data.client_classification || '', expected_birth_date: data.expected_birth_date || '',
          visit_city: data.visit_city || '', visit_state: data.visit_state || '', visit_region: data.visit_region || '', visit_address: data.visit_address || '',
          accident_date: data.accident_date || '', damage_description: data.damage_description || '',
          victim_name: data.victim_name || '', victim_age: data.victim_age ? String(data.victim_age) : '',
          accident_address: data.accident_address || '', contractor_company: data.contractor_company || '',
          main_company: data.main_company || '', sector: data.sector || '',
          news_link: data.news_link || '', company_size_justification: data.company_size_justification || '',
          liability_type: data.liability_type || '', legal_viability: data.legal_viability || '',
        });
      }
    } else {
      const { data } = await supabase.from('contacts').select('*').eq('id', id).single();
      if (data) setContactSheetData({ id: data.id, name: data.full_name, phone: data.phone || '', email: data.email || '', city: data.city || '', state: data.state || '', notes: data.notes || '', instagram: data.instagram_username || '' });
    }
    setSheetOpen(true);
  };

  const openEditSheet = () => {
    setSheetMode('edit');
  };

  const handleExtractedData = (extracted: ExtractedAccidentData) => {
    const updates: Partial<AccidentLeadFormData> = {};
    if (extracted.victim_name) updates.victim_name = extracted.victim_name;
    if (extracted.victim_age) updates.victim_age = String(extracted.victim_age);
    if (extracted.accident_date) updates.accident_date = extracted.accident_date;
    if (extracted.accident_address) updates.accident_address = extracted.accident_address;
    if (extracted.damage_description) updates.damage_description = extracted.damage_description;
    if (extracted.contractor_company) updates.contractor_company = extracted.contractor_company;
    if (extracted.main_company) updates.main_company = extracted.main_company;
    if (extracted.sector) updates.sector = extracted.sector;
    if (extracted.case_type) updates.case_type = extracted.case_type;
    if (extracted.liability_type) updates.liability_type = extracted.liability_type;
    if (extracted.legal_viability) updates.legal_viability = extracted.legal_viability;
    if (extracted.visit_city) updates.visit_city = extracted.visit_city;
    if (extracted.visit_state) updates.visit_state = extracted.visit_state;

    setLeadFormData(prev => {
      const updated = { ...prev, ...updates };
      // Auto-generate lead name
      const autoName = generateLeadName({
        city: updated.visit_city, state: updated.visit_state,
        victim_name: updated.victim_name, main_company: updated.main_company,
        contractor_company: updated.contractor_company, accident_date: updated.accident_date,
        damage_description: updated.damage_description, case_type: updated.case_type,
      });
      if (autoName) updated.lead_name = autoName;
      return updated;
    });
  };

  const saveSheetEntity = async () => {
    setSavingSheet(true);
    try {
      if (sheetType === 'lead') {
        if (!leadFormData.lead_name.trim()) {
          toast.error('Nome é obrigatório');
          setSavingSheet(false);
          return;
        }
        const payload: any = {
          lead_name: leadFormData.lead_name.trim(),
          lead_phone: leadFormData.lead_phone || null,
          lead_email: leadFormData.lead_email || null,
          source: leadFormData.source || null,
          notes: leadFormData.notes || null,
          acolhedor: leadFormData.acolhedor || null,
          case_type: leadFormData.case_type || null,
          group_link: leadFormData.group_link || null,
          visit_city: leadFormData.visit_city || null,
          visit_state: leadFormData.visit_state || null,
          visit_region: leadFormData.visit_region || null,
          visit_address: leadFormData.visit_address || null,
          accident_date: leadFormData.accident_date || null,
          damage_description: leadFormData.damage_description || null,
          victim_name: leadFormData.victim_name || null,
          victim_age: leadFormData.victim_age ? parseInt(leadFormData.victim_age) : null,
          accident_address: leadFormData.accident_address || null,
          contractor_company: leadFormData.contractor_company || null,
          main_company: leadFormData.main_company || null,
          sector: leadFormData.sector || null,
          news_link: leadFormData.news_link || null,
          company_size_justification: leadFormData.company_size_justification || null,
          liability_type: leadFormData.liability_type || null,
          legal_viability: leadFormData.legal_viability || null,
          city: leadFormData.visit_city || null,
          state: leadFormData.visit_state || null,
        };
        if (sheetMode === 'create') {
          const { data, error } = await supabase.from('leads').insert({
            ...payload,
            created_by: user?.id || null,
            updated_by: user?.id || null,
          }).select('id, lead_name, city, state').single();
          if (error) throw error;
          setLocalLeads(prev => [...prev, data]);
          setEditData(prev => ({ ...prev, linkType: 'lead', linkId: data.id }));
          toast.success('Lead criado!');
        } else {
          const { error } = await supabase.from('leads').update(payload).eq('id', leadSheetId);
          if (error) throw error;
          setLocalLeads(prev => prev.map(l => l.id === leadSheetId ? { ...l, lead_name: leadFormData.lead_name, city: leadFormData.visit_city, state: leadFormData.visit_state } : l));
          toast.success('Lead atualizado!');
        }
      } else {
        if (!contactSheetData.name.trim()) {
          toast.error('Nome é obrigatório');
          setSavingSheet(false);
          return;
        }
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        const payload = {
          full_name: contactSheetData.name.trim(),
          phone: contactSheetData.phone || null,
          email: contactSheetData.email || null,
          city: contactSheetData.city || null,
          state: contactSheetData.state || null,
          instagram_username: contactSheetData.instagram || null,
          notes: contactSheetData.notes || null,
          created_by: currentUser?.id || null,
        };
        if (sheetMode === 'create') {
          const { data, error } = await supabase.from('contacts').insert(payload).select('id, full_name, city, state').single();
          if (error) throw error;
          setLocalContacts(prev => [...prev, data]);
          setEditData(prev => ({ ...prev, linkType: 'contact', linkId: data.id }));
          toast.success('Contato criado!');
        } else {
          const { error } = await supabase.from('contacts').update(payload).eq('id', contactSheetData.id);
          if (error) throw error;
          setLocalContacts(prev => prev.map(c => c.id === contactSheetData.id ? { ...c, full_name: contactSheetData.name, city: contactSheetData.city, state: contactSheetData.state } : c));
          toast.success('Contato atualizado!');
        }
      }
      setSheetOpen(false);
    } catch (err: any) {
      toast.error('Erro: ' + err.message);
    } finally {
      setSavingSheet(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === transactions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(transactions.map(t => t.id)));
    }
  };

  const generateLinkForSelected = async () => {
    if (selectedIds.size === 0 || !user) return;
    setGeneratingLink(true);
    try {
      const selectedTxs = transactions.filter(t => selectedIds.has(t.id));
      const cards = [...new Set(selectedTxs.map(t => t.card_last_digits))];
      const card = cards.length === 1 ? cards[0] : cards.join(',');
      if (!card) throw new Error('Cartão não identificado');

      const dates = selectedTxs.map(t => t.transaction_date).sort();
      const insertData: any = {
        card_last_digits: card,
        date_from: dates[0],
        date_to: dates[dates.length - 1],
        created_by: user.id,
        transaction_ids: selectedTxs.map(t => t.pluggy_transaction_id),
      };

      const { data, error } = await supabase
        .from('expense_form_tokens')
        .insert(insertData)
        .select('token')
        .single();

      if (error) throw error;

      const link = buildExpenseFormUrl(data.token);
      
      await navigator.clipboard.writeText(link);
      toast.success('Link do formulário copiado!');
      setSelectedIds(new Set());
    } catch (err: any) {
      toast.error('Erro ao gerar link: ' + err.message);
    } finally {
      setGeneratingLink(false);
    }
  };

  const sendWhatsAppNotification = async () => {
    if (selectedIds.size === 0 || !user) return;
    setSendingWhatsApp(true);
    try {
      const selectedTxs = transactions.filter(t => selectedIds.has(t.id));
      const txsByCard: Record<string, typeof selectedTxs> = {};
      selectedTxs.forEach(t => {
        const card = t.card_last_digits || 'unknown';
        if (!txsByCard[card]) txsByCard[card] = [];
        txsByCard[card].push(t);
      });
      let sentCount = 0;
      for (const [cardDigits, cardTxs] of Object.entries(txsByCard)) {
        const assignment = getCardAssignment(cardDigits);
        if (!assignment?.contact_id) {
          toast.error(`Cartão ****${cardDigits} não tem contato responsável vinculado`);
          continue;
        }
        const { data: contact } = await supabase
          .from('contacts')
          .select('phone, full_name')
          .eq('id', assignment.contact_id)
          .single();
        if (!contact?.phone) {
          toast.error(`Contato ${contact?.full_name || 'desconhecido'} não tem telefone cadastrado`);
          continue;
        }
        const dates = cardTxs.map(t => t.transaction_date).sort();
        const { data: tokenData, error: tokenError } = await supabase
          .from('expense_form_tokens')
          .insert({
            card_last_digits: cardDigits,
            date_from: dates[0],
            date_to: dates[dates.length - 1],
            created_by: user.id,
            transaction_ids: cardTxs.map(t => t.pluggy_transaction_id),
            contact_phone: contact.phone,
            contact_name: contact.full_name,
            reminder_count: 1,
            last_reminder_at: new Date().toISOString(),
          } as any)
          .select('token')
          .single();
        if (tokenError) throw tokenError;
        const link = buildExpenseFormUrl(tokenData.token);
        const totalAmount = cardTxs.reduce((sum, t) => sum + Math.abs(t.amount), 0);
        const formattedTotal = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalAmount);
        const txSummary = cardTxs.slice(0, 5).map(t => {
          const amt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Math.abs(t.amount));
          const desc = t.merchant_name || t.description || 'Sem descrição';
          const dt = format(new Date(t.transaction_date + 'T12:00:00'), 'dd/MM');
          return `• ${dt} - ${desc}: ${amt}`;
        }).join('\n');
        const moreText = cardTxs.length > 5 ? `\n... e mais ${cardTxs.length - 5} transações` : '';
        const message = `📋 *Despesas pendentes de classificação*\n\nCartão: *${assignment.card_name || `****${cardDigits}`}*\nTotal: *${formattedTotal}* (${cardTxs.length} transações)\n\n${txSummary}${moreText}\n\nPor favor, cadastre o lead e a categoria de cada despesa no link abaixo:\n\n👉 ${link}`;
        const { error: sendError } = await cloudFunctions.invoke('send-whatsapp', {
          body: { phone: contact.phone, message, contact_id: assignment.contact_id, lead_id: assignment.lead_id },
        });
        if (sendError) {
          toast.error(`Erro ao enviar para ${contact.full_name}: ${sendError.message}`);
        } else {
          sentCount++;
        }
      }
      if (sentCount > 0) {
        toast.success(`WhatsApp enviado para ${sentCount} responsável(is)!`);
        setSelectedIds(new Set());
      }
    } catch (err: any) {
      toast.error('Erro ao enviar WhatsApp: ' + err.message);
    } finally {
      setSendingWhatsApp(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const startEditing = (transaction: Transaction) => {
    const override = getTransactionOverride(transaction.id);
    const cardAssignment = getCardAssignment(transaction.card_last_digits || '');
    
    let linkType: 'lead' | 'contact' = 'lead';
    let linkId: string | null = null;
    
    if (override?.lead_id) {
      linkType = 'lead';
      linkId = override.lead_id;
    } else if (override?.contact_id) {
      linkType = 'contact';
      linkId = override.contact_id;
    } else if (cardAssignment?.lead_id) {
      linkType = 'lead';
      linkId = cardAssignment.lead_id;
    } else if (cardAssignment?.contact_id) {
      linkType = 'contact';
      linkId = cardAssignment.contact_id;
    }
    
    setEditingId(transaction.id);
    setEditData({
      categoryId: override?.category_id || null,
      linkType,
      linkId,
      notes: override?.notes || '',
      manualState: override?.manual_state || transaction.merchant_state || '',
      manualCity: override?.manual_city || transaction.merchant_city || '',
      companyId: override?.company_id || '',
      costCenterId: override?.cost_center_id || '',
      nature: override?.nature || '',
      recurrence: override?.recurrence || '',
      beneficiaryId: override?.beneficiary_id || '',
      paymentMethod: override?.payment_method || '',
      invoiceNumber: override?.invoice_number || '',
    });
    
    if (override?.manual_state || transaction.merchant_state) {
      fetchCities(override?.manual_state || transaction.merchant_state || '');
    }

    // Auto-detect geolocation if no state/city is set
    const hasState = override?.manual_state || transaction.merchant_state;
    const hasCity = override?.manual_city || transaction.merchant_city;
    if (!hasState && !hasCity) {
      fetchLocation().then((loc) => {
        if (loc) {
          setEditData(prev => ({ ...prev, manualState: loc.state, manualCity: loc.city }));
          fetchCities(loc.state);
          toast.success('Localização detectada automaticamente!');
        }
      });
    }
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditData({
      categoryId: null,
      linkType: 'lead',
      linkId: null,
      notes: '',
      manualState: '',
      manualCity: '',
      companyId: '',
      costCenterId: '',
      nature: '',
      recurrence: '',
      beneficiaryId: '',
      paymentMethod: '',
      invoiceNumber: '',
    });
  };

  const saveTransaction = async (transactionId: string) => {
    if (!editData.categoryId) {
      toast.error('Selecione uma categoria');
      return;
    }
    
    // Validate that user selected something (even "NONE" is valid)
    if (!editData.linkId) {
      toast.error(`Selecione um ${editData.linkType === 'lead' ? 'Lead' : 'Contato'} ou "Nenhum Vinculado"`);
      return;
    }

    try {
      // Check if user explicitly chose "no link"
      const isNoneSelected = editData.linkId === NONE_SELECTED;
      const linkAcknowledged = isNoneSelected;
      
      await setTransactionOverride(
        transactionId,
        editData.categoryId,
        !isNoneSelected && editData.linkType === 'contact' ? editData.linkId : undefined,
        !isNoneSelected && editData.linkType === 'lead' ? editData.linkId : undefined,
        editData.notes || undefined,
        editData.manualCity || undefined,
        editData.manualState || undefined,
        linkAcknowledged,
        undefined,
        {
          company_id: editData.companyId || undefined,
          cost_center_id: editData.costCenterId || undefined,
          nature: editData.nature || undefined,
          recurrence: editData.recurrence || undefined,
          beneficiary_id: editData.beneficiaryId || undefined,
          payment_method: editData.paymentMethod || undefined,
          invoice_number: editData.invoiceNumber || undefined,
        }
      );
      
      setEditingId(null);
      toast.success('Transação categorizada com sucesso!');
      
      // Check if all done
      const remainingPending = transactions.filter(t => {
        const ov = getTransactionOverride(t.id);
        if (!ov) return true;
        if (ov.link_acknowledged) return false;
        return !ov.lead_id && !ov.contact_id;
      });
      
      if (remainingPending.length <= 1) {
        onComplete?.();
      }
    } catch (err) {
      console.error('Error saving:', err);
      toast.error('Erro ao salvar');
    }
  };

  const parentCategories = useMemo(() => 
    categories.filter(c => !c.parent_id),
    [categories]
  );

  return (
    <div className="flex flex-col">
      {/* Batch action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 mb-3 p-2 bg-muted rounded-lg">
          <Badge variant="secondary">{selectedIds.size} selecionada(s)</Badge>
          <Button 
            size="sm" 
            className="gap-1.5" 
            onClick={generateLinkForSelected}
            disabled={generatingLink}
          >
            {generatingLink ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            Gerar Link
          </Button>
          <Button 
            size="sm" 
            variant="secondary"
            className="gap-1.5"
            onClick={sendWhatsAppNotification}
            disabled={sendingWhatsApp}
          >
            {sendingWhatsApp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />}
            Notificar WhatsApp
          </Button>
          <Button 
            size="sm" 
            variant="outline"
            className="gap-1.5" 
            onClick={() => setSelectedIds(new Set())}
          >
            <X className="h-3.5 w-3.5" />
            Limpar
          </Button>
        </div>
      )}
      
      {/* Select all + per-holder selectors */}
      <div className="flex items-center gap-2 mb-2 px-1 flex-wrap">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={selectedIds.size === transactions.length && transactions.length > 0}
            onCheckedChange={toggleSelectAll}
          />
          <span className="text-xs text-muted-foreground">Selecionar todas</span>
        </div>
        {(() => {
          const holderMap = new Map<string, { name: string; txIds: string[] }>();
          transactions.forEach(tx => {
            const digits = tx.card_last_digits || '';
            if (!digits) return;
            if (!holderMap.has(digits)) {
              const assignment = getCardAssignment(digits);
              const name = assignment?.lead_name || assignment?.card_name || `****${digits}`;
              holderMap.set(digits, { name, txIds: [] });
            }
            holderMap.get(digits)!.txIds.push(tx.id);
          });
          if (holderMap.size === 0) return null;
          return Array.from(holderMap.entries()).map(([digits, { name, txIds }]) => {
            const allSelected = txIds.every(id => selectedIds.has(id));
            return (
              <button
                key={digits}
                type="button"
                onClick={() => {
                  setSelectedIds(prev => {
                    const next = new Set(prev);
                    if (allSelected) {
                      txIds.forEach(id => next.delete(id));
                    } else {
                      txIds.forEach(id => next.add(id));
                    }
                    return next;
                  });
                }}
                className={cn(
                  "flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors",
                  allSelected
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                )}
              >
                <User className="h-3 w-3" />
                {name}
              </button>
            );
          });
        })()}
      </div>

      <ScrollArea className="h-[calc(100vh-400px)]">
        <div className="space-y-2 pr-4">
          {transactions.map((transaction) => {
          const isEditing = editingId === transaction.id;
          const isExpanded = expandedId === transaction.id || isEditing;
          const override = getTransactionOverride(transaction.id);
          const isPending = !override || (!override.category_id && !override.lead_id && !override.contact_id && !override.link_acknowledged);
          const cardAssignment = getCardAssignment(transaction.card_last_digits || '');
          
          // Get linked entity name
          let linkedName = '';
          if (override?.lead_id) {
            const lead = localLeads.find(l => l.id === override.lead_id);
            linkedName = lead?.lead_name || '';
          } else if (override?.contact_id) {
            const contact = localContacts.find(c => c.id === override.contact_id);
            linkedName = contact?.full_name || '';
          }
          
          // Get category
          const category = override?.category_id ? getCategoryById(override.category_id) : null;

          return (
            <div
              key={transaction.id}
              className={cn(
                "border rounded-lg transition-all",
                isPending ? "border-amber-500/50 bg-amber-50/30 dark:bg-amber-950/10" : "bg-card",
                isEditing && "ring-2 ring-primary"
              )}
            >
              {/* Main Row */}
              <div 
                className="p-3 flex items-center gap-3 cursor-pointer hover:bg-muted/50"
                onClick={() => !isEditing && setExpandedId(isExpanded ? null : transaction.id)}
              >
                {/* Checkbox */}
                <Checkbox
                  checked={selectedIds.has(transaction.id)}
                  onCheckedChange={() => toggleSelect(transaction.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0"
                />
                
                {/* Expand Icon */}
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
                
                {/* Date & Time */}
                <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                  <span className="w-12">{format(new Date(transaction.transaction_date + 'T12:00:00'), "dd/MM", { locale: ptBR })}</span>
                  {transaction.transaction_time && (
                    <span className="flex items-center gap-0.5 text-muted-foreground/70">
                      <Clock className="h-3 w-3" />
                      {transaction.transaction_time.slice(0, 5)}
                    </span>
                  )}
                </div>
                
                {/* Description */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate text-sm">
                    {transaction.description || transaction.merchant_name || 'Transação'}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                    {transaction.card_last_digits && (
                      <span className="flex items-center gap-1">
                        <CreditCard className="h-3 w-3" />
                        {cardAssignment?.card_name || `****${transaction.card_last_digits}`}
                      </span>
                    )}
                    {transaction.merchant_cnpj && (
                      <span className="flex items-center gap-1 font-mono">
                        <Building2 className="h-3 w-3" />
                        {transaction.merchant_cnpj.length === 14 
                          ? transaction.merchant_cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
                          : transaction.merchant_cnpj}
                      </span>
                    )}
                    {(transaction.merchant_city || transaction.merchant_state) && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {[transaction.merchant_city, transaction.merchant_state].filter(Boolean).join('-')}
                      </span>
                    )}
                  </div>
                </div>
                
                {/* Category Badge */}
                {category && (
                  <Badge variant="outline" className="shrink-0 text-xs">
                    <div className={cn("w-2 h-2 rounded-full mr-1", category.color)} />
                    {category.name}
                  </Badge>
                )}
                
                {/* Linked Entity */}
                {linkedName && (
                  <Badge variant="secondary" className="shrink-0 text-xs">
                    {override?.lead_id ? <User className="h-3 w-3 mr-1" /> : <Users className="h-3 w-3 mr-1" />}
                    {linkedName}
                  </Badge>
                )}
                
                {/* Status */}
                {isPending ? (
                  <Badge variant="outline" className="shrink-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    Pendente
                  </Badge>
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                )}
                
                {/* Amount */}
                <span className={cn(
                  "font-bold text-sm w-24 text-right shrink-0",
                  transaction.amount < 0 ? "text-destructive" : "text-green-600"
                )}>
                  {formatCurrency(transaction.amount)}
                </span>
                
                {/* Edit Button */}
                {!isEditing && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      startEditing(transaction);
                    }}
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              
              {/* Expanded/Edit Row */}
              {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t space-y-3">
                  {isEditing ? (
                    <>
                      {/* Category Selection */}
                      <CategorySelector
                        categories={categories}
                        selectedCategoryId={editData.categoryId}
                        onSelect={(id) => setEditData(prev => ({ ...prev, categoryId: id }))}
                      />
                      
                      {/* Link Type & Selection */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs font-medium">Vincular a</label>
                          <Select
                            value={editData.linkType}
                            onValueChange={(v: 'lead' | 'contact') => 
                              setEditData(prev => ({ ...prev, linkType: v, linkId: null }))
                            }
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="lead">Lead</SelectItem>
                              <SelectItem value="contact">Contato</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-medium">
                              {editData.linkType === 'lead' ? 'Lead' : 'Contato'}
                            </label>
                            <div className="flex gap-1">
                              {editData.linkId && editData.linkId !== NONE_SELECTED && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5"
                                  onClick={(e) => { e.stopPropagation(); openViewSheet(editData.linkType, editData.linkId!); }}
                                  title="Visualizar"
                                >
                                  <Eye className="h-3 w-3" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5"
                                onClick={(e) => { e.stopPropagation(); openCreateSheet(editData.linkType); }}
                                title={`Criar ${editData.linkType === 'lead' ? 'Lead' : 'Contato'}`}
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                          <Select
                            value={editData.linkId || ''}
                            onValueChange={(v) => setEditData(prev => ({ ...prev, linkId: v }))}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Selecione..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE_SELECTED} className="text-amber-600 dark:text-amber-400 font-medium italic">
                                <div className="flex items-center gap-2">
                                  <X className="h-3 w-3" />
                                  Nenhum {editData.linkType === 'lead' ? 'Lead' : 'Contato'} Vinculado
                                </div>
                              </SelectItem>
                              {editData.linkType === 'lead' 
                                ? localLeads.map(lead => (
                                    <SelectItem key={lead.id} value={lead.id}>
                                      <div className="flex items-center gap-2">
                                        <span>{lead.lead_name || 'Sem nome'}</span>
                                        {(lead.city || lead.state) && (
                                          <span className="text-xs text-muted-foreground">
                                            ({[lead.city, lead.state].filter(Boolean).join('-')})
                                          </span>
                                        )}
                                      </div>
                                    </SelectItem>
                                  ))
                                : localContacts.map(contact => (
                                    <SelectItem key={contact.id} value={contact.id}>
                                      <div className="flex items-center gap-2">
                                        <span>{contact.full_name}</span>
                                        {(contact.city || contact.state) && (
                                          <span className="text-xs text-muted-foreground">
                                            ({[contact.city, contact.state].filter(Boolean).join('-')})
                                          </span>
                                        )}
                                      </div>
                                    </SelectItem>
                                  ))
                              }
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      
                      {/* Manual Location */}
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium">Localização</label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs gap-1"
                          disabled={geoLoading}
                          onClick={async () => {
                            try {
                              const loc = await fetchLocation();
                              if (loc) {
                                setEditData(prev => ({ ...prev, manualState: loc.state, manualCity: loc.city }));
                                fetchCities(loc.state);
                                toast.success('Localização detectada!');
                              } else {
                                toast.error('Não foi possível detectar a localização. Verifique se a permissão foi concedida.');
                              }
                            } catch (err) {
                              toast.error('Erro ao acessar localização. Tente abrir o app diretamente no navegador (não no preview).');
                            }
                          }}
                        >
                          <MapPin className="h-3 w-3" />
                          {geoLoading ? 'Detectando...' : 'Usar localização'}
                        </Button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium">Estado</label>
                          <Select
                            value={editData.manualState}
                            onValueChange={(v) => {
                              setEditData(prev => ({ ...prev, manualState: v, manualCity: '' }));
                              fetchCities(v);
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="UF" />
                            </SelectTrigger>
                            <SelectContent>
                              {states.map(state => (
                                <SelectItem key={state.sigla} value={state.sigla}>
                                  {state.sigla}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="col-span-2 space-y-1">
                          <label className="text-xs font-medium">Cidade</label>
                          <Select
                            value={editData.manualCity}
                            onValueChange={(v) => setEditData(prev => ({ ...prev, manualCity: v }))}
                            disabled={!editData.manualState || loadingCities}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder={loadingCities ? "Carregando..." : "Cidade"} />
                            </SelectTrigger>
                            <SelectContent>
                              {cities.map(city => (
                                <SelectItem key={city.id} value={city.nome}>
                                  {city.nome}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* === NEW FINANCIAL FIELDS === */}
                      {/* Company + Cost Center */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium">Empresa</label>
                          <Select value={editData.companyId} onValueChange={(v) => { setEditData(prev => ({ ...prev, companyId: v, costCenterId: '' })); }}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                            <SelectContent>
                              {activeCompanies.map(c => <SelectItem key={c.id} value={c.id}>{c.trading_name || c.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium">Setor / Centro de Custo</label>
                          <Select value={editData.costCenterId} onValueChange={(v) => setEditData(prev => ({ ...prev, costCenterId: v }))}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                            <SelectContent>
                              {(editData.companyId ? getByCompany(editData.companyId) : activeCostCenters).map(cc => (
                                <SelectItem key={cc.id} value={cc.id}>{cc.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Nature + Recurrence */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium">Natureza</label>
                          <Select value={editData.nature} onValueChange={(v) => setEditData(prev => ({ ...prev, nature: v }))}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="fixo">Fixo</SelectItem>
                              <SelectItem value="variavel">Variável</SelectItem>
                              <SelectItem value="semi_fixo">Semi-fixo</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium">Recorrência</label>
                          <Select value={editData.recurrence} onValueChange={(v) => setEditData(prev => ({ ...prev, recurrence: v }))}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="semanal">Semanal</SelectItem>
                              <SelectItem value="mensal">Mensal</SelectItem>
                              <SelectItem value="anual">Anual</SelectItem>
                              <SelectItem value="eventual">Eventual</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Beneficiary + Payment Method */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium">Beneficiário</label>
                          <Select value={editData.beneficiaryId} onValueChange={(v) => setEditData(prev => ({ ...prev, beneficiaryId: v }))}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                            <SelectContent>
                              {activeBeneficiaries.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium">Forma de Pagamento</label>
                          <Select value={editData.paymentMethod} onValueChange={(v) => setEditData(prev => ({ ...prev, paymentMethod: v }))}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pix">PIX</SelectItem>
                              <SelectItem value="boleto">Boleto</SelectItem>
                              <SelectItem value="cartao_credito">Cartão de Crédito</SelectItem>
                              <SelectItem value="cartao_debito">Cartão de Débito</SelectItem>
                              <SelectItem value="transferencia">Transferência</SelectItem>
                              <SelectItem value="dinheiro">Dinheiro</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Invoice + Notes */}
                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium">Nº NF</label>
                          <Input
                            value={editData.invoiceNumber}
                            onChange={(e) => setEditData(prev => ({ ...prev, invoiceNumber: e.target.value }))}
                            placeholder="Nº NF"
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="col-span-2 space-y-1">
                          <label className="text-xs font-medium">Descrição</label>
                          <Input
                            value={editData.notes}
                            onChange={(e) => setEditData(prev => ({ ...prev, notes: e.target.value }))}
                            placeholder="Descreva o que foi este gasto..."
                            className="h-8 text-xs"
                          />
                        </div>
                      </div>
                      
                      {/* Actions */}
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={cancelEditing}>
                          <X className="h-4 w-4 mr-1" />
                          Cancelar
                        </Button>
                        <Button size="sm" onClick={() => saveTransaction(transaction.id)}>
                          <Save className="h-4 w-4 mr-1" />
                          Salvar
                        </Button>
                      </div>
                    </>
                  ) : (
                    /* View Details */
                    <div className="text-sm space-y-2">
                      <div className="flex flex-wrap gap-4 text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          {format(new Date(transaction.transaction_date + 'T12:00:00'), "dd 'de' MMMM, yyyy", { locale: ptBR })}
                        </span>
                        {transaction.category && (
                          <span className="flex items-center gap-1">
                            <Tag className="h-4 w-4" />
                            {translateCategory(transaction.category)}
                          </span>
                        )}
                        {transaction.merchant_cnpj && (
                          <span className="font-mono text-xs">
                            CNPJ: {transaction.merchant_cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}
                          </span>
                        )}
                      </div>
                      
                      {!isPending && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => startEditing(transaction)}
                          className="mt-2"
                        >
                          <Edit2 className="h-4 w-4 mr-1" />
                          Editar
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ScrollArea>

    {/* Sheet for Create/Edit/View Lead or Contact */}
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
      <SheetContent className="w-[420px] sm:w-[500px]">
        <SheetHeader>
          <SheetTitle>
            {sheetMode === 'create' ? (sheetType === 'lead' ? 'Adicionar Lead' : 'Criar Contato') : sheetMode === 'edit' ? (sheetType === 'lead' ? 'Editar Lead' : 'Editar Contato') : (sheetType === 'lead' ? 'Visualizar Lead' : 'Visualizar Contato')}
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-4 mt-4">
          {sheetType === 'lead' ? (
            /* ===== LEAD SHEET - uses AccidentLeadForm ===== */
            <div className={sheetMode === 'view' ? 'pointer-events-none opacity-75' : ''}>
              <AccidentLeadForm
                formData={leadFormData}
                onChange={(data) => setLeadFormData(prev => ({ ...prev, ...data }))}
                onOpenExtractor={() => setExtractorOpen(true)}
                teamMembers={teamProfiles}
              />
            </div>
          ) : (
            /* ===== CONTACT SHEET ===== */
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input value={contactSheetData.name} onChange={(e) => setContactSheetData(prev => ({ ...prev, name: e.target.value }))} placeholder="Nome completo" disabled={sheetMode === 'view'} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Telefone</Label>
                  <Input value={contactSheetData.phone} onChange={(e) => setContactSheetData(prev => ({ ...prev, phone: e.target.value }))} placeholder="(00) 00000-0000" disabled={sheetMode === 'view'} />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={contactSheetData.email} onChange={(e) => setContactSheetData(prev => ({ ...prev, email: e.target.value }))} placeholder="email@exemplo.com" disabled={sheetMode === 'view'} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Instagram</Label>
                <Input value={contactSheetData.instagram} onChange={(e) => setContactSheetData(prev => ({ ...prev, instagram: e.target.value }))} placeholder="@usuario" disabled={sheetMode === 'view'} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Estado</Label>
                  <Select value={contactSheetData.state} onValueChange={(v) => setContactSheetData(prev => ({ ...prev, state: v, city: '' }))} disabled={sheetMode === 'view'}>
                    <SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger>
                    <SelectContent>
                      {states.map(s => (<SelectItem key={s.sigla} value={s.sigla}>{s.sigla} - {s.nome}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Cidade</Label>
                  <Input value={contactSheetData.city} onChange={(e) => setContactSheetData(prev => ({ ...prev, city: e.target.value }))} placeholder="Cidade" disabled={sheetMode === 'view'} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Observações</Label>
                <Textarea value={contactSheetData.notes} onChange={(e) => setContactSheetData(prev => ({ ...prev, notes: e.target.value }))} placeholder="Notas sobre o contato..." disabled={sheetMode === 'view'} rows={3} />
              </div>
            </div>
          )}

          {sheetMode === 'view' ? (
            <div className="flex gap-2 pt-4">
              <Button className="flex-1" onClick={openEditSheet}>
                <Edit2 className="h-4 w-4 mr-2" />
                Editar
              </Button>
              <Button variant="outline" onClick={() => setSheetOpen(false)}>Fechar</Button>
            </div>
          ) : (
            <div className="flex gap-2 pt-4">
              <Button className="flex-1" onClick={saveSheetEntity} disabled={savingSheet}>
                <Save className="h-4 w-4 mr-2" />
                {savingSheet ? 'Salvando...' : sheetMode === 'create' ? 'Adicionar' : 'Salvar'}
              </Button>
              <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancelar</Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>

    {/* AI Data Extractor Dialog */}
    <AccidentDataExtractor
      open={extractorOpen}
      onOpenChange={setExtractorOpen}
      onDataExtracted={handleExtractedData}
      currentData={{
        victim_name: leadFormData.victim_name,
        victim_age: leadFormData.victim_age ? parseInt(leadFormData.victim_age) : null,
        accident_date: leadFormData.accident_date,
        accident_address: leadFormData.accident_address,
        damage_description: leadFormData.damage_description,
        contractor_company: leadFormData.contractor_company,
        main_company: leadFormData.main_company,
        sector: leadFormData.sector,
        case_type: leadFormData.case_type,
        liability_type: leadFormData.liability_type,
        legal_viability: leadFormData.legal_viability,
        visit_city: leadFormData.visit_city,
        visit_state: leadFormData.visit_state,
      }}
    />
    </div>
  );
}
