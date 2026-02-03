import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  CreditCard, 
  ChevronDown, 
  ChevronRight, 
  Tag, 
  AlertTriangle,
  Calendar,
  Utensils,
  Car,
  Bed,
  Fuel,
  Plane,
  Briefcase,
  Package,
  MapPin,
  Building2,
  Layers,
  Clock
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useExpenseCategories, ExpenseCategory } from '@/hooks/useExpenseCategories';
import { useCategoryApiMappings } from '@/hooks/useCategoryApiMappings';
import { TransactionCategorizer } from './TransactionCategorizer';
import { translateCategory } from '@/utils/categoryTranslations';

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
  installment_number: number | null;
  total_installments: number | null;
  original_purchase_date: string | null;
  purchase_group_id: string | null;
}

interface TransactionsGroupedByCardProps {
  transactions: Transaction[];
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

export function TransactionsGroupedByCard({ transactions }: TransactionsGroupedByCardProps) {
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
  
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const groupedByCard = useMemo(() => {
    const groups: Record<string, {
      transactions: Transaction[];
      total: number;
      assignment: ReturnType<typeof getCardAssignment>;
      byDate: Record<string, Transaction[]>;
    }> = {};

    transactions.forEach((t) => {
      const cardKey = t.card_last_digits || 'unknown';
      if (!groups[cardKey]) {
        groups[cardKey] = {
          transactions: [],
          total: 0,
          assignment: getCardAssignment(cardKey),
          byDate: {},
        };
      }
      groups[cardKey].transactions.push(t);
      groups[cardKey].total += Math.abs(t.amount);

      const dateKey = t.transaction_date;
      if (!groups[cardKey].byDate[dateKey]) {
        groups[cardKey].byDate[dateKey] = [];
      }
      groups[cardKey].byDate[dateKey].push(t);
    });

    return groups;
  }, [transactions, getCardAssignment]);

  const toggleCard = (card: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(card)) {
        next.delete(card);
      } else {
        next.add(card);
      }
      return next;
    });
  };

  const getTransactionCategory = (transaction: Transaction): ExpenseCategory | null => {
    // Primeiro verifica se tem override manual
    const override = getTransactionOverride(transaction.id);
    if (override) {
      return getCategoryById(override.category_id) || null;
    }
    
    // Tenta encontrar via mapeamento do banco de dados
    if (transaction.category) {
      const translatedCategory = translateCategory(transaction.category);
      
      // Busca no mapeamento do banco de dados
      const categoryId = findLocalCategoryByApiName(translatedCategory);
      if (categoryId) {
        return getCategoryById(categoryId) || null;
      }
      
      // Também tenta pelo nome original (antes da tradução)
      const categoryIdOriginal = findLocalCategoryByApiName(transaction.category);
      if (categoryIdOriginal) {
        return getCategoryById(categoryIdOriginal) || null;
      }
    }
    
    return null;
  };

  const getDisplayCategory = (transaction: Transaction): string => {
    const category = getTransactionCategory(transaction);
    if (category) return category.name;
    return translateCategory(transaction.category);
  };

  return (
    <>
      <div className="space-y-4">
        {Object.entries(groupedByCard).map(([cardDigits, data]) => {
          const isExpanded = expandedCards.has(cardDigits);
          
          return (
            <Card key={cardDigits}>
              <Collapsible open={isExpanded} onOpenChange={() => toggleCard(cardDigits)}>
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
                          <CreditCard className="h-5 w-5" />
                        </div>
                        <div>
                          <CardTitle className="text-lg">
                            {data.assignment?.card_name || `**** ${cardDigits}`}
                          </CardTitle>
                          {data.assignment?.card_name && (
                            <p className="text-xs text-muted-foreground font-mono">
                              **** {cardDigits}
                            </p>
                          )}
                          {data.assignment && (
                            <p className="text-sm text-muted-foreground">
                              {data.assignment.lead_name}
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
                      {Object.entries(data.byDate)
                        .sort(([a], [b]) => new Date(b).getTime() - new Date(a).getTime())
                        .map(([date, dayTransactions]) => (
                          <div key={date} className="mb-4">
                            <div className="flex items-center gap-2 mb-2 sticky top-0 bg-background py-1">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm font-medium">
                                {format(new Date(date), "EEEE, dd 'de' MMMM", { locale: ptBR })}
                              </span>
                              <Badge variant="outline" className="ml-auto">
                                {formatCurrency(dayTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0))}
                              </Badge>
                            </div>
                            <div className="space-y-1 pl-6">
                              {dayTransactions.map((t) => {
                                const category = getTransactionCategory(t);
                                const override = getTransactionOverride(t.id);
                                const Icon = category ? (iconMap[category.icon] || Tag) : Tag;
                                const violation = category ? checkLimitViolation(category, t.amount) : null;

                                return (
                                  <div
                                    key={t.id}
                                    className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer group"
                                    onClick={() => setSelectedTransaction(t)}
                                  >
                                    <div className="flex items-center gap-3">
                                      {category ? (
                                        <div className={`p-1.5 rounded ${category.color} text-white`}>
                                          <Icon className="h-3.5 w-3.5" />
                                        </div>
                                      ) : (
                                        <div className="p-1.5 rounded bg-muted">
                                          <Tag className="h-3.5 w-3.5" />
                                        </div>
                                      )}
                                      <div>
                                        <div className="flex items-center gap-2">
                                          <p className="text-sm font-medium">
                                            {t.description || t.merchant_name || 'Transação'}
                                          </p>
                                          {t.transaction_time && (
                                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                                              <Clock className="h-3 w-3" />
                                              {t.transaction_time.slice(0, 5)}
                                            </span>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                          {t.merchant_cnpj && (
                                            <span className="text-xs text-muted-foreground flex items-center gap-1 font-mono">
                                              <Building2 className="h-3 w-3" />
                                              {t.merchant_cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}
                                            </span>
                                          )}
                                          {(t.merchant_city || t.merchant_state) && (
                                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                                              <MapPin className="h-3 w-3" />
                                              {[t.merchant_city, t.merchant_state].filter(Boolean).join(' - ')}
                                            </span>
                                          )}
                                          <Badge variant="outline" className="text-xs">
                                            {getDisplayCategory(t)}
                                          </Badge>
                                          {t.total_installments && t.total_installments > 1 && (
                                            <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                                              <Layers className="h-3 w-3 mr-1" />
                                              {t.installment_number || '?'}/{t.total_installments}
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
                                    <div className="text-right">
                                      <p className={`font-medium ${t.amount < 0 ? 'text-destructive' : 'text-green-600'}`}>
                                        {formatCurrency(t.amount)}
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
                          </div>
                        ))}
                    </ScrollArea>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          );
        })}
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
