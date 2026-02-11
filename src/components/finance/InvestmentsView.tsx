import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { TrendingUp, PiggyBank, Calendar, Download } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { exportInvestments } from '@/utils/financeExport';
import { useAuth } from '@/hooks/useAuth';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface Investment {
  id: string;
  name: string | null;
  type: string | null;
  balance: number | null;
  amount_original: number | null;
  amount_profit: number | null;
  annual_rate: number | null;
  due_date: string | null;
  issuer_name: string | null;
  status: string | null;
  last_updated_at: string | null;
}

export function InvestmentsView() {
  const { user } = useAuth();
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    fetchInvestments();
  }, [user]);

  const fetchInvestments = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('investments')
        .select('*')
        .eq('user_id', user.id)
        .order('balance', { ascending: false });

      if (error) throw error;
      setInvestments(data || []);
    } catch (err) {
      console.error('Error fetching investments:', err);
    } finally {
      setLoading(false);
    }
  };

  const totalBalance = investments.reduce((sum, i) => sum + (i.balance || 0), 0);
  const totalProfit = investments.reduce((sum, i) => sum + (i.amount_profit || 0), 0);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (investments.length === 0) {
    return (
      <Card className="border-0 shadow-card">
        <CardContent className="py-12 text-center">
          <PiggyBank className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">Nenhum investimento encontrado.</p>
          <p className="text-sm text-muted-foreground/70 mt-2">Sincronize sua conta para ver seus investimentos.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Export */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => exportInvestments(investments)} disabled={investments.length === 0}>
          <Download className="h-4 w-4 mr-2" />
          Exportar
        </Button>
      </div>
      {/* Summary */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="border-0 shadow-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <PiggyBank className="h-4 w-4" />
              Patrimônio Total
            </div>
            <p className="text-2xl font-bold">
              R$ {totalBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <TrendingUp className="h-4 w-4 text-green-500" />
              Rendimentos
            </div>
            <p className="text-2xl font-bold text-green-600">
              R$ {totalProfit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Investment Cards */}
      <div className="grid gap-4">
        {investments.map(inv => (
          <Card key={inv.id} className="border-0 shadow-card">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="font-semibold">{inv.name || 'Investimento'}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    {inv.type && <Badge variant="outline" className="text-xs">{inv.type}</Badge>}
                    {inv.issuer_name && <span className="text-xs text-muted-foreground">{inv.issuer_name}</span>}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold">
                    R$ {(inv.balance || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                  <Badge variant={inv.status === 'active' ? 'default' : 'secondary'} className="text-xs">
                    {inv.status === 'active' ? 'Ativo' : inv.status}
                  </Badge>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-4 mt-3 pt-3 border-t">
                {inv.amount_original != null && (
                  <div>
                    <p className="text-xs text-muted-foreground">Valor Aplicado</p>
                    <p className="text-sm font-medium">R$ {inv.amount_original.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                  </div>
                )}
                {inv.amount_profit != null && (
                  <div>
                    <p className="text-xs text-muted-foreground">Rendimento</p>
                    <p className={cn("text-sm font-medium", inv.amount_profit >= 0 ? "text-green-600" : "text-destructive")}>
                      R$ {inv.amount_profit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                )}
                {inv.annual_rate != null && (
                  <div>
                    <p className="text-xs text-muted-foreground">Taxa a.a.</p>
                    <p className="text-sm font-medium">{inv.annual_rate.toFixed(2)}%</p>
                  </div>
                )}
                {inv.due_date && (
                  <div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" /> Vencimento
                    </p>
                    <p className="text-sm font-medium">
                      {format(new Date(inv.due_date + 'T12:00:00'), "dd/MM/yyyy")}
                    </p>
                  </div>
                )}
              </div>

              {inv.last_updated_at && (
                <p className="text-xs text-muted-foreground/70 mt-2">
                  Atualizado em {format(new Date(inv.last_updated_at), "dd/MM/yy 'às' HH:mm", { locale: ptBR })}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
