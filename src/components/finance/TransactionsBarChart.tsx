import { useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { format, startOfWeek, startOfMonth, endOfMonth, parseISO, getWeek, getYear, startOfYear, endOfYear, startOfDay, endOfDay, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarDays, Calendar, CalendarRange, Clock, TrendingUp } from 'lucide-react';
import { useExpenseCategories, ExpenseCategory } from '@/hooks/useExpenseCategories';
import { useCategoryApiMappings } from '@/hooks/useCategoryApiMappings';
import { useLeads } from '@/hooks/useLeads';
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
type MetricType = 'spending' | 'purchases' | 'days_traveled' | 'leads_with_expense' | 'cost_per_lead' | 'cost_per_closed_lead' | 'cac';

interface TransactionsBarChartProps {
  transactions: Transaction[];
  allTransactions?: Transaction[]; // All transactions without date filter for historical view
  onPeriodSelect?: (startDate: Date, endDate: Date) => void;
}

const metricOptions: { value: MetricType; label: string; description: string }[] = [
  { value: 'spending', label: 'Gastos (Parcelas)', description: 'Valor total das parcelas no período' },
  { value: 'purchases', label: 'Compras (Total)', description: 'Valor total das compras realizadas' },
  { value: 'days_traveled', label: 'Dias Viajados', description: 'Quantidade de dias com gastos' },
  { value: 'leads_with_expense', label: 'Leads c/ Despesa', description: 'Número de leads vinculados a despesas' },
  { value: 'cost_per_lead', label: 'Custo por Lead', description: 'Gasto total ÷ número de leads com despesa' },
  { value: 'cost_per_closed_lead', label: 'Custo por Lead Fechado', description: 'Gasto total ÷ leads fechados (clientes)' },
  { value: 'cac', label: 'CAC', description: 'Custo de Aquisição de Cliente' },
];

export function TransactionsBarChart({ transactions, allTransactions, onPeriodSelect }: TransactionsBarChartProps) {
  const [periodicity, setPeriodicity] = useState<Periodicity>('monthly');
  const [metricType, setMetricType] = useState<MetricType>('purchases');
  const [selectedBar, setSelectedBar] = useState<string | null>(null);
  
  const { 
    getCategoryById, 
    getTransactionOverride,
  } = useExpenseCategories();
  
  const { findLocalCategoryByApiName } = useCategoryApiMappings();
  const { leads } = useLeads();

  // Use allTransactions for historical view if provided, otherwise use transactions
  const chartTransactions = allTransactions || transactions;

  // Get unique leads linked to transactions via overrides
  const leadsWithExpenses = useMemo(() => {
    const leadIds = new Set<string>();
    chartTransactions.forEach(t => {
      if (t.amount > 0) {
        const override = getTransactionOverride(t.id);
        if (override?.lead_id) {
          leadIds.add(override.lead_id);
        }
      }
    });
    return leadIds;
  }, [chartTransactions, getTransactionOverride]);

  // Get closed leads (became_client_date is set)
  const closedLeads = useMemo(() => {
    return leads.filter(l => l.became_client_date && leadsWithExpenses.has(l.id));
  }, [leads, leadsWithExpenses]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatMetricValue = (value: number, metric: MetricType) => {
    switch (metric) {
      case 'spending':
      case 'purchases':
      case 'cost_per_lead':
      case 'cost_per_closed_lead':
      case 'cac':
        return formatCurrency(value);
      case 'days_traveled':
      case 'leads_with_expense':
        return value.toLocaleString('pt-BR');
      default:
        return value.toLocaleString('pt-BR');
    }
  };

  const getMetricLabel = (metric: MetricType) => {
    return metricOptions.find(m => m.value === metric)?.label || metric;
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
      uniqueDays: Set<string>;
      uniqueLeads: Set<string>;
      closedLeadIds: Set<string>;
    }> = {};

    chartTransactions.forEach((t) => {
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
          uniqueDays: new Set<string>(),
          uniqueLeads: new Set<string>(),
          closedLeadIds: new Set<string>(),
        };
      }

      groups[groupKey].installmentTotal += t.amount;
      groups[groupKey].count += 1;
      groups[groupKey].uniqueDays.add(t.transaction_date);
      
      // Track leads with expenses in this period
      const override = getTransactionOverride(t.id);
      if (override?.lead_id) {
        groups[groupKey].uniqueLeads.add(override.lead_id);
        // Check if this lead became a client
        const lead = leads.find(l => l.id === override.lead_id);
        if (lead?.became_client_date) {
          groups[groupKey].closedLeadIds.add(override.lead_id);
        }
      }
      
      // Calculate original purchase value for installments
      if (t.total_installments && t.total_installments > 1) {
        groups[groupKey].purchaseTotal += t.amount * t.total_installments;
      } else {
        groups[groupKey].purchaseTotal += t.amount;
      }
    });

    return Object.entries(groups)
      .sort((a, b) => a[1].sortKey.localeCompare(b[1].sortKey))
      .map(([key, data]) => {
        const leadsCount = data.uniqueLeads.size;
        const closedLeadsCount = data.closedLeadIds.size;
        
        // Calculate the metric value based on selected metric
        let valor: number;
        switch (metricType) {
          case 'spending':
            valor = data.installmentTotal;
            break;
          case 'purchases':
            valor = data.purchaseTotal;
            break;
          case 'days_traveled':
            valor = data.uniqueDays.size;
            break;
          case 'leads_with_expense':
            valor = leadsCount;
            break;
          case 'cost_per_lead':
            valor = leadsCount > 0 ? data.installmentTotal / leadsCount : 0;
            break;
          case 'cost_per_closed_lead':
          case 'cac':
            valor = closedLeadsCount > 0 ? data.installmentTotal / closedLeadsCount : 0;
            break;
          default:
            valor = data.installmentTotal;
        }
        
        return {
          key,
          name: data.label,
          valor,
          installmentTotal: data.installmentTotal,
          purchaseTotal: data.purchaseTotal,
          count: data.count,
          startDate: data.startDate,
          endDate: data.endDate,
          daysTraveled: data.uniqueDays.size,
          leadsWithExpense: leadsCount,
          closedLeads: closedLeadsCount,
          costPerLead: leadsCount > 0 ? data.installmentTotal / leadsCount : 0,
          costPerClosedLead: closedLeadsCount > 0 ? data.installmentTotal / closedLeadsCount : 0,
        };
      });
  }, [chartTransactions, periodicity, metricType, getTransactionOverride, leads]);

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
              <span className="text-muted-foreground">Dias viajados:</span>
              <span className="font-medium">{data.daysTraveled}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Leads c/ despesa:</span>
              <span className="font-medium">{data.leadsWithExpense}</span>
            </div>
            {data.leadsWithExpense > 0 && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Custo/Lead:</span>
                <span className="font-medium">{formatCurrency(data.costPerLead)}</span>
              </div>
            )}
            {data.closedLeads > 0 && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">CAC (Leads fechados: {data.closedLeads}):</span>
                <span className="font-medium">{formatCurrency(data.costPerClosedLead)}</span>
              </div>
            )}
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
    switch (metricType) {
      case 'spending':
        return 'hsl(var(--destructive))';
      case 'purchases':
        return 'hsl(var(--chart-2))';
      case 'days_traveled':
        return 'hsl(var(--chart-3))';
      case 'leads_with_expense':
        return 'hsl(var(--chart-4))';
      case 'cost_per_lead':
      case 'cost_per_closed_lead':
      case 'cac':
        return 'hsl(var(--chart-5))';
      default:
        return 'hsl(var(--chart-2))';
    }
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

  const formatYAxis = (value: number) => {
    if (metricType === 'days_traveled' || metricType === 'leads_with_expense') {
      return value.toLocaleString('pt-BR');
    }
    return `R$${(value / 1000).toFixed(0)}k`;
  };

  // Calculate totals
  const totals = useMemo(() => {
    const totalSpending = chartData.reduce((sum, d) => sum + d.installmentTotal, 0);
    const totalPurchases = chartData.reduce((sum, d) => sum + d.purchaseTotal, 0);
    const totalDays = new Set(chartTransactions.filter(t => t.amount > 0).map(t => t.transaction_date)).size;
    const totalLeads = leadsWithExpenses.size;
    const totalClosedLeads = closedLeads.length;
    const avgSpending = chartData.length > 0 ? totalSpending / chartData.length : 0;
    const costPerLead = totalLeads > 0 ? totalSpending / totalLeads : 0;
    const cac = totalClosedLeads > 0 ? totalSpending / totalClosedLeads : 0;
    const transactionCount = chartData.reduce((sum, d) => sum + d.count, 0);
    
    return { 
      totalSpending, 
      totalPurchases, 
      totalDays, 
      totalLeads, 
      totalClosedLeads,
      avgSpending, 
      costPerLead, 
      cac,
      transactionCount 
    };
  }, [chartData, chartTransactions, leadsWithExpenses, closedLeads]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-lg">Gastos por Período</CardTitle>
            <div className="flex flex-col sm:flex-row gap-2">
              {/* Metric Selector */}
              <Select value={metricType} onValueChange={(v) => setMetricType(v as MetricType)}>
                <SelectTrigger className="w-[180px] h-8">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    <SelectValue placeholder="Métrica..." />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {metricOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="flex flex-col">
                        <span>{option.label}</span>
                        <span className="text-xs text-muted-foreground">{option.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
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
                tickFormatter={formatYAxis}
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
              {formatCurrency(totals.totalSpending)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Dias Viajados</p>
            <p className="text-lg font-bold">
              {totals.totalDays}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Leads c/ Despesa</p>
            <p className="text-lg font-bold">
              {totals.totalLeads}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-muted-foreground">CAC</p>
            <p className="text-lg font-bold text-primary">
              {totals.totalClosedLeads > 0 ? formatCurrency(totals.cac) : '-'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
