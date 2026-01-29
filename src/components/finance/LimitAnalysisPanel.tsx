import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  AlertTriangle, 
  TrendingUp, 
  Calendar,
  BarChart3,
  CheckCircle2
} from 'lucide-react';
import { useExpenseCategories, DailyLimitAnalysis, AverageLimitAnalysis, ExpenseCategory } from '@/hooks/useExpenseCategories';

interface Transaction {
  id: string;
  amount: number;
  transaction_date: string;
  category?: string | null;
}

interface LimitAnalysisPanelProps {
  transactions: Transaction[];
}

export function LimitAnalysisPanel({ transactions }: LimitAnalysisPanelProps) {
  const { 
    getAllDailyViolations, 
    getAllAverageAnalysis,
    getCategoryById 
  } = useExpenseCategories();

  const dailyViolations = useMemo(() => {
    return getAllDailyViolations(transactions);
  }, [transactions, getAllDailyViolations]);

  const averageAnalyses = useMemo(() => {
    return getAllAverageAnalysis(transactions);
  }, [transactions, getAllAverageAnalysis]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
    });
  };

  const getLimitUnitLabel = (category: ReturnType<typeof getCategoryById>) => {
    if (!category) return '';
    switch (category.limit_unit) {
      case 'per_transaction': return '/transação';
      case 'per_day': return '/dia';
      case 'per_month': return '/mês';
      default: return '';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Análise de Limites
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="daily" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="daily" className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Por Dia
              {dailyViolations.length > 0 && (
                <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-xs">
                  {dailyViolations.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="average" className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Médias
            </TabsTrigger>
          </TabsList>

          <TabsContent value="daily" className="mt-4">
            {dailyViolations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle2 className="h-12 w-12 text-green-500 mb-3" />
                <p className="font-medium text-green-600">Nenhum limite excedido!</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Todos os gastos diários estão dentro dos limites
                </p>
              </div>
            ) : (
              <ScrollArea className="h-[300px]">
                <div className="space-y-3">
                  {dailyViolations.map((violation, idx) => (
                    <DailyViolationCard key={`${violation.categoryId}-${violation.date}-${idx}`} violation={violation} />
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="average" className="mt-4">
            {averageAnalyses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <BarChart3 className="h-12 w-12 text-muted-foreground mb-3" />
                <p className="font-medium">Sem dados para análise</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Categorize as transações para ver as médias
                </p>
              </div>
            ) : (
              <ScrollArea className="h-[300px]">
                <div className="space-y-3">
                  {averageAnalyses.map((analysis) => (
                    <AverageAnalysisCard 
                      key={analysis.categoryId} 
                      analysis={analysis}
                      getLimitUnitLabel={getLimitUnitLabel}
                      getCategoryById={getCategoryById}
                    />
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function DailyViolationCard({ violation }: { violation: DailyLimitAnalysis }) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  return (
    <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">{violation.categoryName}</p>
            <p className="text-sm text-muted-foreground">{formatDate(violation.date)}</p>
          </div>
        </div>
        <Badge variant="destructive">
          +{formatCurrency(violation.diff)}
        </Badge>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <div className="p-2 rounded bg-background">
          <p className="text-muted-foreground text-xs">Gasto no dia</p>
          <p className="font-medium text-destructive">{formatCurrency(violation.totalSpent)}</p>
        </div>
        <div className="p-2 rounded bg-background">
          <p className="text-muted-foreground text-xs">Limite diário</p>
          <p className="font-medium">{formatCurrency(violation.limit)}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        {violation.transactionCount} transação(ões) neste dia
      </p>
    </div>
  );
}

function AverageAnalysisCard({ 
  analysis,
  getLimitUnitLabel,
  getCategoryById 
}: { 
  analysis: AverageLimitAnalysis;
  getLimitUnitLabel: (category: ExpenseCategory | undefined) => string;
  getCategoryById: (id: string) => ExpenseCategory | undefined;
}) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const category = getCategoryById(analysis.categoryId);
  const hasIssue = analysis.exceedsAverageDaily || analysis.exceedsAverageMonthly;
  const limitLabel = getLimitUnitLabel(category);

  return (
    <div className={`p-3 rounded-lg border ${hasIssue ? 'border-amber-500/30 bg-amber-500/5' : 'bg-muted/30'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{analysis.categoryName}</p>
          <p className="text-xs text-muted-foreground">
            Limite: {formatCurrency(analysis.limit)}{limitLabel}
          </p>
        </div>
        {hasIssue ? (
          <Badge variant="outline" className="border-amber-500 text-amber-600">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Atenção
          </Badge>
        ) : (
          <Badge variant="outline" className="border-green-500 text-green-600">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            OK
          </Badge>
        )}
      </div>
      
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className={`p-2 rounded ${analysis.exceedsAverageDaily ? 'bg-amber-100 dark:bg-amber-900/20' : 'bg-background'}`}>
          <p className="text-muted-foreground text-xs">Média diária</p>
          <p className={`font-medium ${analysis.exceedsAverageDaily ? 'text-amber-600' : ''}`}>
            {formatCurrency(analysis.averageDaily)}
          </p>
        </div>
        <div className={`p-2 rounded ${analysis.exceedsAverageMonthly ? 'bg-amber-100 dark:bg-amber-900/20' : 'bg-background'}`}>
          <p className="text-muted-foreground text-xs">Média mensal</p>
          <p className={`font-medium ${analysis.exceedsAverageMonthly ? 'text-amber-600' : ''}`}>
            {formatCurrency(analysis.averageMonthly)}
          </p>
        </div>
      </div>
      
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{analysis.daysWithTransactions} dias com gastos</span>
        <span>Total: {formatCurrency(analysis.totalSpent)}</span>
      </div>
    </div>
  );
}