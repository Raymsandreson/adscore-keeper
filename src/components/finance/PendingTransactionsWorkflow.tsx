import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { 
  AlertCircle, 
  CheckCircle2, 
  CreditCard, 
  Search, 
  Users, 
  Briefcase,
  ChevronRight,
  ChevronLeft,
  MapPin,
  Calendar,
  Tag
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useExpenseCategories, ExpenseCategory } from '@/hooks/useExpenseCategories';
import { useCategoryApiMappings } from '@/hooks/useCategoryApiMappings';
import { useLeads } from '@/hooks/useLeads';
import { useContacts } from '@/hooks/useContacts';
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
  const { leads } = useLeads();
  const { contacts } = useContacts();
  
  const [currentIndex, setCurrentIndex] = useState(0);
  const [searchLead, setSearchLead] = useState('');
  const [searchContact, setSearchContact] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<string | null>(null);
  const [linkType, setLinkType] = useState<'lead' | 'contact'>('lead');
  const [notes, setNotes] = useState('');

  // Filter transactions that don't have a lead or contact linked
  const pendingTransactions = useMemo(() => {
    return transactions.filter(t => {
      const override = getTransactionOverride(t.id);
      // Transaction is pending if it has no override OR override has no lead/contact
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
      // Reset selections
      setSelectedCategory(null);
      setSelectedLead(null);
      setSelectedContact(null);
      setNotes('');
      setSearchLead('');
      setSearchContact('');
      
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

  const filteredLeads = useMemo(() => {
    if (!searchLead.trim()) return leads.slice(0, 10);
    const search = searchLead.toLowerCase();
    return leads.filter(l => 
      l.lead_name?.toLowerCase().includes(search) ||
      l.lead_email?.toLowerCase().includes(search) ||
      l.city?.toLowerCase().includes(search)
    ).slice(0, 10);
  }, [leads, searchLead]);

  const filteredContacts = useMemo(() => {
    if (!searchContact.trim()) return contacts.slice(0, 10);
    const search = searchContact.toLowerCase();
    return contacts.filter(c => 
      c.full_name?.toLowerCase().includes(search) ||
      c.email?.toLowerCase().includes(search) ||
      c.city?.toLowerCase().includes(search)
    ).slice(0, 10);
  }, [contacts, searchContact]);

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
        notes || undefined
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

  return (
    <div className="space-y-4">
      {/* Progress Header */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              <span className="font-medium">
                {pendingTransactions.length} gastos pendentes
              </span>
            </div>
            <Badge variant="outline">
              {completedCount} / {transactions.length} vinculados
            </Badge>
          </div>
          <Progress value={progressPercent} className="h-2" />
        </CardContent>
      </Card>

      {/* Current Transaction */}
      {currentTransaction && (
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
            <div className="p-4 bg-muted/50 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-lg">
                  {currentTransaction.description || currentTransaction.merchant_name || 'Transação'}
                </span>
                <span className={`font-bold text-xl ${currentTransaction.amount < 0 ? 'text-destructive' : 'text-green-600'}`}>
                  {formatCurrency(currentTransaction.amount)}
                </span>
              </div>
              <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {format(new Date(currentTransaction.transaction_date), "dd 'de' MMMM, yyyy", { locale: ptBR })}
                </span>
                {currentTransaction.card_last_digits && (
                  <span className="flex items-center gap-1">
                    <CreditCard className="h-4 w-4" />
                    **** {currentTransaction.card_last_digits}
                  </span>
                )}
                {(currentTransaction.merchant_city || currentTransaction.merchant_state) && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    {[currentTransaction.merchant_city, currentTransaction.merchant_state].filter(Boolean).join(' - ')}
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
            <Tabs value={linkType} onValueChange={(v) => setLinkType(v as 'lead' | 'contact')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="lead" className="gap-2">
                  <Briefcase className="h-4 w-4" />
                  Lead
                </TabsTrigger>
                <TabsTrigger value="contact" className="gap-2">
                  <Users className="h-4 w-4" />
                  Contato
                </TabsTrigger>
              </TabsList>

              <TabsContent value="lead" className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar lead por nome, email ou cidade..."
                    value={searchLead}
                    onChange={(e) => setSearchLead(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <ScrollArea className="h-40 border rounded-lg">
                  <div className="p-2 space-y-1">
                    {filteredLeads.map(lead => (
                      <div
                        key={lead.id}
                        onClick={() => setSelectedLead(lead.id)}
                        className={`p-2 rounded-lg cursor-pointer transition-colors ${
                          selectedLead === lead.id 
                            ? 'bg-primary text-primary-foreground' 
                            : 'hover:bg-muted'
                        }`}
                      >
                        <div className="font-medium">{lead.lead_name || 'Sem nome'}</div>
                        <div className="text-xs opacity-70 flex items-center gap-2">
                          {lead.city && <span>{lead.city}</span>}
                          {lead.lead_email && <span>{lead.lead_email}</span>}
                        </div>
                      </div>
                    ))}
                    {filteredLeads.length === 0 && (
                      <div className="text-center text-muted-foreground py-4">
                        Nenhum lead encontrado
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="contact" className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar contato por nome, email ou cidade..."
                    value={searchContact}
                    onChange={(e) => setSearchContact(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <ScrollArea className="h-40 border rounded-lg">
                  <div className="p-2 space-y-1">
                    {filteredContacts.map(contact => (
                      <div
                        key={contact.id}
                        onClick={() => setSelectedContact(contact.id)}
                        className={`p-2 rounded-lg cursor-pointer transition-colors ${
                          selectedContact === contact.id 
                            ? 'bg-primary text-primary-foreground' 
                            : 'hover:bg-muted'
                        }`}
                      >
                        <div className="font-medium">{contact.full_name}</div>
                        <div className="text-xs opacity-70 flex items-center gap-2">
                          {contact.city && <span>{contact.city}</span>}
                          {contact.email && <span>{contact.email}</span>}
                        </div>
                      </div>
                    ))}
                    {filteredContacts.length === 0 && (
                      <div className="text-center text-muted-foreground py-4">
                        Nenhum contato encontrado
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>

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
    </div>
  );
}
