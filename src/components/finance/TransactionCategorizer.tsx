import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Tag,
  UserCheck,
  AlertTriangle,
  Search,
  Utensils,
  Car,
  Bed,
  Fuel,
  Plane,
  Briefcase,
  Package,
  Users,
  Building,
  MapPin,
  Clock,
  Calendar
} from 'lucide-react';
import { ExpenseCategory, useExpenseCategories } from '@/hooks/useExpenseCategories';
import { useContacts } from '@/hooks/useContacts';
import { useLeads } from '@/hooks/useLeads';
import { useBrazilianLocations } from '@/hooks/useBrazilianLocations';

interface Transaction {
  id: string;
  description: string | null;
  amount: number;
  category: string | null;
  merchant_name: string | null;
  merchant_cnpj: string | null;
  merchant_city: string | null;
  merchant_state: string | null;
  card_last_digits: string | null;
  transaction_date: string;
  transaction_time: string | null;
}

interface TransactionCategorizerProps {
  transaction: Transaction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  tag: Tag,
  utensils: Utensils,
  car: Car,
  bed: Bed,
  fuel: Fuel,
  plane: Plane,
  briefcase: Briefcase,
  package: Package,
  'car-taxi-front': Car,
};

export function TransactionCategorizer({ transaction, open, onOpenChange }: TransactionCategorizerProps) {
  const { 
    categories, 
    setTransactionOverride, 
    getTransactionOverride,
    getCategoryById,
    checkLimitViolation,
    getParentCategories,
    getSubcategories
  } = useExpenseCategories();
  const { contacts } = useContacts();
  const { leads } = useLeads();
  const { states, cities, loadingCities, fetchCities } = useBrazilianLocations();
  
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedContact, setSelectedContact] = useState<string>('');
  const [selectedLead, setSelectedLead] = useState<string>('');
  const [contactSearchTerm, setContactSearchTerm] = useState('');
  const [leadSearchTerm, setLeadSearchTerm] = useState('');
  const [notes, setNotes] = useState('');
  const [expandedParent, setExpandedParent] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'lead' | 'contact'>('lead');
  const [manualCity, setManualCity] = useState('');
  const [manualState, setManualState] = useState('');

  const existingOverride = getTransactionOverride(transaction.id);

  // Load existing override data when opening
  useEffect(() => {
    if (open && existingOverride) {
      setSelectedCategory(existingOverride.category_id || '');
      setSelectedContact(existingOverride.contact_id || '');
      setSelectedLead(existingOverride.lead_id || '');
      setNotes(existingOverride.notes || '');
      setManualCity(existingOverride.manual_city || '');
      setManualState(existingOverride.manual_state || '');
      // Load cities if we have a state
      if (existingOverride.manual_state) {
        fetchCities(existingOverride.manual_state);
      }
      // Set active tab based on what's linked
      if (existingOverride.lead_id) {
        setActiveTab('lead');
      } else if (existingOverride.contact_id) {
        setActiveTab('contact');
      }
    } else if (open) {
      // Reset when opening without override
      setSelectedCategory('');
      setSelectedContact('');
      setSelectedLead('');
      setNotes('');
      setActiveTab('lead');
      setManualCity(transaction.merchant_city || '');
      setManualState(transaction.merchant_state || '');
      // Load cities if we have a state from merchant
      if (transaction.merchant_state) {
        fetchCities(transaction.merchant_state);
      }
    }
  }, [open, existingOverride, transaction, fetchCities]);

  const filteredContacts = contacts.filter(contact => 
    contact.full_name?.toLowerCase().includes(contactSearchTerm.toLowerCase()) ||
    contact.instagram_username?.toLowerCase().includes(contactSearchTerm.toLowerCase()) ||
    contact.phone?.includes(contactSearchTerm)
  );

  const filteredLeads = leads.filter(lead => 
    lead.lead_name?.toLowerCase().includes(leadSearchTerm.toLowerCase()) ||
    lead.lead_email?.toLowerCase().includes(leadSearchTerm.toLowerCase()) ||
    lead.lead_phone?.includes(leadSearchTerm) ||
    lead.instagram_username?.toLowerCase().includes(leadSearchTerm.toLowerCase())
  );

  const handleSubmit = async () => {
    if (!selectedCategory) return;
    
    // Determine if user explicitly acknowledged no link
    const linkAcknowledged = (activeTab === 'lead' && !selectedLead) || 
                             (activeTab === 'contact' && !selectedContact);
    
    await setTransactionOverride(
      transaction.id, 
      selectedCategory, 
      selectedContact || undefined,
      selectedLead || undefined,
      notes || undefined,
      manualCity || undefined,
      manualState || undefined,
      linkAcknowledged
    );
    
    onOpenChange(false);
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const getContactDisplay = (contact: { full_name: string; instagram_username?: string | null }) => {
    return contact.full_name || contact.instagram_username || 'Sem nome';
  };

  const getLeadDisplay = (lead: { lead_name: string | null; lead_email: string | null; instagram_username: string | null }) => {
    return lead.lead_name || lead.lead_email || lead.instagram_username || 'Sem nome';
  };

  const selectedCategoryData = selectedCategory ? getCategoryById(selectedCategory) : null;
  const limitViolation = selectedCategoryData 
    ? checkLimitViolation(selectedCategoryData, transaction.amount) 
    : null;

  // Get selected lead/contact names for display
  const selectedLeadData = leads.find(l => l.id === selectedLead);
  const selectedContactData = contacts.find(c => c.id === selectedContact);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            Categorizar Transação
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Transaction Info */}
          <div className="p-3 rounded-lg bg-muted/50">
            <p className="font-medium">{transaction.description || transaction.merchant_name}</p>
            <p className="text-lg font-bold text-destructive">{formatCurrency(transaction.amount)}</p>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(transaction.transaction_date).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric'
                })}
              </span>
              {transaction.transaction_time && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {transaction.transaction_time.slice(0, 5)}
                </span>
              )}
              {transaction.card_last_digits && (
                <span>**** {transaction.card_last_digits}</span>
              )}
            </div>
          </div>

          {/* Location Section */}
          <div>
            <Label className="flex items-center gap-2 mb-2">
              <MapPin className="h-4 w-4" />
              Localização do Gasto
            </Label>
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
          </div>

          {/* Category Selection */}
          <div>
            <Label>Categoria</Label>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {getParentCategories().map((category) => {
                const Icon = iconMap[category.icon] || Tag;
                const subcategories = getSubcategories(category.id);
                const hasSubcategories = subcategories.length > 0;
                const isExpanded = expandedParent === category.id;
                const isSubcategorySelected = subcategories.some(sub => sub.id === selectedCategory);
                const isDirectlySelected = selectedCategory === category.id && !hasSubcategories;
                
                return (
                  <div key={category.id} className="contents">
                    <button
                      type="button"
                      onClick={() => {
                        if (hasSubcategories) {
                          setExpandedParent(isExpanded ? null : category.id);
                        } else {
                          setSelectedCategory(category.id);
                          setExpandedParent(null);
                        }
                      }}
                      className={`flex items-center gap-2 p-3 rounded-lg border transition-all text-left ${
                        isDirectlySelected || isSubcategorySelected
                          ? 'border-primary bg-primary/10' 
                          : isExpanded
                            ? 'border-primary/50 bg-muted/50'
                            : 'hover:bg-muted/50'
                      }`}
                    >
                      <div className={`p-1.5 rounded ${category.color} text-white`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{category.name}</p>
                        {hasSubcategories ? (
                          <p className="text-xs text-muted-foreground">
                            {subcategories.length} subcategoria{subcategories.length > 1 ? 's' : ''}
                          </p>
                        ) : category.max_limit_per_unit ? (
                          <p className="text-xs text-muted-foreground">
                            Limite: {formatCurrency(category.max_limit_per_unit)}
                          </p>
                        ) : null}
                      </div>
                      {hasSubcategories && (
                        <span className="text-xs text-muted-foreground">
                          {isExpanded ? '▼' : '▶'}
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
            
            {/* Subcategories Panel */}
            {expandedParent && (
              <div className="mt-3 p-3 rounded-lg bg-muted/30 border">
                <p className="text-xs text-muted-foreground mb-2">
                  Selecione a subcategoria:
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {getSubcategories(expandedParent).map((subcategory) => {
                    const SubIcon = iconMap[subcategory.icon] || Tag;
                    const isSelected = selectedCategory === subcategory.id;
                    return (
                      <button
                        key={subcategory.id}
                        type="button"
                        onClick={() => setSelectedCategory(subcategory.id)}
                        className={`flex items-center gap-2 p-2.5 rounded-lg border transition-all text-left ${
                          isSelected 
                            ? 'border-primary bg-primary/10' 
                            : 'hover:bg-muted/50 bg-background'
                        }`}
                      >
                        <div className={`p-1 rounded ${subcategory.color} text-white`}>
                          <SubIcon className="h-3 w-3" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{subcategory.name}</p>
                          {subcategory.max_limit_per_unit && (
                            <p className="text-xs text-muted-foreground">
                              Limite: {formatCurrency(subcategory.max_limit_per_unit)}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Limit Warning */}
          {limitViolation && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-destructive">Limite excedido!</p>
                  <p className="text-sm text-muted-foreground">
                    Gasto de {formatCurrency(limitViolation.amount)} excede o limite de{' '}
                    {formatCurrency(limitViolation.limit)} em{' '}
                    <span className="font-medium text-destructive">
                      {formatCurrency(limitViolation.diff)}
                    </span>
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Lead/Contact Selection */}
          <div>
            <Label className="flex items-center gap-2 mb-2">
              <Users className="h-4 w-4" />
              Vincular a Lead ou Contato (opcional)
            </Label>

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'lead' | 'contact')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="lead" className="gap-2">
                  <Building className="h-3.5 w-3.5" />
                  Lead
                </TabsTrigger>
                <TabsTrigger value="contact" className="gap-2">
                  <UserCheck className="h-3.5 w-3.5" />
                  Contato
                </TabsTrigger>
              </TabsList>

              <TabsContent value="lead" className="mt-3">
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar lead..."
                    value={leadSearchTerm}
                    onChange={(e) => setLeadSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <ScrollArea className="h-32 border rounded-md">
                  <div className="p-2 space-y-1">
                    <button
                      type="button"
                      className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors text-muted-foreground italic ${
                        !selectedLead ? 'bg-muted font-medium' : 'hover:bg-muted'
                      }`}
                      onClick={() => setSelectedLead('')}
                    >
                      Nenhum Lead Vinculado
                    </button>
                    {filteredLeads.map((lead) => (
                      <button
                        key={lead.id}
                        type="button"
                        className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                          selectedLead === lead.id 
                            ? 'bg-primary text-primary-foreground' 
                            : 'hover:bg-muted'
                        }`}
                        onClick={() => {
                          setSelectedLead(lead.id);
                          setSelectedContact(''); // Clear contact when selecting lead
                        }}
                      >
                        <div className="flex flex-col">
                          <span className="font-medium">{getLeadDisplay(lead)}</span>
                          {lead.city && lead.state && (
                            <span className={`text-xs ${selectedLead === lead.id ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                              {lead.city}, {lead.state}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
                {selectedLeadData && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2 p-2 bg-muted/50 rounded">
                    <MapPin className="h-4 w-4" />
                    <span>
                      Destino: {selectedLeadData.city || 'Cidade não cadastrada'}
                      {selectedLeadData.state && `, ${selectedLeadData.state}`}
                    </span>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="contact" className="mt-3">
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar contato..."
                    value={contactSearchTerm}
                    onChange={(e) => setContactSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <ScrollArea className="h-32 border rounded-md">
                  <div className="p-2 space-y-1">
                    <button
                      type="button"
                      className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors text-muted-foreground italic ${
                        !selectedContact ? 'bg-muted font-medium' : 'hover:bg-muted'
                      }`}
                      onClick={() => setSelectedContact('')}
                    >
                      Nenhum Contato Vinculado
                    </button>
                    {filteredContacts.map((contact) => (
                      <button
                        key={contact.id}
                        type="button"
                        className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                          selectedContact === contact.id 
                            ? 'bg-primary text-primary-foreground' 
                            : 'hover:bg-muted'
                        }`}
                        onClick={() => {
                          setSelectedContact(contact.id);
                          setSelectedLead(''); // Clear lead when selecting contact
                        }}
                      >
                        {getContactDisplay(contact)}
                      </button>
                    ))}
                  </div>
                </ScrollArea>
                {selectedContactData && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2 p-2 bg-muted/50 rounded">
                    <MapPin className="h-4 w-4" />
                    <span>
                      Destino: {selectedContactData.city || 'Cidade não cadastrada'}
                      {selectedContactData.state && `, ${selectedContactData.state}`}
                    </span>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>

          {/* Notes */}
          <div>
            <Label>Observações (opcional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Almoço com cliente..."
              className="mt-2"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={!selectedCategory}>
              Salvar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
