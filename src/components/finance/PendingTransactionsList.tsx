import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  Building2
} from 'lucide-react';
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
    <ScrollArea className="h-[calc(100vh-350px)]">
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
            const lead = leads.find(l => l.id === override.lead_id);
            linkedName = lead?.lead_name || '';
          } else if (override?.contact_id) {
            const contact = contacts.find(c => c.id === override.contact_id);
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
                          <label className="text-xs font-medium">
                            {editData.linkType === 'lead' ? 'Lead' : 'Contato'}
                          </label>
                          <Select
                            value={editData.linkId || ''}
                            onValueChange={(v) => setEditData(prev => ({ ...prev, linkId: v }))}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Selecione..." />
                            </SelectTrigger>
                            <SelectContent>
                              {/* None option with distinct styling */}
                              <SelectItem value={NONE_SELECTED} className="text-amber-600 dark:text-amber-400 font-medium italic">
                                <div className="flex items-center gap-2">
                                  <X className="h-3 w-3" />
                                  Nenhum {editData.linkType === 'lead' ? 'Lead' : 'Contato'} Vinculado
                                </div>
                              </SelectItem>
                              {editData.linkType === 'lead' 
                                ? leads.map(lead => (
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
                                : contacts.map(contact => (
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
  );
}
