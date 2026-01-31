import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { format, isWithinInterval, parseISO } from 'date-fns';
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
    getCardAssignment
  } = useExpenseCategories();
  
  const { findLocalCategoryByApiName } = useCategoryApiMappings();
  const { leads, fetchLeads } = useLeads();
  const { contacts, fetchContacts } = useContacts();
  const { states, cities, loadingCities, fetchCities } = useBrazilianLocations();
  
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<string | null>(null);
  const [linkType, setLinkType] = useState<'lead' | 'contact'>('lead');
  const [notes, setNotes] = useState('');
  const [isLookingUpLocation, setIsLookingUpLocation] = useState(false);
  const [enrichedLocation, setEnrichedLocation] = useState<{city: string; state: string} | null>(null);
  const [manualCity, setManualCity] = useState('');
  const [manualState, setManualState] = useState('');
  const [showManualLocation, setShowManualLocation] = useState(false);
  
  // Filtros
  const [filterStartDate, setFilterStartDate] = useState<Date | undefined>(undefined);
  const [filterEndDate, setFilterEndDate] = useState<Date | undefined>(undefined);
  const [filterCard, setFilterCard] = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterSubcategory, setFilterSubcategory] = useState<string>('all');

  // Get unique cards from transactions
  const uniqueCards = useMemo(() => {
    const cards = new Set<string>();
    transactions.forEach(t => {
      if (t.card_last_digits) cards.add(t.card_last_digits);
    });
    return Array.from(cards);
  }, [transactions]);

  // Get subcategories for selected category
  const subcategories = useMemo(() => {
    if (filterCategory === 'all') return [];
    return categories.filter(c => c.parent_id === filterCategory);
  }, [categories, filterCategory]);

  // Filter transactions that don't have a lead or contact linked AND match filters
  const pendingTransactions = useMemo(() => {
    return transactions.filter(t => {
      const override = getTransactionOverride(t.id);
      // Transaction is pending if it has no override OR override has no lead/contact
      const isPending = !override || (!override.lead_id && !override.contact_id);
      if (!isPending) return false;
      
      // Date filters
      if (filterStartDate || filterEndDate) {
        const transactionDate = parseISO(t.transaction_date);
        if (filterStartDate && transactionDate < filterStartDate) return false;
        if (filterEndDate && transactionDate > filterEndDate) return false;
      }
      
      // Card filter
      if (filterCard !== 'all' && t.card_last_digits !== filterCard) return false;
      
      // Category filter
      if (filterCategory !== 'all' || filterSubcategory !== 'all') {
        const translatedCategory = t.category ? translateCategory(t.category) : '';
        const localCategoryId = findLocalCategoryByApiName(translatedCategory) || 
                               findLocalCategoryByApiName(t.category || '');
        
        if (filterSubcategory !== 'all') {
          // Filter by subcategory
          if (localCategoryId !== filterSubcategory) return false;
        } else if (filterCategory !== 'all') {
          // Filter by parent category (include subcategories)
          const localCategory = localCategoryId ? getCategoryById(localCategoryId) : null;
          if (!localCategory) return false;
          if (localCategory.id !== filterCategory && localCategory.parent_id !== filterCategory) return false;
        }
      }
      
      return true;
    });
  }, [transactions, getTransactionOverride, overrides, filterStartDate, filterEndDate, filterCard, filterCategory, filterSubcategory, findLocalCategoryByApiName, getCategoryById]);

  const completedCount = transactions.length - pendingTransactions.length;
  const progressPercent = transactions.length > 0 
    ? Math.round((completedCount / transactions.length) * 100) 
    : 0;

  const currentTransaction = pendingTransactions[currentIndex];

  // Pre-select category and assignment based on card assignment
  useEffect(() => {
    if (currentTransaction) {
      setSelectedCategory(null);
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
    
    if (linkType === 'lead' && !selectedLead) {
      toast.error('Selecione um Lead para vincular');
      return;
    }
    
    if (linkType === 'contact' && !selectedContact) {
      toast.error('Selecione um Contato para vincular');
      return;
    }

    try {
      await setTransactionOverride(
        currentTransaction.id,
        selectedCategory,
        linkType === 'contact' ? selectedContact || undefined : undefined,
        linkType === 'lead' ? selectedLead || undefined : undefined,
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

  if (pendingTransactions.length === 0) {
    return (
      <Card className="border-green-500/50 bg-green-50/50 dark:bg-green-950/20">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <CheckCircle2 className="h-16 w-16 text-green-500 mb-4" />
          <h3 className="text-xl font-semibold mb-2">Tudo Categorizado!</h3>
          <p className="text-muted-foreground text-center max-w-md">
            Todos os {transactions.length} gastos foram vinculados a Leads ou Contatos.
          </p>
        </CardContent>
      </Card>
    );
  }

  const clearFilters = () => {
    setFilterStartDate(undefined);
    setFilterEndDate(undefined);
    setFilterCard('all');
    setFilterCategory('all');
    setFilterSubcategory('all');
    setCurrentIndex(0);
  };

  const hasActiveFilters = filterStartDate || filterEndDate || filterCard !== 'all' || filterCategory !== 'all';

  return (
    <div className="space-y-4">
      {/* Filters at Top */}
      <Card>
        <CardContent className="py-4 space-y-4">
          {/* Header Row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              <span className="font-medium">
                {pendingTransactions.length} gastos pendentes
              </span>
              <Badge variant="outline">
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
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs">
                  <X className="h-3 w-3 mr-1" />
                  Limpar
                </Button>
              )}
            </div>
          </div>
          
          <Progress value={progressPercent} className="h-2" />
          
          {/* Filters - Always Visible */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {/* Start Date */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Data Início</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "w-full justify-start text-left font-normal h-9",
                      !filterStartDate && "text-muted-foreground"
                    )}
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {filterStartDate ? format(filterStartDate, "dd/MM/yy") : "Início"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={filterStartDate}
                    onSelect={(date) => {
                      setFilterStartDate(date);
                      setCurrentIndex(0);
                    }}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            
            {/* End Date */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Data Fim</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "w-full justify-start text-left font-normal h-9",
                      !filterEndDate && "text-muted-foreground"
                    )}
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {filterEndDate ? format(filterEndDate, "dd/MM/yy") : "Fim"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={filterEndDate}
                    onSelect={(date) => {
                      setFilterEndDate(date);
                      setCurrentIndex(0);
                    }}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            
            {/* Card Filter */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Cartão</label>
              <Select 
                value={filterCard} 
                onValueChange={(v) => {
                  setFilterCard(v);
                  setCurrentIndex(0);
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {uniqueCards.map(card => {
                    const assignment = getCardAssignment(card);
                    return (
                      <SelectItem key={card} value={card}>
                        {assignment?.card_name || `**** ${card}`}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            
            {/* Category Filter */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Categoria</label>
              <Select 
                value={filterCategory} 
                onValueChange={(v) => {
                  setFilterCategory(v);
                  setFilterSubcategory('all');
                  setCurrentIndex(0);
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {categories.filter(c => !c.parent_id).map(cat => (
                    <SelectItem key={cat.id} value={cat.id}>
                      <div className="flex items-center gap-2">
                        <div className={cn("w-2 h-2 rounded-full", cat.color)} />
                        {cat.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {/* Subcategory Filter */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Subcategoria</label>
              <Select 
                value={filterSubcategory} 
                onValueChange={(v) => {
                  setFilterSubcategory(v);
                  setCurrentIndex(0);
                }}
                disabled={filterCategory === 'all' || subcategories.length === 0}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {subcategories.map(sub => (
                    <SelectItem key={sub.id} value={sub.id}>
                      {sub.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* List View */}
      {viewMode === 'list' && (
        <Card>
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
        <Card>
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
                  <Badge variant="outline" className="flex items-center gap-1">
                    <Tag className="h-3 w-3" />
                    {translateCategory(currentTransaction.category)}
                  </Badge>
                )}
              </div>
            </div>

            {/* Category Selection */}
            <div>
              <label className="text-sm font-medium mb-2 block">Categoria</label>
              <ScrollArea className="h-24 border rounded-lg p-2">
                <div className="flex flex-wrap gap-2">
                  {categories.filter(c => !c.parent_id).map(cat => (
                    <Button
                      key={cat.id}
                      variant={selectedCategory === cat.id ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSelectedCategory(cat.id)}
                      className="gap-1"
                    >
                      <div className={`w-3 h-3 rounded ${cat.color}`} />
                      {cat.name}
                    </Button>
                  ))}
                </div>
              </ScrollArea>
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
      
      {/* Empty State for Card View */}
      {viewMode === 'card' && pendingTransactions.length === 0 && (
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
    </div>
  );
}
