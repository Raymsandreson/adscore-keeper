import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
  AlertTriangle
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useExpenseCategories, ExpenseCategory } from '@/hooks/useExpenseCategories';
import { useCategoryApiMappings } from '@/hooks/useCategoryApiMappings';
import { TransactionCategorizer } from './TransactionCategorizer';
import { translateCategory } from '@/utils/categoryTranslations';
import { AggregationType } from './TransactionAggregationSelector';

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

interface TransactionsAggregatedViewProps {
  transactions: Transaction[];
  aggregationType: AggregationType;
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  tag: Tag,
  card: CreditCard,
  users: Users,
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
  
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);

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

  const getLeadForTransaction = (transaction: Transaction): string | null => {
    const override = getTransactionOverride(transaction.id);
    if (override?.lead_id) {
      // Try to get lead name from card assignment or override
      const assignment = getCardAssignment(transaction.card_last_digits || '');
      if (assignment?.lead_name) return assignment.lead_name;
    }
    
    // Try from card assignment
    const assignment = getCardAssignment(transaction.card_last_digits || '');
    return assignment?.lead_name || null;
  };

  const groupedData = useMemo(() => {
    const groups: Record<string, {
      label: string;
      sublabel?: string;
      icon: string;
      transactions: Transaction[];
      total: number;
    }> = {};

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
          const leadName = getLeadForTransaction(t);
          groupKey = leadName || 'sem-lead';
          label = leadName || 'Sem Lead Vinculado';
          icon = 'users';
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
        };
      }
      groups[groupKey].transactions.push(t);
      groups[groupKey].total += Math.abs(t.amount);
    });

    // Sort by total (descending)
    return Object.entries(groups).sort((a, b) => b[1].total - a[1].total);
  }, [transactions, aggregationType, getCardAssignment, getTransactionCategory, getLeadForTransaction]);

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
      case 'mapPin': return MapPin;
      case 'map': return Map;
      case 'calendarDays': return CalendarDays;
      case 'calendar': return Calendar;
      default: return Tag;
    }
  };

  return (
    <>
      <div className="space-y-4">
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
                          {formatCurrency(data.total)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {data.transactions.length} transações
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
