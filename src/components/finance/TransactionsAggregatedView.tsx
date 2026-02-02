import { useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  ChevronDown, 
  ChevronRight, 
  Tag, 
  CreditCard,
  Users,
  MapPin,
  Map,
  CalendarDays,
  Calendar,
  Building2,
  AlertTriangle,
  UserCircle,
  Contact,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  DollarSign,
  Hash,
  Receipt,
  ShoppingCart,
  BarChart3,
  List
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useExpenseCategories, ExpenseCategory } from '@/hooks/useExpenseCategories';
import { useCategoryApiMappings } from '@/hooks/useCategoryApiMappings';
import { useLeads } from '@/hooks/useLeads';
import { useContacts } from '@/hooks/useContacts';
import { TransactionCategorizer } from './TransactionCategorizer';
import { translateCategory } from '@/utils/categoryTranslations';
import { AggregationType } from './TransactionAggregationSelector';
import { TransactionsBarChart } from './TransactionsBarChart';

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
  installment_number?: number | null;
  total_installments?: number | null;
  original_purchase_date?: string | null;
  purchase_group_id?: string | null;
}

interface GroupData {
  label: string;
  sublabel?: string;
  icon: string;
  transactions: Transaction[];
  total: number;
  totalOriginal: number;
}

interface TransactionsAggregatedViewProps {
  transactions: Transaction[];
  aggregationType: AggregationType;
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  tag: Tag,
  card: CreditCard,
  users: Users,
  userCircle: UserCircle,
  contact: Contact,
  mapPin: MapPin,
  map: Map,
  calendarDays: CalendarDays,
  calendar: Calendar,
};

export function TransactionsAggregatedView({ transactions, aggregationType }: TransactionsAggregatedViewProps) {
  const { 
    categories, 
    cardAssignments, 
    overrides,
    getCategoryById, 
    getCardAssignment,
    getTransactionOverride,
    checkLimitViolation 
  } = useExpenseCategories();
  
  const { mappings, findLocalCategoryByApiName } = useCategoryApiMappings();
  const { leads, fetchLeads } = useLeads();
  const { contacts, fetchContacts } = useContacts();
  
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [sortField, setSortField] = useState<'total' | 'date' | 'count'>('date');
  const [valueMode, setValueMode] = useState<'installment' | 'total'>('installment');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Fetch leads and contacts when needed
  useEffect(() => {
    if (aggregationType === 'lead' || aggregationType === 'contact') {
      fetchLeads();
      fetchContacts();
    }
  }, [aggregationType, fetchLeads, fetchContacts]);

  // Create lookup maps for leads and contacts
  const leadsMap = useMemo(() => {
    const map: Record<string, string> = {};
    leads.forEach(l => {
      map[l.id] = l.lead_name || l.instagram_username || 'Lead sem nome';
    });
    return map;
  }, [leads]);

  const contactsMap = useMemo(() => {
    const map: Record<string, string> = {};
    contacts.forEach(c => {
      map[c.id] = c.full_name;
    });
    return map;
  }, [contacts]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const getTransactionCategory = (transaction: Transaction): ExpenseCategory | null => {
    const override = getTransactionOverride(transaction.id);
    if (override) {
      return getCategoryById(override.category_id) || null;
    }
    
    if (transaction.category) {
      const translatedCategory = translateCategory(transaction.category);
      const categoryId = findLocalCategoryByApiName(translatedCategory);
      if (categoryId) {
        return getCategoryById(categoryId) || null;
      }
      const categoryIdOriginal = findLocalCategoryByApiName(transaction.category);
      if (categoryIdOriginal) {
        return getCategoryById(categoryIdOriginal) || null;
      }
    }
    
    return null;
  };

  // Get lead ID and name for a transaction (from override)
  const getLeadForTransaction = (transaction: Transaction): { id: string | null; name: string | null } => {
    const override = getTransactionOverride(transaction.id);
    if (override?.lead_id) {
      const leadName = leadsMap[override.lead_id] || null;
      return { id: override.lead_id, name: leadName };
    }
    return { id: null, name: null };
  };

  // Get contact ID and name for a transaction (from override)
  const getContactForTransaction = (transaction: Transaction): { id: string | null; name: string | null } => {
    const override = getTransactionOverride(transaction.id);
    if (override?.contact_id) {
      const contactName = contactsMap[override.contact_id] || null;
      return { id: override.contact_id, name: contactName };
    }
    return { id: null, name: null };
  };

  const groupedData = useMemo(() => {
    const groups: Record<string, GroupData> = {};

    transactions.forEach((t) => {
      let groupKey: string;
      let label: string;
      let sublabel: string | undefined;
      let icon: string;

      switch (aggregationType) {
        case 'card': {
          groupKey = t.card_last_digits || 'unknown';
          const assignment = getCardAssignment(groupKey);
          label = assignment?.card_name || `**** ${groupKey}`;
          sublabel = assignment?.lead_name || undefined;
          icon = 'card';
          break;
        }
        case 'lead': {
          const leadInfo = getLeadForTransaction(t);
          groupKey = leadInfo.id || 'sem-lead';
          label = leadInfo.name || 'Sem Lead Vinculado';
          icon = 'userCircle';
          break;
        }
        case 'contact': {
          const contactInfo = getContactForTransaction(t);
          groupKey = contactInfo.id || 'sem-contact';
          label = contactInfo.name || 'Sem Contato Vinculado';
          icon = 'contact';
          break;
        }
        case 'city': {
          groupKey = t.merchant_city || 'sem-cidade';
          label = t.merchant_city || 'Cidade não informada';
          sublabel = t.merchant_state || undefined;
          icon = 'mapPin';
          break;
        }
        case 'state': {
          groupKey = t.merchant_state || 'sem-estado';
          label = t.merchant_state || 'Estado não informado';
          icon = 'map';
          break;
        }
        case 'day': {
          groupKey = t.transaction_date;
          label = format(new Date(t.transaction_date + 'T12:00:00'), "EEEE, dd 'de' MMMM", { locale: ptBR });
          icon = 'calendarDays';
          break;
        }
        case 'month': {
          const date = new Date(t.transaction_date + 'T12:00:00');
          groupKey = format(date, 'yyyy-MM');
          label = format(date, "MMMM 'de' yyyy", { locale: ptBR });
          icon = 'calendar';
          break;
        }
        case 'category': {
          const category = getTransactionCategory(t);
          groupKey = category?.id || 'sem-categoria';
          label = category?.name || translateCategory(t.category) || 'Sem Categoria';
          icon = 'tag';
          break;
        }
        default:
          groupKey = 'unknown';
          label = 'Desconhecido';
          icon = 'tag';
      }

      if (!groups[groupKey]) {
        groups[groupKey] = {
          label,
          sublabel,
          icon,
          transactions: [],
          total: 0,
          totalOriginal: 0,
        };
      }
      groups[groupKey].transactions.push(t);
      // Credit card expenses come as positive values from Pluggy - only sum expenses
      if (t.amount > 0) {
        groups[groupKey].total += t.amount;
        
        // For total original value, calculate based on installments
        if (t.total_installments && t.total_installments > 1) {
          // This is an installment - calculate original purchase value
          const originalValue = t.amount * t.total_installments;
          groups[groupKey].totalOriginal += originalValue;
        } else {
          // Single payment - same as installment value
          groups[groupKey].totalOriginal += t.amount;
        }
      }
    });

    // Sort based on selected field and direction
    const entries = Object.entries(groups);
    
    return entries.sort((a, b) => {
      let comparison = 0;
      
      switch (sortField) {
        case 'total':
          // Sort by the value mode currently selected
          const aValue = valueMode === 'installment' ? a[1].total : a[1].totalOriginal;
          const bValue = valueMode === 'installment' ? b[1].total : b[1].totalOriginal;
          comparison = aValue - bValue;
          break;
        case 'count':
          comparison = a[1].transactions.length - b[1].transactions.length;
          break;
        case 'date':
          // For date-based aggregations, sort by the group key (which is a date string)
          if (aggregationType === 'day' || aggregationType === 'month') {
            comparison = a[0].localeCompare(b[0]);
          } else {
            // For non-date aggregations, sort alphabetically by label
            comparison = a[1].label.localeCompare(b[1].label);
          }
          break;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [transactions, aggregationType, getCardAssignment, getTransactionCategory, getLeadForTransaction, getContactForTransaction, sortField, sortDirection, valueMode]);

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };

  const getGroupIcon = (iconName: string) => {
    switch (iconName) {
      case 'card': return CreditCard;
      case 'users': return Users;
      case 'userCircle': return UserCircle;
      case 'contact': return Contact;
      case 'mapPin': return MapPin;
      case 'map': return Map;
      case 'calendarDays': return CalendarDays;
      case 'calendar': return Calendar;
      default: return Tag;
    }
  };

  const toggleSortDirection = () => {
    setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
  };

  const [viewMode, setViewMode] = useState<'list' | 'chart'>('list');

  return (
    <>
      <div className="space-y-4">
        {/* View Mode Toggle */}
        <div className="flex items-center justify-between">
          <ToggleGroup type="single" value={viewMode} onValueChange={(v) => v && setViewMode(v as typeof viewMode)} size="sm">
            <ToggleGroupItem value="list" aria-label="Visualização em lista">
              <List className="h-4 w-4 mr-1" />
              Lista
            </ToggleGroupItem>
            <ToggleGroupItem value="chart" aria-label="Visualização em gráfico">
              <BarChart3 className="h-4 w-4 mr-1" />
              Gráfico
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {viewMode === 'chart' ? (
          <TransactionsBarChart transactions={transactions} />
        ) : (
          <>
        {/* Controls */}
        <div className="flex flex-col gap-3">
          {/* Value Mode Toggle */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Exibir valor:</span>
            <ToggleGroup type="single" value={valueMode} onValueChange={(v) => v && setValueMode(v as typeof valueMode)} size="sm">
              <ToggleGroupItem value="installment" aria-label="Valor da parcela">
                <Receipt className="h-4 w-4 mr-1" />
                Parcela
              </ToggleGroupItem>
              <ToggleGroupItem value="total" aria-label="Valor total da compra">
                <ShoppingCart className="h-4 w-4 mr-1" />
                Compra Total
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          
          {/* Sorting Controls */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Ordenar por:</span>
              <ToggleGroup type="single" value={sortField} onValueChange={(v) => v && setSortField(v as typeof sortField)} size="sm">
                <ToggleGroupItem value="date" aria-label="Ordenar por data/nome">
                  <CalendarDays className="h-4 w-4 mr-1" />
                  {aggregationType === 'day' || aggregationType === 'month' ? 'Data' : 'Nome'}
                </ToggleGroupItem>
                <ToggleGroupItem value="total" aria-label="Ordenar por valor">
                  <DollarSign className="h-4 w-4 mr-1" />
                  Valor
                </ToggleGroupItem>
                <ToggleGroupItem value="count" aria-label="Ordenar por quantidade">
                  <Hash className="h-4 w-4 mr-1" />
                  Qtd
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            
            <Button
              variant="outline"
              size="sm"
              onClick={toggleSortDirection}
              className="gap-1"
            >
              {sortDirection === 'asc' ? (
                <>
                  <ArrowUp className="h-4 w-4" />
                  Crescente
                </>
              ) : (
                <>
                  <ArrowDown className="h-4 w-4" />
                  Decrescente
                </>
              )}
            </Button>
          </div>
        </div>
        {groupedData.map(([groupKey, data]) => {
          const isExpanded = expandedGroups.has(groupKey);
          const GroupIcon = getGroupIcon(data.icon);
          
          return (
            <Card key={groupKey}>
              <Collapsible open={isExpanded} onOpenChange={() => toggleGroup(groupKey)}>
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {isExpanded ? (
                          <ChevronDown className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        )}
                        <div className="p-2 rounded-lg bg-muted">
                          <GroupIcon className="h-5 w-5" />
                        </div>
                        <div>
                          <CardTitle className="text-lg capitalize">
                            {data.label}
                          </CardTitle>
                          {data.sublabel && (
                            <p className="text-sm text-muted-foreground">
                              {data.sublabel}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold text-destructive">
                          {formatCurrency(valueMode === 'installment' ? data.total : data.totalOriginal)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {data.transactions.length} transações
                          {valueMode === 'total' && data.totalOriginal !== data.total && (
                            <span className="ml-1">(parcelas: {formatCurrency(data.total)})</span>
                          )}
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <CardContent className="pt-0">
                    <ScrollArea className="max-h-96">
                      <div className="space-y-1">
                        {data.transactions
                          .sort((a, b) => new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime())
                          .map((t) => {
                            const category = getTransactionCategory(t);
                            const override = getTransactionOverride(t.id);
                            const violation = category ? checkLimitViolation(category, t.amount) : null;

                            return (
                              <div
                                key={t.id}
                                className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer group"
                                onClick={() => setSelectedTransaction(t)}
                              >
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                  {category ? (
                                    <div className={`p-1.5 rounded ${category.color} text-white shrink-0`}>
                                      <Tag className="h-3.5 w-3.5" />
                                    </div>
                                  ) : (
                                    <div className="p-1.5 rounded bg-muted shrink-0">
                                      <Tag className="h-3.5 w-3.5" />
                                    </div>
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium truncate">
                                      {t.description || t.merchant_name || 'Transação'}
                                    </p>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-xs text-muted-foreground">
                                        {format(new Date(t.transaction_date + 'T12:00:00'), 'dd/MM/yyyy')}
                                      </span>
                                      {t.merchant_cnpj && (
                                        <span className="text-xs text-muted-foreground flex items-center gap-1 font-mono">
                                          <Building2 className="h-3 w-3" />
                                          {t.merchant_cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}
                                        </span>
                                      )}
                                      {category && (
                                        <Badge variant="outline" className="text-xs">
                                          {category.name}
                                        </Badge>
                                      )}
                                      {override?.lead_id && (
                                        <Badge variant="secondary" className="text-xs">
                                          Vinculado
                                        </Badge>
                                      )}
                                      {violation && (
                                        <Badge variant="destructive" className="text-xs">
                                          <AlertTriangle className="h-3 w-3 mr-1" />
                                          Excede limite
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <div className="text-right shrink-0 ml-2">
                                  <p className={`font-medium ${t.amount < 0 ? 'text-green-600' : 'text-destructive'}`}>
                                    {formatCurrency(t.amount > 0 ? -t.amount : t.amount)}
                                  </p>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedTransaction(t);
                                    }}
                                  >
                                    Categorizar
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          );
        })}

        {groupedData.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Nenhuma transação encontrada para o período selecionado.
            </CardContent>
          </Card>
        )}
          </>
        )}
      </div>

      {selectedTransaction && (
        <TransactionCategorizer
          transaction={selectedTransaction}
          open={!!selectedTransaction}
          onOpenChange={(open) => !open && setSelectedTransaction(null)}
        />
      )}
    </>
  );
}
