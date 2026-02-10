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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  Eye
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useExpenseCategories, ExpenseCategory } from '@/hooks/useExpenseCategories';
import { useBrazilianLocations } from '@/hooks/useBrazilianLocations';
import { translateCategory } from '@/utils/categoryTranslations';
import { toast } from 'sonner';

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
  
  const NONE_SELECTED = 'NONE';
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [generatingLink, setGeneratingLink] = useState(false);
  const [editData, setEditData] = useState<{
    categoryId: string | null;
    linkType: 'lead' | 'contact';
    linkId: string | null;
    notes: string;
    manualState: string;
    manualCity: string;
  }>({
    categoryId: null,
    linkType: 'lead',
    linkId: null,
    notes: '',
    manualState: '',
    manualCity: ''
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Sheet state for create/edit/view lead or contact
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<'create' | 'edit' | 'view'>('create');
  const [sheetType, setSheetType] = useState<'lead' | 'contact'>('lead');
  const [sheetData, setSheetData] = useState({
    id: '',
    name: '',
    phone: '',
    email: '',
    city: '',
    state: '',
    notes: '',
    instagram: '',
    // Lead-specific fields
    source: '',
    acolhedor: '',
    group_link: '',
    accident_date: '',
    victim_name: '',
    main_company: '',
    contractor_company: '',
    legal_viability: '',
    neighborhood: '',
  });
  const [sheetTab, setSheetTab] = useState('basico');
  const [savingSheet, setSavingSheet] = useState(false);

  // Local copies of leads/contacts to append newly created ones
  const [localLeads, setLocalLeads] = useState<Lead[]>(leads);
  const [localContacts, setLocalContacts] = useState<Contact[]>(contacts);
  
  // Keep in sync with props
  useMemo(() => { setLocalLeads(leads); }, [leads]);
  useMemo(() => { setLocalContacts(contacts); }, [contacts]);

  const defaultSheetData = { id: '', name: '', phone: '', email: '', city: '', state: '', notes: '', instagram: '', source: '', acolhedor: '', group_link: '', accident_date: '', victim_name: '', main_company: '', contractor_company: '', legal_viability: '', neighborhood: '' };

  const openCreateSheet = (type: 'lead' | 'contact') => {
    setSheetType(type);
    setSheetMode('create');
    setSheetData({ ...defaultSheetData });
    setSheetTab('basico');
    setSheetOpen(true);
  };

  const openViewSheet = async (type: 'lead' | 'contact', id: string) => {
    setSheetType(type);
    setSheetMode('view');
    setSheetTab('basico');
    
    // Fetch full data from DB
    if (type === 'lead') {
      const { data } = await supabase.from('leads').select('*').eq('id', id).single();
      if (data) setSheetData({ id: data.id, name: data.lead_name || '', phone: data.lead_phone || '', email: data.lead_email || '', city: data.city || '', state: data.state || '', notes: data.notes || '', instagram: data.instagram_username || '', source: data.source || '', acolhedor: data.acolhedor || '', group_link: data.group_link || '', accident_date: data.accident_date || '', victim_name: data.victim_name || '', main_company: data.main_company || '', contractor_company: data.contractor_company || '', legal_viability: data.legal_viability || '', neighborhood: data.neighborhood || '' });
    } else {
      const { data } = await supabase.from('contacts').select('*').eq('id', id).single();
      if (data) setSheetData({ ...defaultSheetData, id: data.id, name: data.full_name, phone: data.phone || '', email: data.email || '', city: data.city || '', state: data.state || '', notes: data.notes || '', instagram: data.instagram_username || '', neighborhood: data.neighborhood || '' });
    }
    setSheetOpen(true);
  };

  const openEditSheet = () => {
    setSheetMode('edit');
  };

  const saveSheetEntity = async () => {
    if (!sheetData.name.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }
    setSavingSheet(true);
    try {
      if (sheetType === 'lead') {
        const payload = {
          lead_name: sheetData.name.trim(),
          lead_phone: sheetData.phone || null,
          lead_email: sheetData.email || null,
          city: sheetData.city || null,
          state: sheetData.state || null,
          notes: sheetData.notes || null,
          source: sheetData.source || null,
          acolhedor: sheetData.acolhedor || null,
          group_link: sheetData.group_link || null,
          accident_date: sheetData.accident_date || null,
          victim_name: sheetData.victim_name || null,
          main_company: sheetData.main_company || null,
          contractor_company: sheetData.contractor_company || null,
          legal_viability: sheetData.legal_viability || null,
          neighborhood: sheetData.neighborhood || null,
        };
        if (sheetMode === 'create') {
          const { data, error } = await supabase
            .from('leads')
            .insert(payload)
            .select('id, lead_name, city, state')
            .single();
          if (error) throw error;
          setLocalLeads(prev => [...prev, data]);
          setEditData(prev => ({ ...prev, linkType: 'lead', linkId: data.id }));
          toast.success('Lead criado!');
        } else {
          const { error } = await supabase
            .from('leads')
            .update(payload)
            .eq('id', sheetData.id);
          if (error) throw error;
          setLocalLeads(prev => prev.map(l => l.id === sheetData.id ? { ...l, lead_name: sheetData.name, city: sheetData.city, state: sheetData.state } : l));
          toast.success('Lead atualizado!');
        }
      } else {
        const payload = {
          full_name: sheetData.name.trim(),
          phone: sheetData.phone || null,
          email: sheetData.email || null,
          city: sheetData.city || null,
          state: sheetData.state || null,
          instagram_username: sheetData.instagram || null,
          notes: sheetData.notes || null,
          neighborhood: sheetData.neighborhood || null,
        };
        if (sheetMode === 'create') {
          const { data, error } = await supabase
            .from('contacts')
            .insert(payload)
            .select('id, full_name, city, state')
            .single();
          if (error) throw error;
          setLocalContacts(prev => [...prev, data]);
          setEditData(prev => ({ ...prev, linkType: 'contact', linkId: data.id }));
          toast.success('Contato criado!');
        } else {
          const { error } = await supabase
            .from('contacts')
            .update(payload)
            .eq('id', sheetData.id);
          if (error) throw error;
          setLocalContacts(prev => prev.map(c => c.id === sheetData.id ? { ...c, full_name: sheetData.name, city: sheetData.city, state: sheetData.state } : c));
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
      const card = selectedTxs[0]?.card_last_digits;
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

      const link = `${window.location.origin}/expense-form/${data.token}`;
      
      await navigator.clipboard.writeText(link);
      toast.success('Link do formulário copiado!');
      setSelectedIds(new Set());
    } catch (err: any) {
      toast.error('Erro ao gerar link: ' + err.message);
    } finally {
      setGeneratingLink(false);
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
      notes: '',
      manualState: override?.manual_state || transaction.merchant_state || '',
      manualCity: override?.manual_city || transaction.merchant_city || ''
    });
    
    if (override?.manual_state || transaction.merchant_state) {
      fetchCities(override?.manual_state || transaction.merchant_state || '');
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
      manualCity: ''
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
        linkAcknowledged
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
            <Link2 className="h-3.5 w-3.5" />
            Gerar Link
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
      
      {/* Select all */}
      <div className="flex items-center gap-2 mb-2 px-1">
        <Checkbox
          checked={selectedIds.size === transactions.length && transactions.length > 0}
          onCheckedChange={toggleSelectAll}
        />
        <span className="text-xs text-muted-foreground">Selecionar todas</span>
      </div>

      <ScrollArea className="h-[calc(100vh-400px)]">
        <div className="space-y-2 pr-4">
          {transactions.map((transaction) => {
          const isEditing = editingId === transaction.id;
          const isExpanded = expandedId === transaction.id || isEditing;
          const override = getTransactionOverride(transaction.id);
          const isPending = !override || (!override.lead_id && !override.contact_id);
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
                  <span className="w-12">{format(new Date(transaction.transaction_date), "dd/MM", { locale: ptBR })}</span>
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
                      <div className="space-y-1">
                        <label className="text-xs font-medium">Categoria</label>
                        <div className="flex flex-wrap gap-1">
                          {parentCategories.map(cat => (
                            <Button
                              key={cat.id}
                              variant={editData.categoryId === cat.id ? 'default' : 'outline'}
                              size="sm"
                              onClick={() => setEditData(prev => ({ ...prev, categoryId: cat.id }))}
                              className="h-7 text-xs gap-1"
                            >
                              <div className={cn("w-2 h-2 rounded", cat.color)} />
                              {cat.name}
                            </Button>
                          ))}
                        </div>
                      </div>
                      
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
                      
                      {/* Notes */}
                      <div className="space-y-1">
                        <label className="text-xs font-medium">Observações</label>
                        <Input
                          value={editData.notes}
                          onChange={(e) => setEditData(prev => ({ ...prev, notes: e.target.value }))}
                          placeholder="Adicionar nota..."
                          className="h-8 text-xs"
                        />
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
                          {format(new Date(transaction.transaction_date), "dd 'de' MMMM, yyyy", { locale: ptBR })}
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
      <SheetContent className="w-[400px] sm:w-[450px]">
        <SheetHeader>
          <SheetTitle>
            {sheetMode === 'create' ? 'Criar' : sheetMode === 'edit' ? 'Editar' : 'Visualizar'}{' '}
            {sheetType === 'lead' ? 'Lead' : 'Contato'}
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-4 mt-4">
          {sheetType === 'lead' ? (
            /* ===== LEAD SHEET WITH TABS ===== */
            <>
              <Tabs value={sheetTab} onValueChange={setSheetTab}>
                <TabsList className="w-full">
                  <TabsTrigger value="basico" className="flex-1 text-xs">Básico</TabsTrigger>
                  <TabsTrigger value="acidente" className="flex-1 text-xs">Acidente</TabsTrigger>
                  <TabsTrigger value="local" className="flex-1 text-xs">Local</TabsTrigger>
                  <TabsTrigger value="empresas" className="flex-1 text-xs">Empresas</TabsTrigger>
                  <TabsTrigger value="juridico" className="flex-1 text-xs">Jurídico</TabsTrigger>
                </TabsList>

                <TabsContent value="basico" className="space-y-3 mt-3">
                  <div className="space-y-2">
                    <Label>Nome do Lead *</Label>
                    <Input value={sheetData.name} onChange={(e) => setSheetData(prev => ({ ...prev, name: e.target.value }))} placeholder="Nome do lead" disabled={sheetMode === 'view'} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Telefone</Label>
                      <Input value={sheetData.phone} onChange={(e) => setSheetData(prev => ({ ...prev, phone: e.target.value }))} placeholder="(00) 00000-0000" disabled={sheetMode === 'view'} />
                    </div>
                    <div className="space-y-2">
                      <Label>Email</Label>
                      <Input value={sheetData.email} onChange={(e) => setSheetData(prev => ({ ...prev, email: e.target.value }))} placeholder="email@exemplo.com" disabled={sheetMode === 'view'} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Origem</Label>
                      <Select value={sheetData.source} onValueChange={(v) => setSheetData(prev => ({ ...prev, source: v }))} disabled={sheetMode === 'view'}>
                        <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="manual">Manual</SelectItem>
                          <SelectItem value="instagram">Instagram</SelectItem>
                          <SelectItem value="facebook">Facebook</SelectItem>
                          <SelectItem value="indicacao">Indicação</SelectItem>
                          <SelectItem value="site">Site</SelectItem>
                          <SelectItem value="whatsapp">WhatsApp</SelectItem>
                          <SelectItem value="outro">Outro</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Acolhedor</Label>
                      <Input value={sheetData.acolhedor} onChange={(e) => setSheetData(prev => ({ ...prev, acolhedor: e.target.value }))} placeholder="Nome do acolhedor" disabled={sheetMode === 'view'} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Link do Grupo</Label>
                    <Input value={sheetData.group_link} onChange={(e) => setSheetData(prev => ({ ...prev, group_link: e.target.value }))} placeholder="https://chat.whatsapp.com/..." disabled={sheetMode === 'view'} />
                  </div>
                  <div className="space-y-2">
                    <Label>Observações</Label>
                    <Textarea value={sheetData.notes} onChange={(e) => setSheetData(prev => ({ ...prev, notes: e.target.value }))} placeholder="Notas sobre o lead..." disabled={sheetMode === 'view'} rows={3} />
                  </div>
                </TabsContent>

                <TabsContent value="acidente" className="space-y-3 mt-3">
                  <div className="space-y-2">
                    <Label>Nome da Vítima</Label>
                    <Input value={sheetData.victim_name} onChange={(e) => setSheetData(prev => ({ ...prev, victim_name: e.target.value }))} placeholder="Nome da vítima" disabled={sheetMode === 'view'} />
                  </div>
                  <div className="space-y-2">
                    <Label>Data do Acidente</Label>
                    <Input type="date" value={sheetData.accident_date} onChange={(e) => setSheetData(prev => ({ ...prev, accident_date: e.target.value }))} disabled={sheetMode === 'view'} />
                  </div>
                </TabsContent>

                <TabsContent value="local" className="space-y-3 mt-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Estado</Label>
                      <Select value={sheetData.state} onValueChange={(v) => setSheetData(prev => ({ ...prev, state: v, city: '' }))} disabled={sheetMode === 'view'}>
                        <SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger>
                        <SelectContent>
                          {states.map(s => (<SelectItem key={s.sigla} value={s.sigla}>{s.sigla} - {s.nome}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Cidade</Label>
                      <Input value={sheetData.city} onChange={(e) => setSheetData(prev => ({ ...prev, city: e.target.value }))} placeholder="Cidade" disabled={sheetMode === 'view'} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Bairro</Label>
                    <Input value={sheetData.neighborhood} onChange={(e) => setSheetData(prev => ({ ...prev, neighborhood: e.target.value }))} placeholder="Bairro" disabled={sheetMode === 'view'} />
                  </div>
                </TabsContent>

                <TabsContent value="empresas" className="space-y-3 mt-3">
                  <div className="space-y-2">
                    <Label>Empresa Principal</Label>
                    <Input value={sheetData.main_company} onChange={(e) => setSheetData(prev => ({ ...prev, main_company: e.target.value }))} placeholder="Nome da empresa" disabled={sheetMode === 'view'} />
                  </div>
                  <div className="space-y-2">
                    <Label>Empresa Contratante</Label>
                    <Input value={sheetData.contractor_company} onChange={(e) => setSheetData(prev => ({ ...prev, contractor_company: e.target.value }))} placeholder="Nome da contratante" disabled={sheetMode === 'view'} />
                  </div>
                </TabsContent>

                <TabsContent value="juridico" className="space-y-3 mt-3">
                  <div className="space-y-2">
                    <Label>Viabilidade Jurídica</Label>
                    <Select value={sheetData.legal_viability} onValueChange={(v) => setSheetData(prev => ({ ...prev, legal_viability: v }))} disabled={sheetMode === 'view'}>
                      <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="alta">Alta</SelectItem>
                        <SelectItem value="media">Média</SelectItem>
                        <SelectItem value="baixa">Baixa</SelectItem>
                        <SelectItem value="inviavel">Inviável</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </TabsContent>
              </Tabs>
            </>
          ) : (
            /* ===== CONTACT SHEET ===== */
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input value={sheetData.name} onChange={(e) => setSheetData(prev => ({ ...prev, name: e.target.value }))} placeholder="Nome completo" disabled={sheetMode === 'view'} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Telefone</Label>
                  <Input value={sheetData.phone} onChange={(e) => setSheetData(prev => ({ ...prev, phone: e.target.value }))} placeholder="(00) 00000-0000" disabled={sheetMode === 'view'} />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={sheetData.email} onChange={(e) => setSheetData(prev => ({ ...prev, email: e.target.value }))} placeholder="email@exemplo.com" disabled={sheetMode === 'view'} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Instagram</Label>
                <Input value={sheetData.instagram} onChange={(e) => setSheetData(prev => ({ ...prev, instagram: e.target.value }))} placeholder="@usuario" disabled={sheetMode === 'view'} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Estado</Label>
                  <Select value={sheetData.state} onValueChange={(v) => setSheetData(prev => ({ ...prev, state: v, city: '' }))} disabled={sheetMode === 'view'}>
                    <SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger>
                    <SelectContent>
                      {states.map(s => (<SelectItem key={s.sigla} value={s.sigla}>{s.sigla} - {s.nome}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Cidade</Label>
                  <Input value={sheetData.city} onChange={(e) => setSheetData(prev => ({ ...prev, city: e.target.value }))} placeholder="Cidade" disabled={sheetMode === 'view'} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Observações</Label>
                <Textarea value={sheetData.notes} onChange={(e) => setSheetData(prev => ({ ...prev, notes: e.target.value }))} placeholder="Notas sobre o contato..." disabled={sheetMode === 'view'} rows={3} />
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
    </div>
  );
}
