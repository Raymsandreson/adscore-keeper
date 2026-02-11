import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ArrowUpRight, ArrowDownRight, Search, Wallet, TrendingUp, TrendingDown } from 'lucide-react';
import { exportBankTransactions } from '@/utils/financeExport';
import { ExportFormatMenu } from '@/components/finance/ExportFormatMenu';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface BankTransaction {
  id: string;
  description: string | null;
  amount: number;
  transaction_date: string;
  transaction_time: string | null;
  category: string | null;
  transaction_type: string | null;
  merchant_name: string | null;
  merchant_city: string | null;
  merchant_state: string | null;
}

interface BankTransactionsViewProps {
  startDate: Date;
  endDate: Date;
}

type FlowFilter = 'all' | 'credit' | 'debit';

export function BankTransactionsView({ startDate, endDate }: BankTransactionsViewProps) {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [flowFilter, setFlowFilter] = useState<FlowFilter>('all');

  useEffect(() => {
    if (!user) return;
    fetchTransactions();
  }, [user, startDate, endDate]);

  const fetchTransactions = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const fromDate = format(startDate, 'yyyy-MM-dd');
      const toDate = format(endDate, 'yyyy-MM-dd');

      const { data, error } = await supabase
        .from('bank_transactions')
        .select('id, description, amount, transaction_date, transaction_time, category, transaction_type, merchant_name, merchant_city, merchant_state')
        .eq('user_id', user.id)
        .gte('transaction_date', fromDate)
        .lte('transaction_date', toDate)
        .order('transaction_date', { ascending: false })
        .order('transaction_time', { ascending: false });

      if (error) throw error;
      setTransactions(data || []);
    } catch (err) {
      console.error('Error fetching bank transactions:', err);
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    let result = transactions;

    if (flowFilter === 'credit') {
      result = result.filter(t => t.amount >= 0);
    } else if (flowFilter === 'debit') {
      result = result.filter(t => t.amount < 0);
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(t =>
        t.description?.toLowerCase().includes(term) ||
        t.merchant_name?.toLowerCase().includes(term) ||
        t.category?.toLowerCase().includes(term) ||
        t.transaction_type?.toLowerCase().includes(term) ||
        t.merchant_city?.toLowerCase().includes(term)
      );
    }

    return result;
  }, [transactions, searchTerm, flowFilter]);

  const totalCredits = useMemo(() => filtered.filter(t => t.amount >= 0).reduce((sum, t) => sum + t.amount, 0), [filtered]);
  const totalDebits = useMemo(() => filtered.filter(t => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0), [filtered]);
  const balance = totalCredits - totalDebits;

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <Card className="border-0 shadow-card">
        <CardContent className="py-12 text-center">
          <Wallet className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">Nenhuma movimentação no período selecionado.</p>
          <p className="text-sm text-muted-foreground/70 mt-2">
            Período: {format(startDate, 'dd/MM/yyyy', { locale: ptBR })} a {format(endDate, 'dd/MM/yyyy', { locale: ptBR })}. 
            Tente alterar o período ou sincronize novamente.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Cards - clickable as filters */}
      <div className="grid grid-cols-3 gap-4">
        <Card
          className={cn(
            "border-0 shadow-card cursor-pointer transition-all",
            flowFilter === 'credit' && "ring-2 ring-primary"
          )}
          onClick={() => setFlowFilter(flowFilter === 'credit' ? 'all' : 'credit')}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <TrendingUp className="h-4 w-4 text-green-500" />
              Entradas
            </div>
            <p className="text-xl font-bold text-green-600">
              R$ {totalCredits.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
          </CardContent>
        </Card>
        <Card
          className={cn(
            "border-0 shadow-card cursor-pointer transition-all",
            flowFilter === 'debit' && "ring-2 ring-primary"
          )}
          onClick={() => setFlowFilter(flowFilter === 'debit' ? 'all' : 'debit')}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <TrendingDown className="h-4 w-4 text-destructive" />
              Saídas
            </div>
            <p className="text-xl font-bold text-destructive">
              R$ {totalDebits.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Wallet className="h-4 w-4" />
              Saldo Período
            </div>
            <p className={cn("text-xl font-bold", balance >= 0 ? "text-green-600" : "text-destructive")}>
              R$ {balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Search + Flow Filter */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por descrição, estabelecimento, categoria, cidade..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 h-10 rounded-xl bg-muted/50 border-0"
          />
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-xl p-1">
          <Button
            variant={flowFilter === 'all' ? 'default' : 'ghost'}
            size="sm"
            className="h-8 text-xs rounded-lg"
            onClick={() => setFlowFilter('all')}
          >
            Todas
          </Button>
          <Button
            variant={flowFilter === 'credit' ? 'default' : 'ghost'}
            size="sm"
            className="h-8 text-xs rounded-lg gap-1"
            onClick={() => setFlowFilter('credit')}
          >
            <ArrowUpRight className="h-3 w-3" />
            Entradas
          </Button>
          <Button
            variant={flowFilter === 'debit' ? 'default' : 'ghost'}
            size="sm"
            className="h-8 text-xs rounded-lg gap-1"
            onClick={() => setFlowFilter('debit')}
          >
            <ArrowDownRight className="h-3 w-3" />
            Saídas
          </Button>
        </div>
      </div>

      {/* Transactions Table */}
      <Card className="border-0 shadow-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            Extrato ({filtered.length} movimentações)
            {flowFilter !== 'all' && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {flowFilter === 'credit' ? 'Só entradas' : 'Só saídas'}
              </Badge>
            )}
          </CardTitle>
          <ExportFormatMenu
            onExport={(fmt) => exportBankTransactions(filtered, fmt)}
            disabled={filtered.length === 0}
          />
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Data</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Local</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(t => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-sm">
                      {format(new Date(t.transaction_date + 'T12:00:00'), 'dd/MM/yy')}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {t.amount >= 0 ? (
                          <ArrowUpRight className="h-4 w-4 text-green-500 shrink-0" />
                        ) : (
                          <ArrowDownRight className="h-4 w-4 text-destructive shrink-0" />
                        )}
                        <span className="text-sm">{t.description || t.merchant_name || 'Sem descrição'}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {t.category && (
                        <Badge variant="outline" className="text-xs">{t.category}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {t.merchant_city && t.merchant_state
                        ? `${t.merchant_city}/${t.merchant_state}`
                        : t.merchant_city || t.merchant_state || ''}
                    </TableCell>
                    <TableCell className={cn("text-right font-mono font-medium text-sm", t.amount >= 0 ? "text-green-600" : "text-destructive")}>
                      {t.amount >= 0 ? '+' : ''}R$ {Math.abs(t.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
