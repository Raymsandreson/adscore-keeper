import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';
import { format, startOfWeek, startOfMonth, endOfMonth, parseISO, getWeek, getYear, startOfYear, endOfYear, startOfDay, endOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarDays, Calendar, CalendarRange, Clock } from 'lucide-react';
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
  onPeriodSelect?: (startDate: Date, endDate: Date) => void;
}

export function TransactionsBarChart({ transactions, onPeriodSelect }: TransactionsBarChartProps) {
  const [periodicity, setPeriodicity] = useState<Periodicity>('monthly');
  const [valueMode, setValueMode] = useState<'installment' | 'total'>('installment');
  const [selectedBar, setSelectedBar] = useState<string | null>(null);
  
  const { 
    getCategoryById, 
    getTransactionOverride,
  } = useExpenseCategories();
  
  const { findLocalCategoryByApiName } = useCategoryApiMappings();

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
    const groups: Record<string, { 
      label: string; 
      installmentTotal: number; 
      purchaseTotal: number; 
      count: number; 
      sortKey: string;
      startDate: Date;
      endDate: Date;
    }> = {};

    transactions.forEach((t) => {
      if (t.amount <= 0) return; // Only expenses
      
      const date = parseISO(t.transaction_date);
      let groupKey: string;
      let label: string;
      let sortKey: string;
      let startDate: Date;
      let endDate: Date;

      switch (periodicity) {
        case 'daily':
          groupKey = t.transaction_date;
          label = format(date, "dd/MM", { locale: ptBR });
          sortKey = t.transaction_date;
          startDate = startOfDay(date);
          endDate = endOfDay(date);
          break;
        case 'weekly':
          const weekStart = startOfWeek(date, { weekStartsOn: 0 });
          groupKey = format(weekStart, 'yyyy-ww');
          label = `Sem ${getWeek(date)}/${getYear(date)}`;
          sortKey = format(weekStart, 'yyyy-MM-dd');
          startDate = weekStart;
          endDate = new Date(weekStart);
          endDate.setDate(endDate.getDate() + 6);
          break;
        case 'monthly':
          groupKey = format(date, 'yyyy-MM');
          label = format(date, "MMM/yy", { locale: ptBR });
          sortKey = groupKey;
          startDate = startOfMonth(date);
          endDate = endOfMonth(date);
          break;
        case 'yearly':
          groupKey = format(date, 'yyyy');
          label = format(date, 'yyyy');
          sortKey = groupKey;
          startDate = startOfYear(date);
          endDate = endOfYear(date);
          break;
      }

      if (!groups[groupKey]) {
        groups[groupKey] = {
          label,
          installmentTotal: 0,
          purchaseTotal: 0,
          count: 0,
          sortKey,
          startDate,
          endDate,
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
        key,
        name: data.label,
        valor: valueMode === 'installment' ? data.installmentTotal : data.purchaseTotal,
        installmentTotal: data.installmentTotal,
        purchaseTotal: data.purchaseTotal,
        count: data.count,
        startDate: data.startDate,
        endDate: data.endDate,
      }));
  }, [transactions, periodicity, valueMode]);

  const handleBarClick = (data: any) => {
    if (data && data.activePayload && data.activePayload[0]) {
      const payload = data.activePayload[0].payload;
      setSelectedBar(payload.key);
      if (onPeriodSelect) {
        onPeriodSelect(payload.startDate, payload.endDate);
      }
    }
  };

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
          <p className="text-xs text-muted-foreground mt-2">Clique para selecionar este período</p>
        </div>
      );
    }
    return null;
  };

  const getBarColor = (key: string) => {
    if (selectedBar === key) {
      return 'hsl(var(--primary))';
    }
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
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart 
              data={chartData} 
              margin={{ top: 10, right: 10, left: 10, bottom: 20 }}
              onClick={handleBarClick}
              style={{ cursor: 'pointer' }}
            >
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
                  <Cell 
                    key={`cell-${index}`} 
                    fill={getBarColor(entry.key)} 
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                  />
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