import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell,
  Legend
} from 'recharts';
import { format, startOfWeek, startOfMonth, startOfYear, parseISO, getWeek, getYear } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarDays, Calendar, CalendarRange, Clock, CreditCard, ChevronDown, X } from 'lucide-react';
import { useExpenseCategories, ExpenseCategory } from '@/hooks/useExpenseCategories';
import { useCategoryApiMappings } from '@/hooks/useCategoryApiMappings';
import { translateCategory } from '@/utils/categoryTranslations';

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

type Periodicity = 'daily' | 'weekly' | 'monthly' | 'yearly';

interface TransactionsBarChartProps {
  transactions: Transaction[];
}

export function TransactionsBarChart({ transactions }: TransactionsBarChartProps) {
  const [periodicity, setPeriodicity] = useState<Periodicity>('monthly');
  const [valueMode, setValueMode] = useState<'installment' | 'total'>('installment');
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [cardFilterOpen, setCardFilterOpen] = useState(false);
  
  const { 
    getCategoryById, 
    getTransactionOverride,
    cardAssignments,
  } = useExpenseCategories();
  
  const { findLocalCategoryByApiName } = useCategoryApiMappings();

  // Get unique cards from transactions
  const availableCards = useMemo(() => {
    const cardsMap: Record<string, { digits: string; name: string; total: number }> = {};
    
    transactions.forEach((t) => {
      if (t.card_last_digits && t.amount > 0) {
        if (!cardsMap[t.card_last_digits]) {
          const assignment = cardAssignments.find(a => a.card_last_digits === t.card_last_digits);
          cardsMap[t.card_last_digits] = {
            digits: t.card_last_digits,
            name: assignment?.card_name || `**** ${t.card_last_digits}`,
            total: 0,
          };
        }
        cardsMap[t.card_last_digits].total += t.amount;
      }
    });
    
    return Object.values(cardsMap).sort((a, b) => b.total - a.total);
  }, [transactions, cardAssignments]);

  // Filter transactions by selected cards
  const filteredTransactions = useMemo(() => {
    if (selectedCards.length === 0) return transactions;
    return transactions.filter(t => t.card_last_digits && selectedCards.includes(t.card_last_digits));
  }, [transactions, selectedCards]);

  const toggleCard = (cardDigits: string) => {
    setSelectedCards(prev => 
      prev.includes(cardDigits) 
        ? prev.filter(c => c !== cardDigits)
        : [...prev, cardDigits]
    );
  };

  const clearCardFilter = () => {
    setSelectedCards([]);
  };

  const selectAllCards = () => {
    setSelectedCards(availableCards.map(c => c.digits));
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

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const chartData = useMemo(() => {
    const groups: Record<string, { label: string; installmentTotal: number; purchaseTotal: number; count: number; sortKey: string }> = {};

    filteredTransactions.forEach((t) => {
      if (t.amount <= 0) return; // Only expenses
      
      const date = parseISO(t.transaction_date);
      let groupKey: string;
      let label: string;
      let sortKey: string;

      switch (periodicity) {
        case 'daily':
          groupKey = t.transaction_date;
          label = format(date, "dd/MM", { locale: ptBR });
          sortKey = t.transaction_date;
          break;
        case 'weekly':
          const weekStart = startOfWeek(date, { weekStartsOn: 0 });
          groupKey = format(weekStart, 'yyyy-ww');
          label = `Sem ${getWeek(date)}/${getYear(date)}`;
          sortKey = format(weekStart, 'yyyy-MM-dd');
          break;
        case 'monthly':
          groupKey = format(date, 'yyyy-MM');
          label = format(date, "MMM/yy", { locale: ptBR });
          sortKey = groupKey;
          break;
        case 'yearly':
          groupKey = format(date, 'yyyy');
          label = format(date, 'yyyy');
          sortKey = groupKey;
          break;
      }

      if (!groups[groupKey]) {
        groups[groupKey] = {
          label,
          installmentTotal: 0,
          purchaseTotal: 0,
          count: 0,
          sortKey,
        };
      }

      groups[groupKey].installmentTotal += t.amount;
      groups[groupKey].count += 1;
      
      // Calculate original purchase value for installments
      if (t.total_installments && t.total_installments > 1) {
        groups[groupKey].purchaseTotal += t.amount * t.total_installments;
      } else {
        groups[groupKey].purchaseTotal += t.amount;
      }
    });

    return Object.entries(groups)
      .sort((a, b) => a[1].sortKey.localeCompare(b[1].sortKey))
      .map(([key, data]) => ({
        name: data.label,
        valor: valueMode === 'installment' ? data.installmentTotal : data.purchaseTotal,
        installmentTotal: data.installmentTotal,
        purchaseTotal: data.purchaseTotal,
        count: data.count,
      }));
  }, [filteredTransactions, periodicity, valueMode]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-background border rounded-lg p-3 shadow-lg">
          <p className="font-medium text-sm mb-2">{label}</p>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Parcelas:</span>
              <span className="font-medium text-destructive">{formatCurrency(data.installmentTotal)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Compras (total):</span>
              <span className="font-medium text-orange-600">{formatCurrency(data.purchaseTotal)}</span>
            </div>
            <div className="flex justify-between gap-4 pt-1 border-t">
              <span className="text-muted-foreground">Transações:</span>
              <span className="font-medium">{data.count}</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  const getBarColor = () => {
    return valueMode === 'installment' ? 'hsl(var(--destructive))' : 'hsl(var(--chart-2))';
  };

  if (chartData.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Nenhuma transação encontrada para o período selecionado.
        </CardContent>
      </Card>
    );
  }

  const formatCurrencyShort = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-lg">Gastos por Período</CardTitle>
            <div className="flex flex-col sm:flex-row gap-2">
              {/* Value Mode */}
              <ToggleGroup type="single" value={valueMode} onValueChange={(v) => v && setValueMode(v as typeof valueMode)} size="sm">
                <ToggleGroupItem value="installment" aria-label="Valor da parcela">
                  Parcelas
                </ToggleGroupItem>
                <ToggleGroupItem value="total" aria-label="Valor total da compra">
                  Compras
                </ToggleGroupItem>
              </ToggleGroup>
              
              {/* Periodicity */}
              <ToggleGroup type="single" value={periodicity} onValueChange={(v) => v && setPeriodicity(v as Periodicity)} size="sm">
                <ToggleGroupItem value="daily" aria-label="Diário">
                  <Clock className="h-4 w-4 mr-1" />
                  Dia
                </ToggleGroupItem>
                <ToggleGroupItem value="weekly" aria-label="Semanal">
                  <CalendarDays className="h-4 w-4 mr-1" />
                  Semana
                </ToggleGroupItem>
                <ToggleGroupItem value="monthly" aria-label="Mensal">
                  <Calendar className="h-4 w-4 mr-1" />
                  Mês
                </ToggleGroupItem>
                <ToggleGroupItem value="yearly" aria-label="Anual">
                  <CalendarRange className="h-4 w-4 mr-1" />
                  Ano
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
          
          {/* Card Filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <Popover open={cardFilterOpen} onOpenChange={setCardFilterOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <CreditCard className="h-4 w-4" />
                  {selectedCards.length === 0 
                    ? 'Todos os cartões' 
                    : selectedCards.length === 1 
                      ? availableCards.find(c => c.digits === selectedCards[0])?.name || `**** ${selectedCards[0]}`
                      : `${selectedCards.length} cartões`
                  }
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-0" align="start">
                <div className="p-3 border-b">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Filtrar por Cartão</span>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={selectAllCards} className="h-7 text-xs">
                        Todos
                      </Button>
                      <Button variant="ghost" size="sm" onClick={clearCardFilter} className="h-7 text-xs">
                        Limpar
                      </Button>
                    </div>
                  </div>
                </div>
                <ScrollArea className="max-h-64">
                  <div className="p-2 space-y-1">
                    {availableCards.map((card) => (
                      <div 
                        key={card.digits}
                        className="flex items-center gap-2 p-2 rounded hover:bg-muted cursor-pointer"
                        onClick={() => toggleCard(card.digits)}
                      >
                        <Checkbox 
                          checked={selectedCards.includes(card.digits)}
                          onCheckedChange={() => toggleCard(card.digits)}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{card.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatCurrencyShort(card.total)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </PopoverContent>
            </Popover>
            
            {/* Selected cards badges */}
            {selectedCards.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                {selectedCards.slice(0, 3).map(digits => {
                  const card = availableCards.find(c => c.digits === digits);
                  return (
                    <Badge key={digits} variant="secondary" className="gap-1">
                      {card?.name || `**** ${digits}`}
                      <X 
                        className="h-3 w-3 cursor-pointer hover:text-destructive" 
                        onClick={() => toggleCard(digits)}
                      />
                    </Badge>
                  );
                })}
                {selectedCards.length > 3 && (
                  <Badge variant="outline">+{selectedCards.length - 3}</Badge>
                )}
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis 
                dataKey="name" 
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                className="fill-muted-foreground"
                angle={chartData.length > 10 ? -45 : 0}
                textAnchor={chartData.length > 10 ? "end" : "middle"}
                height={chartData.length > 10 ? 60 : 30}
              />
              <YAxis 
                tickFormatter={(value) => `R$${(value / 1000).toFixed(0)}k`}
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                className="fill-muted-foreground"
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar 
                dataKey="valor" 
                radius={[4, 4, 0, 0]}
                maxBarSize={50}
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={getBarColor()} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        
        {/* Summary below chart */}
        <div className="mt-4 pt-4 border-t grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Total Parcelas</p>
            <p className="text-lg font-bold text-destructive">
              {formatCurrency(chartData.reduce((sum, d) => sum + d.installmentTotal, 0))}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Total Compras</p>
            <p className="text-lg font-bold text-orange-600">
              {formatCurrency(chartData.reduce((sum, d) => sum + d.purchaseTotal, 0))}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Média por Período</p>
            <p className="text-lg font-bold">
              {formatCurrency(chartData.reduce((sum, d) => sum + (valueMode === 'installment' ? d.installmentTotal : d.purchaseTotal), 0) / chartData.length || 0)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Transações</p>
            <p className="text-lg font-bold">
              {chartData.reduce((sum, d) => sum + d.count, 0)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
