import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { AccidentLeadForm, AccidentLeadFormData } from '@/components/leads/AccidentLeadForm';
import { AccidentDataExtractor, ExtractedAccidentData } from '@/components/leads/AccidentDataExtractor';
import { useProfilesList } from '@/hooks/useProfilesList';
import { generateLeadName } from '@/utils/generateLeadName';
import { ExpenseCategoryManager } from '@/components/finance/ExpenseCategoryManager';
import { CategorySelector } from '@/components/finance/CategorySelector';
import { CardAssignmentManager } from '@/components/finance/CardAssignmentManager';
import {
  ArrowUpRight, ArrowDownRight, Search, Wallet, TrendingUp, TrendingDown,
  MapPin, Calendar, Tag, CheckCircle2, X, Edit2, Save, ChevronDown, ChevronUp,
  User, Users, Clock, Building2, Link2, Plus, Eye, AlertCircle, LayoutGrid,
  Settings, TableIcon
} from 'lucide-react';
import { exportBankTransactions } from '@/utils/financeExport';
import { ExportFormatMenu } from '@/components/finance/ExportFormatMenu';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { buildExpenseFormUrl } from '@/utils/publicAppUrl';
import { useExpenseCategories } from '@/hooks/useExpenseCategories';
import { useBrazilianLocations } from '@/hooks/useBrazilianLocations';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useCompanies } from '@/hooks/useCompanies';
import { useCostCenters } from '@/hooks/useCostCenters';
import { useBeneficiaries } from '@/hooks/useBeneficiaries';
import { translateCategory } from '@/utils/categoryTranslations';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface BankTransaction {
  id: string;
  pluggy_transaction_id: string;
  description: string | null;
  amount: number;
  transaction_date: string;
  transaction_time: string | null;
  category: string | null;
  transaction_type: string | null;
  merchant_name: string | null;
  merchant_cnpj: string | null;
  merchant_city: string | null;
  merchant_state: string | null;
  pluggy_account_id: string;
}

interface Lead {
  id: string;
  lead_name: string | null;
  city: string | null;
  state: string | null;
  acolhedor?: string | null;
}

interface Contact {
  id: string;
  full_name: string;
  city: string | null;
  state: string | null;
}

interface BankTransactionsViewProps {
  startDate: Date;
  endDate: Date;
  searchTerm?: string;
  filterCategories?: string[];
  filterSubcategory?: string;
}

type FlowFilter = 'all' | 'credit' | 'debit';

const NONE_SELECTED = 'NONE';

export function BankTransactionsView({ startDate, endDate, searchTerm: externalSearchTerm, filterCategories: externalFilterCategories, filterSubcategory: externalFilterSubcategory }: BankTransactionsViewProps) {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [internalSearchTerm, setInternalSearchTerm] = useState('');
  const searchTerm = externalSearchTerm || internalSearchTerm;
  const [flowFilter, setFlowFilter] = useState<FlowFilter>('all');
  const [activeTab, setActiveTab] = useState('workflow');

  // Auto-switch to lista tab when category filter is applied
  useEffect(() => {
    if (externalFilterCategories && !externalFilterCategories.includes('all')) {
      setActiveTab('lista');
    }
  }, [externalFilterCategories]);

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [generatingLink, setGeneratingLink] = useState(false);
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
  }>({ categoryId: null, linkType: 'lead', linkId: null, notes: '', manualState: '', manualCity: '', companyId: '', costCenterId: '', nature: '', recurrence: '', beneficiaryId: '', paymentMethod: '', invoiceNumber: '' });

  // Leads & Contacts for linking
  const [leads, setLeads] = useState<Lead[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<'create' | 'edit' | 'view'>('create');
  const [sheetType, setSheetType] = useState<'lead' | 'contact'>('lead');
  const [extractorOpen, setExtractorOpen] = useState(false);
  const [savingSheet, setSavingSheet] = useState(false);

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
  const [contactSheetData, setContactSheetData] = useState({ id: '', name: '', phone: '', email: '', city: '', state: '', notes: '', instagram: '' });

  const { categories, overrides, setTransactionOverride, getTransactionOverride, getCategoryById } = useExpenseCategories();
  const { states, cities, loadingCities, fetchCities } = useBrazilianLocations();
  const { fetchLocation, loading: geoLoading } = useGeolocation();
  const teamProfiles = useProfilesList();
  const { activeCompanies } = useCompanies();
  const { activeCostCenters, getByCompany } = useCostCenters();
  const { activeBeneficiaries } = useBeneficiaries();

  const parentCategories = useMemo(() => categories.filter(c => !c.parent_id), [categories]);

  useEffect(() => {
    if (!user) return;
    fetchTransactions();
    fetchLeadsAndContacts();
  }, [user, startDate, endDate]);

  const fetchTransactions = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const fromDate = format(startDate, 'yyyy-MM-dd');
      const toDate = format(endDate, 'yyyy-MM-dd');
      const { data, error } = await supabase
        .from('bank_transactions')
        .select('id, pluggy_transaction_id, description, amount, transaction_date, transaction_time, category, transaction_type, merchant_name, merchant_cnpj, merchant_city, merchant_state, pluggy_account_id')
        .gte('transaction_date', fromDate)
        .lte('transaction_date', toDate)
        .order('transaction_date', { ascending: false })
        .order('transaction_time', { ascending: false });
      if (error) throw error;
      setTransactions(data || []);
    } catch (err) {
      console.error('Error fetching bank transactions:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchLeadsAndContacts = async () => {
    const [leadsRes, contactsRes] = await Promise.all([
      supabase.from('leads').select('id, lead_name, city, state, acolhedor').order('created_at', { ascending: false }).limit(200),
      supabase.from('contacts').select('id, full_name, city, state').order('full_name').limit(200),
    ]);
    setLeads(leadsRes.data || []);
    setContacts(contactsRes.data || []);
  };

  const filtered = useMemo(() => {
    let result = transactions;
    if (flowFilter === 'credit') result = result.filter(t => t.amount >= 0);
    else if (flowFilter === 'debit') result = result.filter(t => t.amount < 0);
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(t =>
        t.description?.toLowerCase().includes(term) ||
        t.merchant_name?.toLowerCase().includes(term) ||
        t.category?.toLowerCase().includes(term) ||
        t.transaction_type?.toLowerCase().includes(term) ||
        t.merchant_city?.toLowerCase().includes(term)
      );
    }
    // Category filter from parent
    if (externalFilterCategories && !externalFilterCategories.includes('all')) {
      result = result.filter(t => {
        const override = getTransactionOverride(t.id);
        const categoryId = override?.category_id || null;
        if (externalFilterCategories.includes('uncategorized') && !categoryId) return true;
        if (categoryId) {
          // Check parent category match
          const cat = getCategoryById(categoryId);
          if (externalFilterCategories.includes(categoryId)) return true;
          if (cat?.parent_id && externalFilterCategories.includes(cat.parent_id)) return true;
        }
        return false;
      });
    }
    // Subcategory filter from parent
    if (externalFilterSubcategory && externalFilterSubcategory !== 'all') {
      result = result.filter(t => {
        const override = getTransactionOverride(t.id);
        return override?.category_id === externalFilterSubcategory;
      });
    }
    return result;
  }, [transactions, searchTerm, flowFilter, externalFilterCategories, externalFilterSubcategory, getTransactionOverride, getCategoryById]);

  const totalCredits = useMemo(() => filtered.filter(t => t.amount >= 0).reduce((sum, t) => sum + t.amount, 0), [filtered]);
  const totalDebits = useMemo(() => filtered.filter(t => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0), [filtered]);
  const balance = totalCredits - totalDebits;

  // Pending count
  const pendingCount = useMemo(() => {
    return filtered.filter(t => {
      const ov = getTransactionOverride(t.id);
      return !ov || (!ov.lead_id && !ov.contact_id && !ov.link_acknowledged);
    }).length;
  }, [filtered, getTransactionOverride]);

  // Pending transactions
  const pendingTransactions = useMemo(() => {
    return filtered.filter(t => {
      const ov = getTransactionOverride(t.id);
      return !ov || (!ov.lead_id && !ov.contact_id && !ov.link_acknowledged);
    });
  }, [filtered, getTransactionOverride]);

  // Group by day
  const transactionsByDay = useMemo(() => {
    const grouped: Record<string, BankTransaction[]> = {};
    filtered.forEach(t => {
      const date = t.transaction_date;
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push(t);
    });
    return Object.entries(grouped)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, txs]) => ({
        date,
        transactions: txs,
        total: txs.reduce((sum, t) => sum + t.amount, 0),
        count: txs.length,
      }));
  }, [filtered]);

  // Group by acolhedor (via linked lead)
  const transactionsByAcolhedor = useMemo(() => {
    const grouped: Record<string, { name: string; transactions: BankTransaction[]; total: number }> = {};
    const unlinked: BankTransaction[] = [];

    filtered.forEach(t => {
      const override = getTransactionOverride(t.id);
      if (override?.lead_id) {
        const lead = leads.find(l => l.id === override.lead_id);
        const acolhedor = lead?.acolhedor || 'Sem acolhedor';
        if (!grouped[acolhedor]) grouped[acolhedor] = { name: acolhedor, transactions: [], total: 0 };
        grouped[acolhedor].transactions.push(t);
        grouped[acolhedor].total += Math.abs(t.amount);
      } else {
        unlinked.push(t);
      }
    });

    const result = Object.values(grouped).sort((a, b) => b.total - a.total);
    if (unlinked.length > 0) {
      result.push({ name: 'Não vinculados', transactions: unlinked, total: unlinked.reduce((s, t) => s + Math.abs(t.amount), 0) });
    }
    return result;
  }, [filtered, getTransactionOverride, leads]);

  // Group by category
  const transactionsByCategory = useMemo(() => {
    const grouped: Record<string, { name: string; color: string; transactions: BankTransaction[]; total: number }> = {};
    const uncategorized: BankTransaction[] = [];

    filtered.forEach(t => {
      const override = getTransactionOverride(t.id);
      if (override?.category_id) {
        const cat = getCategoryById(override.category_id);
        const catName = cat?.name || 'Desconhecida';
        if (!grouped[override.category_id]) grouped[override.category_id] = { name: catName, color: cat?.color || 'bg-muted', transactions: [], total: 0 };
        grouped[override.category_id].transactions.push(t);
        grouped[override.category_id].total += Math.abs(t.amount);
      } else {
        uncategorized.push(t);
      }
    });

    const result = Object.values(grouped).sort((a, b) => b.total - a.total);
    if (uncategorized.length > 0) {
      result.push({ name: 'Sem categoria', color: 'bg-muted', transactions: uncategorized, total: uncategorized.reduce((s, t) => s + Math.abs(t.amount), 0) });
    }
    return result;
  }, [filtered, getTransactionOverride, getCategoryById]);

  const startEditing = (transaction: BankTransaction) => {
    const override = getTransactionOverride(transaction.id);
    let linkType: 'lead' | 'contact' = 'lead';
    let linkId: string | null = null;
    if (override?.lead_id) { linkType = 'lead'; linkId = override.lead_id; }
    else if (override?.contact_id) { linkType = 'contact'; linkId = override.contact_id; }

    setEditingId(transaction.id);
    setEditData({
      categoryId: override?.category_id || null,
      linkType, linkId,
      notes: override?.notes || '',
      manualState: override?.manual_state || transaction.merchant_state || '',
      manualCity: override?.manual_city || transaction.merchant_city || '',
      companyId: (override as any)?.company_id || '',
      costCenterId: (override as any)?.cost_center_id || '',
      nature: (override as any)?.nature || '',
      recurrence: (override as any)?.recurrence || '',
      beneficiaryId: (override as any)?.beneficiary_id || '',
      paymentMethod: (override as any)?.payment_method || '',
      invoiceNumber: (override as any)?.invoice_number || '',
    });

    if (override?.manual_state || transaction.merchant_state) {
      fetchCities(override?.manual_state || transaction.merchant_state || '');
    }

    const hasState = override?.manual_state || transaction.merchant_state;
    const hasCity = override?.manual_city || transaction.merchant_city;
    if (!hasState && !hasCity) {
      fetchLocation().then(loc => {
        if (loc) {
          setEditData(prev => ({ ...prev, manualState: loc.state, manualCity: loc.city }));
          fetchCities(loc.state);
        }
      });
    }
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditData({ categoryId: null, linkType: 'lead', linkId: null, notes: '', manualState: '', manualCity: '', companyId: '', costCenterId: '', nature: '', recurrence: '', beneficiaryId: '', paymentMethod: '', invoiceNumber: '' });
  };

  const saveTransaction = async (transactionId: string) => {
    if (!editData.categoryId) { toast.error('Selecione uma categoria'); return; }
    if (!editData.linkId) { toast.error(`Selecione um ${editData.linkType === 'lead' ? 'Lead' : 'Contato'} ou "Nenhum Vinculado"`); return; }
    try {
      const isNoneSelected = editData.linkId === NONE_SELECTED;
      await setTransactionOverride(
        transactionId,
        editData.categoryId,
        !isNoneSelected && editData.linkType === 'contact' ? editData.linkId : undefined,
        !isNoneSelected && editData.linkType === 'lead' ? editData.linkId : undefined,
        editData.notes || undefined,
        editData.manualCity || undefined,
        editData.manualState || undefined,
        isNoneSelected,
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
      toast.success('Transação categorizada!');
    } catch (err) {
      console.error('Error saving:', err);
      toast.error('Erro ao salvar');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(t => t.id)));
  };

  const generateLinkForSelected = async () => {
    if (selectedIds.size === 0 || !user) return;
    setGeneratingLink(true);
    try {
      const selectedTxs = transactions.filter(t => selectedIds.has(t.id));
      const dates = selectedTxs.map(t => t.transaction_date).sort();
      const { data, error } = await supabase
        .from('expense_form_tokens')
        .insert({
          card_last_digits: 'CC',
          date_from: dates[0],
          date_to: dates[dates.length - 1],
          created_by: user.id,
          transaction_ids: selectedTxs.map(t => t.pluggy_transaction_id),
        })
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

  // Sheet handlers
  const openCreateSheet = (type: 'lead' | 'contact') => {
    setSheetType(type); setSheetMode('create');
    if (type === 'lead') { setLeadFormData({ ...defaultLeadFormData }); setLeadSheetId(''); }
    else { setContactSheetData({ id: '', name: '', phone: '', email: '', city: '', state: '', notes: '', instagram: '' }); }
    setSheetOpen(true);
  };

  const openViewSheet = async (type: 'lead' | 'contact', id: string) => {
    setSheetType(type); setSheetMode('view');
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
      const autoName = generateLeadName({ city: updated.visit_city, state: updated.visit_state, victim_name: updated.victim_name, main_company: updated.main_company, contractor_company: updated.contractor_company, accident_date: updated.accident_date, damage_description: updated.damage_description, case_type: updated.case_type });
      if (autoName) updated.lead_name = autoName;
      return updated;
    });
  };

  const saveSheetEntity = async () => {
    setSavingSheet(true);
    try {
      if (sheetType === 'lead') {
        if (!leadFormData.lead_name.trim()) { toast.error('Nome é obrigatório'); setSavingSheet(false); return; }
        const payload: any = {
          lead_name: leadFormData.lead_name.trim(), lead_phone: leadFormData.lead_phone || null, lead_email: leadFormData.lead_email || null,
          source: leadFormData.source || null, notes: leadFormData.notes || null, acolhedor: leadFormData.acolhedor || null,
          case_type: leadFormData.case_type || null, group_link: leadFormData.group_link || null,
          visit_city: leadFormData.visit_city || null, visit_state: leadFormData.visit_state || null,
          visit_region: leadFormData.visit_region || null, visit_address: leadFormData.visit_address || null,
          accident_date: leadFormData.accident_date || null, damage_description: leadFormData.damage_description || null,
          victim_name: leadFormData.victim_name || null, victim_age: leadFormData.victim_age ? parseInt(leadFormData.victim_age) : null,
          accident_address: leadFormData.accident_address || null, contractor_company: leadFormData.contractor_company || null,
          main_company: leadFormData.main_company || null, sector: leadFormData.sector || null,
          news_link: leadFormData.news_link || null, company_size_justification: leadFormData.company_size_justification || null,
          liability_type: leadFormData.liability_type || null, legal_viability: leadFormData.legal_viability || null,
          city: leadFormData.visit_city || null, state: leadFormData.visit_state || null,
        };
        if (sheetMode === 'create') {
          const { data, error } = await supabase.from('leads').insert({
            ...payload,
            created_by: user?.id || null,
            updated_by: user?.id || null,
          }).select('id, lead_name, city, state, acolhedor').single();
          if (error) throw error;
          setLeads(prev => [...prev, data]);
          setEditData(prev => ({ ...prev, linkType: 'lead', linkId: data.id }));
          toast.success('Lead criado!');
        } else {
          const { error } = await supabase.from('leads').update(payload).eq('id', leadSheetId);
          if (error) throw error;
          setLeads(prev => prev.map(l => l.id === leadSheetId ? { ...l, lead_name: leadFormData.lead_name, city: leadFormData.visit_city, state: leadFormData.visit_state } : l));
          toast.success('Lead atualizado!');
        }
      } else {
        if (!contactSheetData.name.trim()) { toast.error('Nome é obrigatório'); setSavingSheet(false); return; }
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        const payload = {
          full_name: contactSheetData.name.trim(), phone: contactSheetData.phone || null, email: contactSheetData.email || null,
          city: contactSheetData.city || null, state: contactSheetData.state || null,
          instagram_username: contactSheetData.instagram || null, notes: contactSheetData.notes || null,
          created_by: currentUser?.id || null,
        };
        if (sheetMode === 'create') {
          const { data, error } = await supabase.from('contacts').insert(payload).select('id, full_name, city, state').single();
          if (error) throw error;
          setContacts(prev => [...prev, data]);
          setEditData(prev => ({ ...prev, linkType: 'contact', linkId: data.id }));
          toast.success('Contato criado!');
        } else {
          const { error } = await supabase.from('contacts').update(payload).eq('id', contactSheetData.id);
          if (error) throw error;
          setContacts(prev => prev.map(c => c.id === contactSheetData.id ? { ...c, full_name: contactSheetData.name, city: contactSheetData.city, state: contactSheetData.state } : c));
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

  const formatCurrency = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

  // Render a single transaction row (reused across tabs)
  const renderTransactionRow = (t: BankTransaction, showCheckbox = true) => {
    const isEditing = editingId === t.id;
    const isExpanded = expandedId === t.id || isEditing;
    const override = getTransactionOverride(t.id);
    const isPending = !override || (!override.lead_id && !override.contact_id && !override.link_acknowledged);
    const category = override?.category_id ? getCategoryById(override.category_id) : null;

    let linkedName = '';
    if (override?.lead_id) { const lead = leads.find(l => l.id === override.lead_id); linkedName = lead?.lead_name || ''; }
    else if (override?.contact_id) { const contact = contacts.find(c => c.id === override.contact_id); linkedName = contact?.full_name || ''; }

    return (
      <div key={t.id} className={cn("border rounded-lg transition-all", isPending ? "border-amber-500/50 bg-amber-50/30 dark:bg-amber-950/10" : "bg-card", isEditing && "ring-2 ring-primary")}>
        {/* Main Row */}
        <div className="p-3 cursor-pointer hover:bg-muted/50" onClick={() => !isEditing && setExpandedId(isExpanded ? null : t.id)}>
          <div className="flex items-center gap-2">
            {showCheckbox && (
              <Checkbox checked={selectedIds.has(t.id)} onCheckedChange={() => toggleSelect(t.id)} onClick={(e) => e.stopPropagation()} className="shrink-0" />
            )}
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>

            <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
              <span className="w-12">{format(new Date(t.transaction_date + 'T12:00:00'), 'dd/MM', { locale: ptBR })}</span>
              {t.transaction_time && (
                <span className="flex items-center gap-0.5 text-muted-foreground/70">
                  <Clock className="h-3 w-3" />{t.transaction_time.slice(0, 5)}
                </span>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {t.amount >= 0 ? <ArrowUpRight className="h-4 w-4 text-green-500 shrink-0" /> : <ArrowDownRight className="h-4 w-4 text-destructive shrink-0" />}
                <p className="font-medium truncate text-sm">{t.description || t.merchant_name || 'Sem descrição'}</p>
              </div>
            </div>

            {isPending ? (
              <Badge variant="outline" className="shrink-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Pendente</Badge>
            ) : (
              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
            )}

            <span className={cn("font-bold text-sm w-24 text-right shrink-0", t.amount >= 0 ? "text-green-600" : "text-destructive")}>
              {formatCurrency(t.amount)}
            </span>

            {!isEditing && (
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={(e) => { e.stopPropagation(); startEditing(t); }}>
                <Edit2 className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Secondary info row */}
          <div className="flex items-center gap-2 mt-1 ml-10 flex-wrap">
            {t.merchant_cnpj && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
                <Building2 className="h-3 w-3" />
                {t.merchant_cnpj.length === 14 ? t.merchant_cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : t.merchant_cnpj}
              </span>
            )}
            {(t.merchant_city || t.merchant_state) && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" />{[t.merchant_city, t.merchant_state].filter(Boolean).join('-')}</span>
            )}
            {category && (
              <Badge variant="outline" className="text-[10px] h-5">
                <div className={cn("w-2 h-2 rounded-full mr-1", category.color)} />{category.name}
              </Badge>
            )}
            {linkedName && (
              <Badge variant="secondary" className="text-[10px] h-5">
                {override?.lead_id ? <User className="h-3 w-3 mr-0.5" /> : <Users className="h-3 w-3 mr-0.5" />}{linkedName}
              </Badge>
            )}
          </div>
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
                    <Select value={editData.linkType} onValueChange={(v: 'lead' | 'contact') => setEditData(prev => ({ ...prev, linkType: v, linkId: null }))}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lead">Lead</SelectItem>
                        <SelectItem value="contact">Contato</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium">{editData.linkType === 'lead' ? 'Lead' : 'Contato'}</label>
                      <div className="flex gap-1">
                        {editData.linkId && editData.linkId !== NONE_SELECTED && (
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={(e) => { e.stopPropagation(); openViewSheet(editData.linkType, editData.linkId!); }} title="Visualizar"><Eye className="h-3 w-3" /></Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={(e) => { e.stopPropagation(); openCreateSheet(editData.linkType); }} title={`Criar ${editData.linkType === 'lead' ? 'Lead' : 'Contato'}`}><Plus className="h-3 w-3" /></Button>
                      </div>
                    </div>
                    <Select value={editData.linkId || ''} onValueChange={(v) => {
                      setEditData(prev => ({ ...prev, linkId: v }));
                      // Auto-fill city/state from lead's visit location
                      if (editData.linkType === 'lead' && v && v !== NONE_SELECTED) {
                        const selectedLead = leads.find(l => l.id === v);
                        if (selectedLead) {
                          const leadState = selectedLead.state || '';
                          const leadCity = selectedLead.city || '';
                          if (leadState || leadCity) {
                            setEditData(prev => ({ ...prev, linkId: v, manualState: leadState, manualCity: leadCity }));
                            if (leadState) fetchCities(leadState);
                          }
                        }
                      }
                    }}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE_SELECTED} className="text-amber-600 dark:text-amber-400 font-medium italic">
                          <div className="flex items-center gap-2"><X className="h-3 w-3" /> Nenhum Vinculado</div>
                        </SelectItem>
                        {editData.linkType === 'lead'
                          ? leads.map(lead => (
                            <SelectItem key={lead.id} value={lead.id}>
                              <div className="flex items-center gap-2">
                                <span>{lead.lead_name || 'Sem nome'}</span>
                                {(lead.city || lead.state) && <span className="text-xs text-muted-foreground">({[lead.city, lead.state].filter(Boolean).join('-')})</span>}
                              </div>
                            </SelectItem>
                          ))
                          : contacts.map(contact => (
                            <SelectItem key={contact.id} value={contact.id}>
                              <div className="flex items-center gap-2">
                                <span>{contact.full_name}</span>
                                {(contact.city || contact.state) && <span className="text-xs text-muted-foreground">({[contact.city, contact.state].filter(Boolean).join('-')})</span>}
                              </div>
                            </SelectItem>
                          ))
                        }
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Location */}
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium">Localização</label>
                  <Button type="button" variant="ghost" size="sm" className="h-6 text-xs gap-1" disabled={geoLoading}
                    onClick={async () => {
                      try {
                        const loc = await fetchLocation();
                        if (loc) { setEditData(prev => ({ ...prev, manualState: loc.state, manualCity: loc.city })); fetchCities(loc.state); toast.success('Localização detectada!'); }
                        else { toast.error('Não foi possível detectar a localização.'); }
                      } catch { toast.error('Erro ao acessar localização.'); }
                    }}>
                    <MapPin className="h-3 w-3" />{geoLoading ? 'Detectando...' : 'Usar localização'}
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Estado</label>
                    <Select value={editData.manualState} onValueChange={(v) => { setEditData(prev => ({ ...prev, manualState: v, manualCity: '' })); fetchCities(v); }}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="UF" /></SelectTrigger>
                      <SelectContent>{states.map(s => <SelectItem key={s.sigla} value={s.sigla}>{s.sigla}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2 space-y-1">
                    <label className="text-xs font-medium">Cidade</label>
                    <Select value={editData.manualCity} onValueChange={(v) => setEditData(prev => ({ ...prev, manualCity: v }))} disabled={!editData.manualState || loadingCities}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={loadingCities ? 'Carregando...' : 'Cidade'} /></SelectTrigger>
                      <SelectContent>{cities.map(c => <SelectItem key={c.id} value={c.nome}>{c.nome}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Empresa + Setor */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Empresa</label>
                    <Select value={editData.companyId} onValueChange={(v) => setEditData(prev => ({ ...prev, companyId: v, costCenterId: '' }))}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar empresa" /></SelectTrigger>
                      <SelectContent>{activeCompanies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Setor / Centro de Custo</label>
                    <Select value={editData.costCenterId} onValueChange={(v) => setEditData(prev => ({ ...prev, costCenterId: v }))} disabled={!editData.companyId}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar setor" /></SelectTrigger>
                      <SelectContent>{(editData.companyId ? getByCompany(editData.companyId) : activeCostCenters).map(cc => <SelectItem key={cc.id} value={cc.id}>{cc.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Natureza + Recorrência */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Natureza</label>
                    <Select value={editData.nature} onValueChange={(v) => setEditData(prev => ({ ...prev, nature: v }))}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixo">Fixo</SelectItem>
                        <SelectItem value="variavel">Variável</SelectItem>
                        <SelectItem value="semi-fixo">Semi-fixo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Recorrência</label>
                    <Select value={editData.recurrence} onValueChange={(v) => setEditData(prev => ({ ...prev, recurrence: v }))}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="semanal">Semanal</SelectItem>
                        <SelectItem value="mensal">Mensal</SelectItem>
                        <SelectItem value="anual">Anual</SelectItem>
                        <SelectItem value="eventual">Eventual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Beneficiário + Forma de Pagamento */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Beneficiário</label>
                    <Select value={editData.beneficiaryId} onValueChange={(v) => setEditData(prev => ({ ...prev, beneficiaryId: v }))}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                      <SelectContent>{activeBeneficiaries.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Forma de Pagamento</label>
                    <Select value={editData.paymentMethod} onValueChange={(v) => setEditData(prev => ({ ...prev, paymentMethod: v }))}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pix">PIX</SelectItem>
                        <SelectItem value="boleto">Boleto</SelectItem>
                        <SelectItem value="cartao_credito">Cartão de Crédito</SelectItem>
                        <SelectItem value="cartao_debito">Cartão de Débito</SelectItem>
                        <SelectItem value="transferencia">Transferência</SelectItem>
                        <SelectItem value="dinheiro">Dinheiro</SelectItem>
                        <SelectItem value="cheque">Cheque</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Nº NF + Descrição */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Nº Nota Fiscal</label>
                    <Input value={editData.invoiceNumber} onChange={(e) => setEditData(prev => ({ ...prev, invoiceNumber: e.target.value }))} placeholder="Nº NF" className="h-8 text-xs" />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <label className="text-xs font-medium">Descrição</label>
                    <Input value={editData.notes} onChange={(e) => setEditData(prev => ({ ...prev, notes: e.target.value }))} placeholder="Descreva o que foi este gasto..." className="h-8 text-xs" />
                  </div>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={cancelEditing}><X className="h-4 w-4 mr-1" /> Cancelar</Button>
                  <Button size="sm" onClick={() => saveTransaction(t.id)}><Save className="h-4 w-4 mr-1" /> Salvar</Button>
                </div>
              </>
            ) : (
              <div className="text-sm space-y-2">
                <div className="flex flex-wrap gap-4 text-muted-foreground">
                  <span className="flex items-center gap-1"><Calendar className="h-4 w-4" />{format(new Date(t.transaction_date + 'T12:00:00'), "dd 'de' MMMM, yyyy", { locale: ptBR })}</span>
                  {t.category && <span className="flex items-center gap-1"><Tag className="h-4 w-4" />{translateCategory(t.category)}</span>}
                  {t.merchant_cnpj && <span className="font-mono text-xs">CNPJ: {t.merchant_cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}</span>}
                </div>
                {override?.notes && <p className="text-xs text-muted-foreground">📝 {override.notes}</p>}
                <Button variant="outline" size="sm" onClick={() => startEditing(t)} className="mt-2"><Edit2 className="h-4 w-4 mr-1" /> Editar</Button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <Card className="border-0 shadow-card">
        <CardContent className="py-12 text-center">
          <Wallet className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">Nenhuma movimentação no período selecionado.</p>
          <p className="text-sm text-muted-foreground/70 mt-2">
            Período: {format(startDate, 'dd/MM/yyyy', { locale: ptBR })} a {format(endDate, 'dd/MM/yyyy', { locale: ptBR })}.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card className={cn("border-0 shadow-card cursor-pointer transition-all", flowFilter === 'credit' && "ring-2 ring-primary")} onClick={() => setFlowFilter(flowFilter === 'credit' ? 'all' : 'credit')}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1"><TrendingUp className="h-4 w-4 text-green-500" /> Entradas</div>
            <p className="text-xl font-bold text-green-600">R$ {totalCredits.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          </CardContent>
        </Card>
        <Card className={cn("border-0 shadow-card cursor-pointer transition-all", flowFilter === 'debit' && "ring-2 ring-primary")} onClick={() => setFlowFilter(flowFilter === 'debit' ? 'all' : 'debit')}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1"><TrendingDown className="h-4 w-4 text-destructive" /> Saídas</div>
            <p className="text-xl font-bold text-destructive">R$ {totalDebits.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1"><Wallet className="h-4 w-4" /> Saldo Período</div>
            <p className={cn("text-xl font-bold", balance >= 0 ? "text-green-600" : "text-destructive")}>R$ {balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          </CardContent>
        </Card>
      </div>

      {/* Search + Flow Filter */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por descrição, estabelecimento, categoria, cidade..." value={internalSearchTerm} onChange={(e) => setInternalSearchTerm(e.target.value)} className="pl-10 h-10 rounded-xl bg-muted/50 border-0" />
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-xl p-1">
          <Button variant={flowFilter === 'all' ? 'default' : 'ghost'} size="sm" className="h-8 text-xs rounded-lg" onClick={() => setFlowFilter('all')}>Todas</Button>
          <Button variant={flowFilter === 'credit' ? 'default' : 'ghost'} size="sm" className="h-8 text-xs rounded-lg gap-1" onClick={() => setFlowFilter('credit')}><ArrowUpRight className="h-3 w-3" /> Entradas</Button>
          <Button variant={flowFilter === 'debit' ? 'default' : 'ghost'} size="sm" className="h-8 text-xs rounded-lg gap-1" onClick={() => setFlowFilter('debit')}><ArrowDownRight className="h-3 w-3" /> Saídas</Button>
        </div>
      </div>

      {/* Batch Actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 p-2 bg-muted rounded-lg">
          <Badge variant="secondary">{selectedIds.size} selecionada(s)</Badge>
          <Button size="sm" className="gap-1.5" onClick={generateLinkForSelected} disabled={generatingLink}>
            <Link2 className="h-3.5 w-3.5" /> Gerar Link
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setSelectedIds(new Set())}>
            <X className="h-3.5 w-3.5" /> Limpar
          </Button>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-6 h-10">
          <TabsTrigger value="workflow" className="flex items-center gap-2 text-xs sm:text-sm">
            <AlertCircle className="h-4 w-4" />
            <span className="hidden sm:inline">Pendentes</span>
            {pendingCount > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                {pendingCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="acolhedores" className="flex items-center gap-2 text-xs sm:text-sm">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">Acolhedores</span>
          </TabsTrigger>
          <TabsTrigger value="agrupado" className="flex items-center gap-2 text-xs sm:text-sm">
            <LayoutGrid className="h-4 w-4" />
            <span className="hidden sm:inline">Agrupado</span>
          </TabsTrigger>
          <TabsTrigger value="por-dia" className="flex items-center gap-2 text-xs sm:text-sm">
            <TableIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Por Dia</span>
          </TabsTrigger>
          <TabsTrigger value="lista" className="flex items-center gap-2 text-xs sm:text-sm">
            <LayoutGrid className="h-4 w-4" />
            <span className="hidden sm:inline">Lista</span>
          </TabsTrigger>
          <TabsTrigger value="config" className="flex items-center gap-2 text-xs sm:text-sm">
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">Config</span>
          </TabsTrigger>
        </TabsList>

        {/* Pendentes Tab */}
        <TabsContent value="workflow" className="mt-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-amber-500" />
                  <span className="font-medium">{pendingCount} pendentes</span>
                </div>
                <Badge variant="secondary" className="rounded-full">
                  {filtered.length - pendingCount} / {filtered.length} vinculados
                </Badge>
              </div>
            </div>
            <Progress value={filtered.length > 0 ? ((filtered.length - pendingCount) / filtered.length) * 100 : 0} className="h-1.5" />

            {pendingCount === 0 ? (
              <Card className="border-green-500/50 bg-green-50/50 dark:bg-green-950/20">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <CheckCircle2 className="h-16 w-16 text-green-500 mb-4" />
                  <h3 className="text-xl font-semibold mb-2">Tudo Categorizado!</h3>
                  <p className="text-muted-foreground text-center">
                    Todos os {filtered.length} gastos foram vinculados.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-0 shadow-card">
                <CardContent className="py-4">
                  <ScrollArea className="h-[500px]">
                    <div className="space-y-2 pr-4">
                      {pendingTransactions.map(t => renderTransactionRow(t, false))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Acolhedores Tab */}
        <TabsContent value="acolhedores" className="mt-4">
          <div className="space-y-4">
            {transactionsByAcolhedor.map(group => (
              <Card key={group.name} className="border-0 shadow-card">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      {group.name}
                    </CardTitle>
                    <div className="text-right">
                      <p className="text-lg font-bold text-destructive">{formatCurrency(group.total)}</p>
                      <p className="text-xs text-muted-foreground">{group.transactions.length} transações</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="max-h-[300px]">
                    <div className="space-y-1">
                      {group.transactions.map(t => (
                        <div key={t.id} className="flex items-center justify-between py-2 px-2 hover:bg-muted/50 rounded text-sm">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="text-xs text-muted-foreground w-12">{format(new Date(t.transaction_date + 'T12:00:00'), 'dd/MM')}</span>
                            <span className="truncate">{t.description || t.merchant_name || 'Sem descrição'}</span>
                          </div>
                          <span className={cn("font-medium shrink-0", t.amount < 0 ? "text-destructive" : "text-green-600")}>{formatCurrency(t.amount)}</span>
                          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 ml-1" onClick={() => startEditing(t)}><Edit2 className="h-3 w-3" /></Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Agrupado Tab - by category */}
        <TabsContent value="agrupado" className="mt-4">
          <div className="space-y-4">
            {transactionsByCategory.map(group => (
              <Card key={group.name} className="border-0 shadow-card">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <div className={cn("w-3 h-3 rounded", group.color)} />
                      {group.name}
                    </CardTitle>
                    <div className="text-right">
                      <p className="text-lg font-bold text-destructive">{formatCurrency(group.total)}</p>
                      <p className="text-xs text-muted-foreground">{group.transactions.length} transações</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="max-h-[300px]">
                    <div className="space-y-1">
                      {group.transactions.map(t => {
                        const override = getTransactionOverride(t.id);
                        let linkedName = '';
                        if (override?.lead_id) { const lead = leads.find(l => l.id === override.lead_id); linkedName = lead?.lead_name || ''; }
                        else if (override?.contact_id) { const contact = contacts.find(c => c.id === override.contact_id); linkedName = contact?.full_name || ''; }

                        return (
                          <div key={t.id} className="flex items-center justify-between py-2 px-2 hover:bg-muted/50 rounded text-sm">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span className="text-xs text-muted-foreground w-12">{format(new Date(t.transaction_date + 'T12:00:00'), 'dd/MM')}</span>
                              <span className="truncate">{t.description || t.merchant_name || 'Sem descrição'}</span>
                              {linkedName && <Badge variant="secondary" className="text-[10px] shrink-0">{linkedName}</Badge>}
                            </div>
                            <span className={cn("font-medium shrink-0", t.amount < 0 ? "text-destructive" : "text-green-600")}>{formatCurrency(t.amount)}</span>
                            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 ml-1" onClick={() => startEditing(t)}><Edit2 className="h-3 w-3" /></Button>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Por Dia Tab */}
        <TabsContent value="por-dia" className="mt-4">
          <div className="space-y-4">
            {transactionsByDay.map(group => (
              <Card key={group.date} className="border-0 shadow-card">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      {format(new Date(group.date + 'T12:00:00'), "EEEE, dd 'de' MMMM", { locale: ptBR })}
                    </CardTitle>
                    <div className="text-right">
                      <p className={cn("text-lg font-bold", group.total >= 0 ? "text-green-600" : "text-destructive")}>{formatCurrency(group.total)}</p>
                      <p className="text-xs text-muted-foreground">{group.count} transações</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    {group.transactions.map(t => renderTransactionRow(t, true))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Lista Tab */}
        <TabsContent value="lista" className="mt-4">
          <Card className="border-0 shadow-card">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  Extrato ({filtered.length} movimentações)
                  {flowFilter !== 'all' && <Badge variant="secondary" className="ml-2 text-xs">{flowFilter === 'credit' ? 'Só entradas' : 'Só saídas'}</Badge>}
                </CardTitle>
                <ExportFormatMenu onExport={(fmt) => exportBankTransactions(filtered, fmt)} disabled={filtered.length === 0} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 mb-2 px-1">
                <Checkbox checked={selectedIds.size === filtered.length && filtered.length > 0} onCheckedChange={toggleSelectAll} />
                <span className="text-xs text-muted-foreground">Selecionar todas</span>
              </div>
              <ScrollArea className="h-[500px]">
                <div className="space-y-2 pr-4">
                  {filtered.map(t => renderTransactionRow(t))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Config Tab */}
        <TabsContent value="config" className="mt-4">
          <div className="space-y-6">
            <ExpenseCategoryManager />
          </div>
        </TabsContent>
      </Tabs>

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
              <div className={sheetMode === 'view' ? 'pointer-events-none opacity-75' : ''}>
                <AccidentLeadForm formData={leadFormData} onChange={(data) => setLeadFormData(prev => ({ ...prev, ...data }))} onOpenExtractor={() => setExtractorOpen(true)} teamMembers={teamProfiles} />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2"><Label>Nome *</Label><Input value={contactSheetData.name} onChange={(e) => setContactSheetData(prev => ({ ...prev, name: e.target.value }))} placeholder="Nome completo" disabled={sheetMode === 'view'} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>Telefone</Label><Input value={contactSheetData.phone} onChange={(e) => setContactSheetData(prev => ({ ...prev, phone: e.target.value }))} placeholder="(00) 00000-0000" disabled={sheetMode === 'view'} /></div>
                  <div className="space-y-2"><Label>Email</Label><Input value={contactSheetData.email} onChange={(e) => setContactSheetData(prev => ({ ...prev, email: e.target.value }))} placeholder="email@exemplo.com" disabled={sheetMode === 'view'} /></div>
                </div>
                <div className="space-y-2"><Label>Instagram</Label><Input value={contactSheetData.instagram} onChange={(e) => setContactSheetData(prev => ({ ...prev, instagram: e.target.value }))} placeholder="@usuario" disabled={sheetMode === 'view'} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>Estado</Label><Select value={contactSheetData.state} onValueChange={(v) => setContactSheetData(prev => ({ ...prev, state: v, city: '' }))} disabled={sheetMode === 'view'}><SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger><SelectContent>{states.map(s => <SelectItem key={s.sigla} value={s.sigla}>{s.sigla} - {s.nome}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-2"><Label>Cidade</Label><Input value={contactSheetData.city} onChange={(e) => setContactSheetData(prev => ({ ...prev, city: e.target.value }))} placeholder="Cidade" disabled={sheetMode === 'view'} /></div>
                </div>
                <div className="space-y-2"><Label>Observações</Label><Textarea value={contactSheetData.notes} onChange={(e) => setContactSheetData(prev => ({ ...prev, notes: e.target.value }))} placeholder="Notas..." disabled={sheetMode === 'view'} rows={3} /></div>
              </div>
            )}
            {sheetMode === 'view' ? (
              <div className="flex gap-2 pt-4">
                <Button className="flex-1" onClick={() => setSheetMode('edit')}><Edit2 className="h-4 w-4 mr-2" /> Editar</Button>
                <Button variant="outline" onClick={() => setSheetOpen(false)}>Fechar</Button>
              </div>
            ) : (
              <div className="flex gap-2 pt-4">
                <Button className="flex-1" onClick={saveSheetEntity} disabled={savingSheet}><Save className="h-4 w-4 mr-2" />{savingSheet ? 'Salvando...' : sheetMode === 'create' ? 'Adicionar' : 'Salvar'}</Button>
                <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancelar</Button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AccidentDataExtractor open={extractorOpen} onOpenChange={setExtractorOpen} onDataExtracted={handleExtractedData} currentData={{
        victim_name: leadFormData.victim_name, victim_age: leadFormData.victim_age ? parseInt(leadFormData.victim_age) : null,
        accident_date: leadFormData.accident_date, accident_address: leadFormData.accident_address,
        damage_description: leadFormData.damage_description, contractor_company: leadFormData.contractor_company,
        main_company: leadFormData.main_company, sector: leadFormData.sector, case_type: leadFormData.case_type,
        liability_type: leadFormData.liability_type, legal_viability: leadFormData.legal_viability,
        visit_city: leadFormData.visit_city, visit_state: leadFormData.visit_state,
      }} />
    </div>
  );
}
