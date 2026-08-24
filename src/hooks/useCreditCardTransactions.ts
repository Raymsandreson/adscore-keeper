import { useState, useCallback } from 'react';
import { useAuth } from './useAuth';
import { format } from 'date-fns';
// `cloudFunctions` do functionRouter, que roteia por função: a
// celcoin-open-finance vive no Externo. O `lovableCloudFunctions`, que fala
// sempre com o Cloud, saiu junto com as ações da Pluggy — e o cliente
// `supabase` também, que só existia para pegar a sessão daquelas chamadas.
import { cloudFunctions as routedFunctions } from '@/lib/functionRouter';

interface Transaction {
  id: string;
  pluggy_account_id: string;
  pluggy_transaction_id: string;
  description: string;
  amount: number;
  currency_code: string;
  transaction_date: string;
  transaction_time: string | null;
  category: string | null;
  payment_data: Record<string, any>;
  card_last_digits: string | null;
  merchant_name: string | null;
  merchant_cnpj: string | null;
  merchant_city: string | null;
  merchant_state: string | null;
  created_at: string;
  installment_number: number | null;
  total_installments: number | null;
  original_purchase_date: string | null;
  purchase_group_id: string | null;
  pluggy_item_id: string | null;
}

interface PluggyConnection {
  id: string;
  pluggy_item_id: string;
  connector_name: string | null;
  connector_type: string | null;
  status: string | null;
  last_sync_at: string | null;
  created_at: string;
  custom_name: string | null;
}

interface DateRange {
  start: Date;
  end: Date;
}

export function useCreditCardTransactions() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [connections, setConnections] = useState<PluggyConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTransactions = useCallback(async (dateRange?: DateRange) => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      // Vem do Externo pela edge. A `credit_card_transactions` existe nos dois
      // projetos; a que recebe dado é a do Externo. O controle de acesso continua
      // sendo o mesmo (`user_id` do dono OU permissão em `user_card_permissions`),
      // só que aplicado dentro da edge — o service role ignora RLS, então a regra
      // é reproduzida lá explicitamente.
      const { data, error: fetchError } = await routedFunctions.invoke('celcoin-open-finance', {
        body: {
          action: 'list_transactions',
          kind: 'card',
          ...(dateRange
            ? {
                from: format(dateRange.start, 'yyyy-MM-dd'),
                to: format(dateRange.end, 'yyyy-MM-dd'),
              }
            : {}),
        },
      });

      if (fetchError) throw fetchError;
      if (data?.success === false) throw new Error(data?.error || 'Falha ao ler lançamentos');
      setTransactions((data?.transactions as Transaction[]) || []);
    } catch (err: any) {
      console.error('Error fetching transactions:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
    // Pelo ID, não pelo objeto: `useAuth` devolve referência nova a cada
    // revalidação de sessão, e isso refazia o callback e redisparava quem
    // depende dele — leitura em dobro a cada abertura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const fetchConnections = useCallback(async () => {
    if (!user) return;

    try {
      // Vem do Externo, onde as 3 conexões da Pluggy realmente estão. A edge
      // `pluggy-integration` do Cloud responde lista vazia, e a tela de Gastos
      // do Cartão esconde TUDO quando `connections` está vazio — o gate da
      // lista vem antes do gate do dado, então sem isto o extrato não aparece
      // mesmo estando legível.
      const { data, error: connError } = await routedFunctions.invoke('celcoin-open-finance', {
        body: { action: 'list_pluggy_connections' },
      });
      if (connError) throw connError;
      if (data?.success === false) throw new Error(data?.error || 'Falha ao listar conexões');
      setConnections((data?.connections as PluggyConnection[]) || []);
    } catch (err: any) {
      console.error('Error fetching connections:', err);
    }
    // Pelo ID: ver a nota em fetchTransactions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const getCategoryTotals = useCallback(() => {
    const totals: Record<string, number> = {};
    transactions.forEach(t => {
      const category = t.category || 'Outros';
      totals[category] = (totals[category] || 0) + Math.abs(t.amount);
    });
    return Object.entries(totals)
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);
  }, [transactions]);

  // Credit card transactions from Pluggy come as positive values for expenses
  const getTotalSpent = useCallback(() => {
    return transactions
      .filter(t => t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0);
  }, [transactions]);

  const updateConnectionName = useCallback(async (connectionId: string, customName: string) => {
    // Escreve no Externo, que é de onde a lista é lida. Escrever no Cloud (como
    // antes) fazia o nome sumir sem erro: a linha alterada era a de outra base.
    const { data, error } = await routedFunctions.invoke('celcoin-open-finance', {
      body: { action: 'rename_connection', connection_id: connectionId, custom_name: customName },
    });
    if (error) throw error;
    if (data?.success === false) throw new Error(data?.error || 'Falha ao renomear conexão');
    
    // Update local state
    setConnections(prev => prev.map(c => 
      c.id === connectionId ? { ...c, custom_name: customName } : c
    ));
  }, []);

  return {
    transactions,
    connections,
    loading,
    error,
    fetchTransactions,
    fetchConnections,
    getCategoryTotals,
    getTotalSpent,
    updateConnectionName,
  };
}
