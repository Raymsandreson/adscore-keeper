import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { 
  Users, 
  Calendar, 
  TrendingUp, 
  DollarSign,
  Route,
  UserCircle,
  BarChart3,
  Map,
  Clock,
  CreditCard
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useExpenseCategories } from '@/hooks/useExpenseCategories';

interface Transaction {
  id: string;
  pluggy_account_id: string;
  pluggy_transaction_id: string;
  description: string | null;
  amount: number;
  currency_code: string | null;
  transaction_date: string;
  category: string | null;
  payment_data: Record<string, unknown>;
  card_last_digits: string | null;
  merchant_name: string | null;
  created_at: string;
}

interface AcolhedorLogisticsDashboardProps {
  transactions: Transaction[];
}

interface AcolhedorStats {
  leadId: string | null;
  leadName: string;
  cardDigits: string;
  cardName: string | null;
  totalSpent: number;
  daysWorked: number;
  uniqueDates: string[];
  avgPerDay: number;
  transactionCount: number;
  byCategory: Record<string, number>;
  byDate: Record<string, { total: number; count: number }>;
}

export function AcolhedorLogisticsDashboard({ transactions }: AcolhedorLogisticsDashboardProps) {
  const { cardAssignments, overrides, getCategoryById } = useExpenseCategories();
  const [selectedAcolhedor, setSelectedAcolhedor] = useState<string | null>(null);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  // Aggregate stats by acolhedor (lead linked to cards)
  const acolhedorStats = useMemo((): AcolhedorStats[] => {
    const statsMap: Record<string, AcolhedorStats> = {};

    transactions.forEach(tx => {
      const cardDigits = tx.card_last_digits || 'unknown';
      const assignment = cardAssignments.find(a => a.card_last_digits === cardDigits);
      
      // Key by lead_id if assigned, otherwise by card_digits
      const key = assignment?.lead_id || `card_${cardDigits}`;
      
      if (!statsMap[key]) {
        statsMap[key] = {
          leadId: assignment?.lead_id || null,
          leadName: assignment?.lead_name || 'Não atribuído',
          cardDigits,
          cardName: assignment?.card_name || null,
          totalSpent: 0,
          daysWorked: 0,
          uniqueDates: [],
          avgPerDay: 0,
          transactionCount: 0,
          byCategory: {},
          byDate: {},
        };
      }

      const stats = statsMap[key];
      const amount = Math.abs(tx.amount);
      stats.totalSpent += amount;
      stats.transactionCount += 1;

      // Track unique dates
      if (!stats.uniqueDates.includes(tx.transaction_date)) {
        stats.uniqueDates.push(tx.transaction_date);
      }

      // By date
      if (!stats.byDate[tx.transaction_date]) {
        stats.byDate[tx.transaction_date] = { total: 0, count: 0 };
      }
      stats.byDate[tx.transaction_date].total += amount;
      stats.byDate[tx.transaction_date].count += 1;

      // By category (from override or pluggy)
      const override = overrides.find(o => o.transaction_id === tx.id);
      let categoryName = 'Outros';
      if (override) {
        const cat = getCategoryById(override.category_id);
        categoryName = cat?.name || 'Outros';
      } else if (tx.category) {
        categoryName = tx.category;
      }
      stats.byCategory[categoryName] = (stats.byCategory[categoryName] || 0) + amount;
    });

    // Calculate derived stats
    Object.values(statsMap).forEach(stats => {
      stats.daysWorked = stats.uniqueDates.length;
      stats.avgPerDay = stats.daysWorked > 0 ? stats.totalSpent / stats.daysWorked : 0;
    });

    return Object.values(statsMap).sort((a, b) => b.totalSpent - a.totalSpent);
  }, [transactions, cardAssignments, overrides, getCategoryById]);

  // Summary totals
  const summary = useMemo(() => {
    const totalSpent = acolhedorStats.reduce((sum, s) => sum + s.totalSpent, 0);
    const totalDays = new Set(transactions.map(t => t.transaction_date)).size;
    const totalTransactions = transactions.length;
    const avgPerAcolhedor = acolhedorStats.length > 0 ? totalSpent / acolhedorStats.length : 0;
    const categorySummary: Record<string, number> = {};

    acolhedorStats.forEach(s => {
      Object.entries(s.byCategory).forEach(([cat, val]) => {
        categorySummary[cat] = (categorySummary[cat] || 0) + val;
      });
    });

    return {
      totalSpent,
      totalDays,
      totalTransactions,
      avgPerAcolhedor,
      acolhedorCount: acolhedorStats.length,
      categorySummary,
    };
  }, [acolhedorStats, transactions]);

  // Daily breakdown for selected acolhedor or all
  const dailyBreakdown = useMemo(() => {
    const target = selectedAcolhedor
      ? acolhedorStats.find(s => (s.leadId || `card_${s.cardDigits}`) === selectedAcolhedor)
      : null;

    if (target) {
      return Object.entries(target.byDate)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, data]) => ({
          date,
          total: data.total,
          count: data.count,
          acolhedor: target.leadName,
        }));
    }

    // Aggregate all
    const allByDate: Record<string, { total: number; count: number }> = {};
    acolhedorStats.forEach(s => {
      Object.entries(s.byDate).forEach(([date, data]) => {
        if (!allByDate[date]) {
          allByDate[date] = { total: 0, count: 0 };
        }
        allByDate[date].total += data.total;
        allByDate[date].count += data.count;
      });
    });

    return Object.entries(allByDate)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, data]) => ({
        date,
        total: data.total,
        count: data.count,
        acolhedor: 'Todos',
      }));
  }, [acolhedorStats, selectedAcolhedor]);

  // Category breakdown
  const categoryBreakdown = useMemo(() => {
    const target = selectedAcolhedor
      ? acolhedorStats.find(s => (s.leadId || `card_${s.cardDigits}`) === selectedAcolhedor)
      : null;

    const source = target ? target.byCategory : summary.categorySummary;
    const total = Object.values(source).reduce((sum, v) => sum + v, 0);

    return Object.entries(source)
      .sort(([, a], [, b]) => b - a)
      .map(([category, amount]) => ({
        category,
        amount,
        percentage: total > 0 ? (amount / total) * 100 : 0,
      }));
  }, [acolhedorStats, selectedAcolhedor, summary]);

  const selectedStats = selectedAcolhedor
    ? acolhedorStats.find(s => (s.leadId || `card_${s.cardDigits}`) === selectedAcolhedor)
    : null;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="h-4 w-4" />
              Acolhedores
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.acolhedorCount}</p>
            <p className="text-xs text-muted-foreground">com gastos registrados</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Dias Viajados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.totalDays}</p>
            <p className="text-xs text-muted-foreground">dias com transações</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Total Gasto
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-destructive">{formatCurrency(summary.totalSpent)}</p>
            <p className="text-xs text-muted-foreground">{summary.totalTransactions} transações</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Média/Acolhedor
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(summary.avgPerAcolhedor)}</p>
            <p className="text-xs text-muted-foreground">gasto médio</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content with Tabs */}
      <Tabs defaultValue="acolhedores" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="acolhedores" className="flex items-center gap-2">
            <UserCircle className="h-4 w-4" />
            Por Acolhedor
          </TabsTrigger>
          <TabsTrigger value="diario" className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Por Dia
          </TabsTrigger>
          <TabsTrigger value="categorias" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Por Categoria
          </TabsTrigger>
          <TabsTrigger value="detalhes" className="flex items-center gap-2">
            <Route className="h-4 w-4" />
            Detalhes
          </TabsTrigger>
        </TabsList>

        {/* By Acolhedor Tab */}
        <TabsContent value="acolhedores">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Gastos por Acolhedor
              </CardTitle>
              <CardDescription>
                Clique em um acolhedor para ver detalhes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-3">
                  {acolhedorStats.map((stats) => {
                    const key = stats.leadId || `card_${stats.cardDigits}`;
                    const isSelected = selectedAcolhedor === key;
                    const maxSpent = Math.max(...acolhedorStats.map(s => s.totalSpent));
                    const percentage = maxSpent > 0 ? (stats.totalSpent / maxSpent) * 100 : 0;

                    return (
                      <div
                        key={key}
                        className={`p-4 rounded-lg border cursor-pointer transition-all ${
                          isSelected 
                            ? 'border-primary bg-primary/5' 
                            : 'hover:border-primary/50 hover:bg-muted/50'
                        }`}
                        onClick={() => setSelectedAcolhedor(isSelected ? null : key)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-full bg-primary/10">
                              <UserCircle className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <p className="font-medium">{stats.leadName}</p>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <CreditCard className="h-3 w-3" />
                                <span>{stats.cardName || `**** ${stats.cardDigits}`}</span>
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-bold text-destructive">
                              {formatCurrency(stats.totalSpent)}
                            </p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Calendar className="h-3 w-3" />
                              <span>{stats.daysWorked} dias</span>
                              <Clock className="h-3 w-3 ml-1" />
                              <span>{formatCurrency(stats.avgPerDay)}/dia</span>
                            </div>
                          </div>
                        </div>
                        <Progress value={percentage} className="h-1.5" />
                        
                        {isSelected && (
                          <div className="mt-4 pt-4 border-t space-y-2">
                            <p className="text-sm font-medium text-muted-foreground">Principais Categorias:</p>
                            <div className="flex flex-wrap gap-2">
                              {Object.entries(stats.byCategory)
                                .sort(([, a], [, b]) => b - a)
                                .slice(0, 5)
                                .map(([cat, val]) => (
                                  <Badge key={cat} variant="outline">
                                    {cat}: {formatCurrency(val)}
                                  </Badge>
                                ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {acolhedorStats.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      Nenhum acolhedor com gastos registrados
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Daily Tab */}
        <TabsContent value="diario">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    Gastos por Dia
                  </CardTitle>
                  <CardDescription>
                    {selectedStats ? `Acolhedor: ${selectedStats.leadName}` : 'Todos os acolhedores'}
                  </CardDescription>
                </div>
                {selectedAcolhedor && (
                  <Badge 
                    variant="outline" 
                    className="cursor-pointer"
                    onClick={() => setSelectedAcolhedor(null)}
                  >
                    Ver todos ×
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Dia da Semana</TableHead>
                      <TableHead className="text-center">Transações</TableHead>
                      <TableHead className="text-right">Total do Dia</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dailyBreakdown.map(({ date, total, count }) => (
                      <TableRow key={date}>
                        <TableCell className="font-mono">
                          {format(parseISO(date), 'dd/MM/yyyy')}
                        </TableCell>
                        <TableCell>
                          {format(parseISO(date), 'EEEE', { locale: ptBR })}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary">{count}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-bold text-destructive">
                          {formatCurrency(total)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Categories Tab */}
        <TabsContent value="categorias">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Gastos por Categoria (Rotas)
                  </CardTitle>
                  <CardDescription>
                    {selectedStats ? `Acolhedor: ${selectedStats.leadName}` : 'Todos os acolhedores'}
                  </CardDescription>
                </div>
                {selectedAcolhedor && (
                  <Badge 
                    variant="outline" 
                    className="cursor-pointer"
                    onClick={() => setSelectedAcolhedor(null)}
                  >
                    Ver todos ×
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {categoryBreakdown.map(({ category, amount, percentage }) => (
                  <div key={category} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{category}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">
                          {percentage.toFixed(1)}%
                        </span>
                        <span className="font-bold">{formatCurrency(amount)}</span>
                      </div>
                    </div>
                    <Progress value={percentage} className="h-2" />
                  </div>
                ))}

                {categoryBreakdown.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    Nenhuma categoria encontrada
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Details Tab */}
        <TabsContent value="detalhes">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Per Acolhedor Details */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Map className="h-5 w-5" />
                  Resumo por Acolhedor
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[350px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Acolhedor</TableHead>
                        <TableHead className="text-center">Dias</TableHead>
                        <TableHead className="text-right">Média/Dia</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {acolhedorStats.map((stats) => (
                        <TableRow key={stats.leadId || stats.cardDigits}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{stats.leadName}</p>
                              <p className="text-xs text-muted-foreground">
                                {stats.cardName || `**** ${stats.cardDigits}`}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline">{stats.daysWorked}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(stats.avgPerDay)}
                          </TableCell>
                          <TableCell className="text-right font-bold text-destructive">
                            {formatCurrency(stats.totalSpent)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Top Days */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Dias com Mais Gastos
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[350px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead className="text-center">Transações</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dailyBreakdown.slice(0, 10).map(({ date, total, count }) => (
                        <TableRow key={date}>
                          <TableCell>
                            <div>
                              <p className="font-mono">{format(parseISO(date), 'dd/MM/yyyy')}</p>
                              <p className="text-xs text-muted-foreground capitalize">
                                {format(parseISO(date), 'EEEE', { locale: ptBR })}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="secondary">{count}</Badge>
                          </TableCell>
                          <TableCell className="text-right font-bold text-destructive">
                            {formatCurrency(total)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
