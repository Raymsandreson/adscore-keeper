import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowUpRight, ArrowDownRight, Search, Wallet, TrendingUp, TrendingDown } from 'lucide-react';
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

export function BankTransactionsView({ startDate, endDate }: BankTransactionsViewProps) {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

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
    if (!searchTerm) return transactions;
    const term = searchTerm.toLowerCase();
    return transactions.filter(t =>
      t.description?.toLowerCase().includes(term) ||
      t.merchant_name?.toLowerCase().includes(term) ||
      t.category?.toLowerCase().includes(term)
    );
  }, [transactions, searchTerm]);

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
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-0 shadow-card">
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
        <Card className="border-0 shadow-card">
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

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar movimentação..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Transactions Table */}
      <Card className="border-0 shadow-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Extrato ({filtered.length} movimentações)</CardTitle>
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
