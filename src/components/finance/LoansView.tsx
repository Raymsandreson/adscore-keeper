import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Landmark, Calendar, Percent } from 'lucide-react';
import { exportLoans } from '@/utils/financeExport';
import { ExportFormatMenu } from '@/components/finance/ExportFormatMenu';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface Loan {
  id: string;
  name: string | null;
  loan_type: string | null;
  total_amount: number | null;
  outstanding_balance: number | null;
  monthly_payment: number | null;
  interest_rate: number | null;
  installments_total: number | null;
  installments_paid: number | null;
  start_date: string | null;
  due_date: string | null;
  status: string | null;
}

export function LoansView() {
  const { user } = useAuth();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    fetchLoans();
  }, [user]);

  const fetchLoans = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('loans')
        .select('*')
        .eq('user_id', user.id)
        .order('outstanding_balance', { ascending: false });

      if (error) throw error;
      setLoans(data || []);
    } catch (err) {
      console.error('Error fetching loans:', err);
    } finally {
      setLoading(false);
    }
  };

  const totalOutstanding = loans.reduce((sum, l) => sum + (l.outstanding_balance || 0), 0);
  const totalMonthly = loans.reduce((sum, l) => sum + (l.monthly_payment || 0), 0);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (loans.length === 0) {
    return (
      <Card className="border-0 shadow-card">
        <CardContent className="py-12 text-center">
          <Landmark className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">Nenhum empréstimo encontrado.</p>
          <p className="text-sm text-muted-foreground/70 mt-2">Sincronize sua conta para ver seus empréstimos.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Export */}
      <div className="flex justify-end">
        <ExportFormatMenu
          onExport={(fmt) => exportLoans(loans, fmt)}
          disabled={loans.length === 0}
        />
      </div>
      {/* Summary */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="border-0 shadow-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Landmark className="h-4 w-4" />
              Saldo Devedor Total
            </div>
            <p className="text-2xl font-bold text-destructive">
              R$ {totalOutstanding.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Calendar className="h-4 w-4" />
              Parcela Mensal Total
            </div>
            <p className="text-2xl font-bold">
              R$ {totalMonthly.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Loan Cards */}
      <div className="grid gap-4">
        {loans.map(loan => {
          const progress = loan.installments_total && loan.installments_paid
            ? (loan.installments_paid / loan.installments_total) * 100
            : 0;

          return (
            <Card key={loan.id} className="border-0 shadow-card">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold">{loan.name || 'Empréstimo'}</h3>
                    {loan.loan_type && <Badge variant="outline" className="text-xs mt-1">{loan.loan_type}</Badge>}
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-destructive">
                      R$ {(loan.outstanding_balance || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                    <Badge variant={loan.status === 'active' ? 'destructive' : 'secondary'} className="text-xs">
                      {loan.status === 'active' ? 'Em andamento' : loan.status}
                    </Badge>
                  </div>
                </div>

                {/* Progress */}
                {loan.installments_total && loan.installments_paid != null && (
                  <div className="space-y-1 mb-3">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{loan.installments_paid} de {loan.installments_total} parcelas pagas</span>
                      <span>{progress.toFixed(0)}%</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t">
                  {loan.total_amount != null && (
                    <div>
                      <p className="text-xs text-muted-foreground">Valor Total</p>
                      <p className="text-sm font-medium">R$ {loan.total_amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                    </div>
                  )}
                  {loan.monthly_payment != null && (
                    <div>
                      <p className="text-xs text-muted-foreground">Parcela</p>
                      <p className="text-sm font-medium">R$ {loan.monthly_payment.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                    </div>
                  )}
                  {loan.interest_rate != null && (
                    <div>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Percent className="h-3 w-3" /> Juros
                      </p>
                      <p className="text-sm font-medium">{loan.interest_rate.toFixed(2)}% a.m.</p>
                    </div>
                  )}
                  {loan.due_date && (
                    <div>
                      <p className="text-xs text-muted-foreground">Vencimento</p>
                      <p className="text-sm font-medium">{format(new Date(loan.due_date + 'T12:00:00'), 'dd/MM/yyyy')}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
