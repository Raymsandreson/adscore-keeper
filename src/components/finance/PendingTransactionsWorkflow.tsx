import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  AlertCircle, 
  CheckCircle2, 
  CreditCard, 
  ChevronRight,
  ChevronLeft,
  MapPin,
  Calendar,
  Tag,
  Loader2,
  Filter,
  X,
  List,
  LayoutGrid
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useExpenseCategories } from '@/hooks/useExpenseCategories';
import { useCategoryApiMappings } from '@/hooks/useCategoryApiMappings';
import { useLeads } from '@/hooks/useLeads';
import { useContacts } from '@/hooks/useContacts';
import { useBrazilianLocations } from '@/hooks/useBrazilianLocations';
import { translateCategory } from '@/utils/categoryTranslations';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { LeadContactSelector } from './LeadContactSelector';
import { PendingTransactionsList } from './PendingTransactionsList';

interface Transaction {
  id: string;
  pluggy_account_id: string;
  pluggy_transaction_id: string;
  description: string | null;
  amount: number;
  currency_code: string | null;
  transaction_date: string;
  category: string | null;
  payment_data: Record<string, any>;
  card_last_digits: string | null;
  merchant_name: string | null;
  merchant_cnpj: string | null;
  merchant_city: string | null;
  merchant_state: string | null;
  created_at: string;
}

interface PendingTransactionsWorkflowProps {
  transactions: Transaction[];
  onComplete?: () => void;
}

export function PendingTransactionsWorkflow({ transactions, onComplete }: PendingTransactionsWorkflowProps) {
  const { 
    categories, 
    overrides,
    setTransactionOverride,
    getTransactionOverride,
    getCategoryById,
    cardAssignments,
    getCardAssignment,
    getParentCategories,
    getSubcategories
  } = useExpenseCategories();
  
  const { findLocalCategoryByApiName } = useCategoryApiMappings();
  const { leads, fetchLeads } = useLeads();
  const { contacts, fetchContacts } = useContacts();
  const { states, cities, loadingCities, fetchCities } = useBrazilianLocations();
  
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [expandedParent, setExpandedParent] = useState<string | null>(null);
  // "NONE" means explicitly no link, null means not yet selected, string means selected ID
  const [selectedLead, setSelectedLead] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<string | null>(null);
  const NONE_SELECTED = 'NONE';
  const [linkType, setLinkType] = useState<'lead' | 'contact'>('lead');
  const [notes, setNotes] = useState('');
  const [isLookingUpLocation, setIsLookingUpLocation] = useState(false);
  const [enrichedLocation, setEnrichedLocation] = useState<{city: string; state: string} | null>(null);
  const [manualCity, setManualCity] = useState('');
  const [manualState, setManualState] = useState('');
  const [showManualLocation, setShowManualLocation] = useState(false);

  // Filter transactions that don't have a lead or contact linked
  const pendingTransactions = useMemo(() => {
    return transactions.filter(t => {
      const override = getTransactionOverride(t.id);
      return !override || (!override.lead_id && !override.contact_id);
    });
  }, [transactions, getTransactionOverride, overrides]);

  const completedCount = transactions.length - pendingTransactions.length;
  const progressPercent = transactions.length > 0 
    ? Math.round((completedCount / transactions.length) * 100) 
    : 0;

  const currentTransaction = pendingTransactions[currentIndex];

  // Pre-select category and assignment based on card assignment
  useEffect(() => {
    if (currentTransaction) {
      setSelectedCategory(null);
      setExpandedParent(null);
      setSelectedLead(null);
      setSelectedContact(null);
      setNotes('');
      setEnrichedLocation(null);
      setManualCity('');
      setManualState('');
      setShowManualLocation(false);
      
      // Try to get category from override or API mapping
      const override = getTransactionOverride(currentTransaction.id);
      if (override) {
        setSelectedCategory(override.category_id);
      } else if (currentTransaction.category) {
        const translatedCategory = translateCategory(currentTransaction.category);
        const categoryId = findLocalCategoryByApiName(translatedCategory) || 
                          findLocalCategoryByApiName(currentTransaction.category);
        if (categoryId) {
          setSelectedCategory(categoryId);
        }
      }
      
      // Pre-select lead/contact from card assignment
      const cardAssignment = getCardAssignment(currentTransaction.card_last_digits || '');
      if (cardAssignment) {
        if (cardAssignment.lead_id) {
          setSelectedLead(cardAssignment.lead_id);
          setLinkType('lead');
        } else if (cardAssignment.contact_id) {
          setSelectedContact(cardAssignment.contact_id);
          setLinkType('contact');
        }
      }
    }
  }, [currentTransaction, getTransactionOverride, findLocalCategoryByApiName, getCardAssignment]);

  // Lookup location via CNPJ
  const lookupLocation = async () => {
    if (!currentTransaction?.merchant_cnpj) return;
    
    setIsLookingUpLocation(true);
    try {
      const { data, error } = await supabase.functions.invoke('lookup-cnpj', {
        body: { cnpj: currentTransaction.merchant_cnpj }
      });
      
      if (error) throw error;
      
      if (data?.success && (data.city || data.state)) {
        setEnrichedLocation({ city: data.city, state: data.state });
        toast.success(`Localização encontrada: ${data.city} - ${data.state}`);
      } else {
        toast.info('Localização não encontrada para este CNPJ');
      }
    } catch (err) {
      console.error('Error looking up CNPJ:', err);
      toast.error('Erro ao buscar localização');
    } finally {
      setIsLookingUpLocation(false);
    }
  };

  // Get display location (enriched, manual, or from transaction)
  const displayLocation = useMemo(() => {
    if (enrichedLocation) return enrichedLocation;
    if (manualCity || manualState) {
      return { city: manualCity, state: manualState };
    }
    if (currentTransaction?.merchant_city || currentTransaction?.merchant_state) {
      return {
        city: currentTransaction.merchant_city || '',
        state: currentTransaction.merchant_state || ''
      };
    }
    return null;
  }, [enrichedLocation, manualCity, manualState, currentTransaction]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const handleSave = async () => {
    if (!currentTransaction) return;
    
    if (!selectedCategory) {
      toast.error('Selecione uma categoria');
      return;
    }
    
    // "NONE" is a valid explicit choice meaning no link
    const hasLeadSelection = linkType === 'lead' && (selectedLead === NONE_SELECTED || selectedLead);
    const hasContactSelection = linkType === 'contact' && (selectedContact === NONE_SELECTED || selectedContact);
    
    if (linkType === 'lead' && !hasLeadSelection) {
      toast.error('Selecione um Lead ou "Nenhum Lead Vinculado"');
      return;
    }
    
    if (linkType === 'contact' && !hasContactSelection) {
      toast.error('Selecione um Contato ou "Nenhum Contato Vinculado"');
      return;
    }

    try {
      // Convert "NONE" to undefined for database storage
      const leadId = selectedLead === NONE_SELECTED ? undefined : (linkType === 'lead' ? selectedLead || undefined : undefined);
      const contactId = selectedContact === NONE_SELECTED ? undefined : (linkType === 'contact' ? selectedContact || undefined : undefined);
      
      await setTransactionOverride(
        currentTransaction.id,
        selectedCategory,
        contactId,
        leadId,
        notes || undefined,
        manualCity || displayLocation?.city || undefined,
        manualState || displayLocation?.state || undefined
      );
      
      // Move to next transaction
      if (currentIndex < pendingTransactions.length - 1) {
        setCurrentIndex(prev => prev + 1);
      } else if (pendingTransactions.length <= 1) {
        toast.success('🎉 Todos os gastos foram categorizados!');
        onComplete?.();
      }
    } catch (err) {
      console.error('Error saving:', err);
    }
  };

  const handleSkip = () => {
    if (currentIndex < pendingTransactions.length - 1) {
      setCurrentIndex(prev => prev + 1);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const isAllCategorized = pendingTransactions.length === 0;

  return (
    <div className="space-y-4">
      {/* Compact Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            <span className="font-medium">
              {pendingTransactions.length} pendentes
            </span>
          </div>
          <Badge variant="secondary" className="rounded-full">
            {completedCount} / {transactions.length} vinculados
          </Badge>
        </div>
        
        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div className="flex border rounded-md">
            <Button
              variant={viewMode === 'card' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 px-3 rounded-r-none"
              onClick={() => setViewMode('card')}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 px-3 rounded-l-none"
              onClick={() => setViewMode('list')}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
      
      <Progress value={progressPercent} className="h-1.5" />

      {/* All Categorized Message */}
      {isAllCategorized && (
        <Card className="border-green-500/50 bg-green-50/50 dark:bg-green-950/20">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CheckCircle2 className="h-16 w-16 text-green-500 mb-4" />
            <h3 className="text-xl font-semibold mb-2">Tudo Categorizado!</h3>
            <p className="text-muted-foreground text-center max-w-md">
              Todos os {transactions.length} gastos foram vinculados a Leads ou Contatos.
            </p>
          </CardContent>
        </Card>
      )}
      
      {/* List View */}
      {viewMode === 'list' && !isAllCategorized && (
        <Card className="border-0 shadow-card">
          <CardContent className="py-4">
            <PendingTransactionsList
              transactions={pendingTransactions}
              leads={leads}
              contacts={contacts}
              onComplete={onComplete}
            />
          </CardContent>
        </Card>
      )}

      {/* Card View - Current Transaction */}
      {viewMode === 'card' && currentTransaction && (
        <Card className="border-0 shadow-card">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <CreditCard className="h-5 w-5" />
                  Gasto #{currentIndex + 1} de {pendingTransactions.length}
                </CardTitle>
                <CardDescription>
                  Vincule este gasto a um Lead ou Contato
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={handlePrevious}
                  disabled={currentIndex === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={handleSkip}
                  disabled={currentIndex >= pendingTransactions.length - 1}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          
          <CardContent className="space-y-4">
            {/* Transaction Details */}
            <div className="p-4 bg-muted/50 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-lg">
                  {currentTransaction.description || currentTransaction.merchant_name || 'Transação'}
                </span>
                <span className={`font-bold text-xl ${currentTransaction.amount < 0 ? 'text-destructive' : 'text-green-600'}`}>
                  {formatCurrency(currentTransaction.amount)}
                </span>
              </div>
              
              {/* Location Display - Prominent */}
              <div className="p-3 bg-background rounded-md border space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-primary" />
                    {displayLocation && !showManualLocation ? (
                      <span className="font-medium">
                        {[displayLocation.city, displayLocation.state].filter(Boolean).join(' - ')}
                      </span>
                    ) : !showManualLocation ? (
                      currentTransaction.merchant_cnpj ? (
                        <Button
                          variant="link"
                          size="sm"
                          className="p-0 h-auto text-muted-foreground"
                          onClick={lookupLocation}
                          disabled={isLookingUpLocation}
                        >
                          {isLookingUpLocation ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                              Buscando...
                            </>
                          ) : (
                            'Buscar localização via CNPJ'
                          )}
                        </Button>
                      ) : (
                        <span className="text-muted-foreground text-sm">Localização não disponível</span>
                      )
                    ) : (
                      <span className="text-muted-foreground text-sm">Cadastrar manualmente</span>
                    )}
                  </div>
                  {!displayLocation && !showManualLocation && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowManualLocation(true)}
                    >
                      Cadastrar
                    </Button>
                  )}
                  {showManualLocation && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowManualLocation(false);
                        setManualCity('');
                        setManualState('');
                      }}
                    >
                      Cancelar
                    </Button>
                  )}
                </div>
                
                {showManualLocation && (
                  <div className="flex gap-2">
                    <Select
                      value={manualState}
                      onValueChange={(value) => {
                        setManualState(value);
                        setManualCity('');
                        fetchCities(value);
                      }}
                    >
                      <SelectTrigger className="w-24">
                        <SelectValue placeholder="UF" />
                      </SelectTrigger>
                      <SelectContent>
                        {states.map((state) => (
                          <SelectItem key={state.sigla} value={state.sigla}>
                            {state.sigla}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    
                    <Select
                      value={manualCity}
                      onValueChange={setManualCity}
                      disabled={!manualState || loadingCities}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder={loadingCities ? "Carregando..." : "Cidade"} />
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
                )}
              </div>
              
              <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {format(new Date(currentTransaction.transaction_date), "dd 'de' MMMM, yyyy", { locale: ptBR })}
                </span>
                {currentTransaction.card_last_digits && (
                  <span className="flex items-center gap-1">
                    <CreditCard className="h-4 w-4" />
                    {(() => {
                      const assignment = getCardAssignment(currentTransaction.card_last_digits);
                      return assignment?.card_name 
                        ? `${assignment.card_name} (**** ${currentTransaction.card_last_digits})`
                        : `**** ${currentTransaction.card_last_digits}`;
                    })()}
                  </span>
                )}
                {currentTransaction.category && (
                  <Badge variant="outline" className="flex items-center gap-1 rounded-full">
                    <Tag className="h-3 w-3" />
                    {translateCategory(currentTransaction.category)}
                  </Badge>
                )}
              </div>
            </div>

            {/* Category Selection */}
            <div>
              <label className="text-sm font-medium mb-2 block">Categoria</label>
              <div className="border rounded-lg p-2">
                <div className="flex flex-wrap gap-2">
                  {getParentCategories().map(cat => {
                    const subcategories = getSubcategories(cat.id);
                    const hasSubcategories = subcategories.length > 0;
                    const isExpanded = expandedParent === cat.id;
                    const isSubcategorySelected = subcategories.some(sub => sub.id === selectedCategory);
                    const isDirectlySelected = selectedCategory === cat.id && !hasSubcategories;
                    
                    return (
                      <Button
                        key={cat.id}
                        variant={isDirectlySelected || isSubcategorySelected ? 'default' : isExpanded ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={() => {
                          if (hasSubcategories) {
                            setExpandedParent(isExpanded ? null : cat.id);
                          } else {
                            setSelectedCategory(cat.id);
                            setExpandedParent(null);
                          }
                        }}
                        className="gap-1 rounded-full"
                      >
                        <div className={`w-3 h-3 rounded-full ${cat.color}`} />
                        {cat.name}
                        {hasSubcategories && (
                          <span className="text-xs ml-1">{isExpanded ? '▼' : '▶'}</span>
                        )}
                      </Button>
                    );
                  })}
                </div>
                
                {/* Subcategories Panel */}
                {expandedParent && (
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-xs text-muted-foreground mb-2">
                      Selecione a subcategoria:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {getSubcategories(expandedParent).map(sub => (
                        <Button
                          key={sub.id}
                          variant={selectedCategory === sub.id ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setSelectedCategory(sub.id)}
                          className="gap-1 rounded-full"
                        >
                          <div className={`w-3 h-3 rounded-full ${sub.color}`} />
                          {sub.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Lead/Contact Selection */}
            <LeadContactSelector
              linkType={linkType}
              onLinkTypeChange={setLinkType}
              selectedLead={selectedLead}
              onSelectLead={setSelectedLead}
              selectedContact={selectedContact}
              onSelectContact={setSelectedContact}
              leads={leads}
              contacts={contacts}
              onLeadsChange={fetchLeads}
              onContactsChange={fetchContacts}
            />

            {/* Notes */}
            <div>
              <label className="text-sm font-medium mb-2 block">Observações (opcional)</label>
              <Input
                placeholder="Adicione uma nota sobre este gasto..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="rounded-xl"
              />
            </div>

            {/* Actions */}
            <div className="flex justify-between pt-4">
              <Button variant="ghost" onClick={handleSkip}>
                Pular
              </Button>
              <Button onClick={handleSave}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Salvar e Próximo
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Empty State for Card View when no pending after filters */}
      {viewMode === 'card' && pendingTransactions.length === 0 && transactions.length > 0 && !isAllCategorized && (
        <Card className="border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/10">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Filter className="h-16 w-16 text-amber-500 mb-4" />
            <h3 className="text-xl font-semibold mb-2">Nenhum gasto pendente</h3>
            <p className="text-muted-foreground text-center max-w-md">
              Com os filtros atuais, não há gastos pendentes para categorizar.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
