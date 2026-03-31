import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

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
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const callPluggyFunction = useCallback(async (action: string, params: Record<string, any> = {}) => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      throw new Error('Not authenticated');
    }

    const response = await cloudFunctions.invoke('pluggy-integration', {
      body: { action, user_id: sessionData.session.user.id, ...params },
      authToken: sessionData.session.access_token,
    });

    if (response.error) {
      throw new Error(response.error.message);
    }

    return response.data;
  }, []);

  const fetchTransactions = useCallback(async (dateRange?: DateRange) => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      // RLS policies handle access control - no need to filter by user_id
      // Admins and users with card permissions can see all transactions
      let query = supabase
        .from('credit_card_transactions')
        .select('*')
        .order('transaction_date', { ascending: false });

      if (dateRange) {
        query = query
          .gte('transaction_date', format(dateRange.start, 'yyyy-MM-dd'))
          .lte('transaction_date', format(dateRange.end, 'yyyy-MM-dd'));
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;
      setTransactions((data as Transaction[]) || []);
    } catch (err: any) {
      console.error('Error fetching transactions:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const fetchConnections = useCallback(async () => {
    if (!user) return;

    try {
      const data = await callPluggyFunction('get_connections');
      setConnections(data.connections || []);
    } catch (err: any) {
      console.error('Error fetching connections:', err);
    }
  }, [user, callPluggyFunction]);

  const importExistingConnections = useCallback(async () => {
    try {
      const data = await callPluggyFunction('import_existing_connections');
      if (data.imported > 0) {
        await fetchConnections();
      }
      return data;
    } catch (err: any) {
      console.error('Error importing connections:', err);
      throw err;
    }
  }, [callPluggyFunction, fetchConnections]);

  const importByItemId = useCallback(async (itemId: string) => {
    const data = await callPluggyFunction('import_by_item_id', { itemId });
    await fetchConnections();
    return data;
  }, [callPluggyFunction, fetchConnections]);

  const createConnectToken = useCallback(async (itemId?: string) => {
    const data = await callPluggyFunction('create_connect_token', { itemId });
    return data.connectToken;
  }, [callPluggyFunction]);

  const saveConnection = useCallback(async (itemId: string) => {
    await callPluggyFunction('save_connection', { itemId });
    await fetchConnections();
  }, [callPluggyFunction, fetchConnections]);

  const syncTransactions = useCallback(async (dateRange?: DateRange) => {
    setSyncing(true);
    setError(null);

    try {
      const params: Record<string, string> = {};
      if (dateRange) {
        params.from = format(dateRange.start, 'yyyy-MM-dd');
        params.to = format(dateRange.end, 'yyyy-MM-dd');
      }

      await callPluggyFunction('sync_transactions', params);
      await fetchTransactions(dateRange);
    } catch (err: any) {
      console.error('Error syncing transactions:', err);
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  }, [callPluggyFunction, fetchTransactions]);

  const deleteConnection = useCallback(async (itemId: string) => {
    await callPluggyFunction('delete_connection', { itemId });
    await fetchConnections();
    setTransactions([]);
  }, [callPluggyFunction, fetchConnections]);

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
    const { error } = await supabase
      .from('pluggy_connections')
      .update({ custom_name: customName })
      .eq('id', connectionId);
    
    if (error) throw error;
    
    // Update local state
    setConnections(prev => prev.map(c => 
      c.id === connectionId ? { ...c, custom_name: customName } : c
    ));
  }, []);

  return {
    transactions,
    connections,
    loading,
    syncing,
    error,
    fetchTransactions,
    fetchConnections,
    createConnectToken,
    saveConnection,
    syncTransactions,
    deleteConnection,
    importExistingConnections,
    importByItemId,
    getCategoryTotals,
    getTotalSpent,
    updateConnectionName,
  };
}
