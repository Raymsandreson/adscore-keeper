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
  CheckCircle2,
  Users,
  Wrench
} from 'lucide-react';
import { useExpenseCategories, DailyLimitAnalysis, AverageLimitAnalysis, ExpenseCategory } from '@/hooks/useExpenseCategories';
import { useVinculoDespesas } from '@/hooks/useVinculoDespesas';
import {
  calcularLimitesPorVinculo,
  TEXTO_DO_MOTIVO,
  type EstouroPorVinculo,
  type PendenciaVinculo,
} from '@/lib/limitesPorVinculo';

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
    getCategoryById,
    categories,
    overrides,
  } = useExpenseCategories();

  // Limites por vínculo (grupo de WhatsApp = o caso, e cliente) precisam de
  // mapas que não vêm da transação: lead ↔ grupo ↔ contato.
  const { mapa, carregando: carregandoVinculos } = useVinculoDespesas(overrides);

  const porVinculo = useMemo(
    () => calcularLimitesPorVinculo(transactions, categories, overrides, mapa),
    [transactions, categories, overrides, mapa]
  );

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
      case 'per_whatsapp_group': return '/grupo';
      case 'per_client': return '/cliente';
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
          <TabsList className="grid w-full grid-cols-3">
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
            <TabsTrigger value="vinculo" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Caso/Cliente
              {(porVinculo.estouros.length + porVinculo.pendencias.length) > 0 && (
                <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-xs">
                  {porVinculo.estouros.length + porVinculo.pendencias.length}
                </Badge>
              )}
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

          <TabsContent value="vinculo" className="mt-4">
            {carregandoVinculos ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Carregando vínculos das despesas...
              </div>
            ) : porVinculo.totais.length === 0 && porVinculo.pendencias.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Users className="h-12 w-12 text-muted-foreground mb-3" />
                <p className="font-medium">Nenhuma categoria com limite por caso ou cliente</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Defina a unidade "Por grupo de WhatsApp (caso)" ou "Por cliente" na categoria
                </p>
              </div>
            ) : (
              <ScrollArea className="h-[300px]">
                <div className="space-y-3">
                  {porVinculo.estouros.length === 0 && (
                    <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-400">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      Nenhum caso ou cliente passou do limite
                    </div>
                  )}

                  {porVinculo.estouros.map((estouro) => (
                    <EstouroVinculoCard
                      key={`${estouro.categoryId}-${estouro.chave}`}
                      estouro={estouro}
                      formatCurrency={formatCurrency}
                    />
                  ))}

                  {porVinculo.pendencias.length > 0 && (
                    <div className="pt-2">
                      <p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <Wrench className="h-3.5 w-3.5 text-amber-500" />
                        {porVinculo.pendencias.length} despesa(s) fora da conta — o vínculo não
                        resolveu o caso/cliente
                      </p>
                      <div className="space-y-2">
                        {porVinculo.pendencias.map((pendencia) => (
                          <PendenciaVinculoCard
                            key={`${pendencia.categoryId}-${pendencia.transactionId}`}
                            pendencia={pendencia}
                            formatCurrency={formatCurrency}
                            formatDate={formatDate}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function EstouroVinculoCard({
  estouro,
  formatCurrency,
}: {
  estouro: EstouroPorVinculo;
  formatCurrency: (value: number) => string;
}) {
  const percentual = Math.round((estouro.totalGasto / estouro.limite) * 100);

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{estouro.rotulo}</p>
          <p className="text-xs text-muted-foreground">
            {estouro.categoryName} ·{' '}
            {estouro.unidade === 'per_whatsapp_group' ? 'grupo de WhatsApp (caso)' : 'cliente'} ·{' '}
            {estouro.transacoes} despesa(s)
          </p>
        </div>
        <Badge variant="destructive" className="shrink-0">{percentual}%</Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span>
          Gasto: <strong>{formatCurrency(estouro.totalGasto)}</strong>
        </span>
        <span className="text-muted-foreground">Limite: {formatCurrency(estouro.limite)}</span>
        <span className="text-destructive">
          Excedente: <strong>{formatCurrency(estouro.excedente)}</strong>
        </span>
      </div>
      {estouro.temDeducao && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Inclui despesa cujo {estouro.unidade === 'per_whatsapp_group' ? 'grupo' : 'cliente'} foi
          deduzido do lead, não escolhido na despesa.
        </p>
      )}
    </div>
  );
}

function PendenciaVinculoCard({
  pendencia,
  formatCurrency,
  formatDate,
}: {
  pendencia: PendenciaVinculo;
  formatCurrency: (value: number) => string;
  formatDate: (dateStr: string) => string;
}) {
  return (
    <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/20">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{pendencia.categoryName}</p>
          <p className="text-xs text-muted-foreground">
            {formatDate(pendencia.transactionDate)} ·{' '}
            {pendencia.unidade === 'per_whatsapp_group' ? 'sem grupo' : 'sem cliente'}
          </p>
        </div>
        <span className="shrink-0 text-sm font-medium">{formatCurrency(pendencia.valor)}</span>
      </div>
      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
        {TEXTO_DO_MOTIVO[pendencia.motivo]}
      </p>
    </div>
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