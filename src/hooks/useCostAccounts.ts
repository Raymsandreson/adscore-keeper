import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface CostAccount {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export function useCostAccounts() {
  const [accounts, setAccounts] = useState<CostAccount[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('cost_accounts')
        .select('*')
        .order('display_order', { ascending: true });

      if (error) throw error;
      setAccounts((data as CostAccount[]) || []);
    } catch (err: any) {
      console.error('Error fetching cost accounts:', err);
      toast.error('Erro ao carregar contas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const addAccount = useCallback(async (account: Partial<CostAccount>) => {
    try {
      const { data, error } = await supabase
        .from('cost_accounts')
        .insert([{
          name: account.name,
          description: account.description || null,
          color: account.color || 'bg-blue-500',
          icon: account.icon || 'wallet',
          is_active: account.is_active ?? true,
          display_order: account.display_order || 0,
        }])
        .select()
        .single();

      if (error) throw error;
      toast.success('Conta criada');
      await fetchAccounts();
      return data as CostAccount;
    } catch (err: any) {
      console.error('Error adding cost account:', err);
      toast.error('Erro ao criar conta');
      throw err;
    }
  }, [fetchAccounts]);

  const updateAccount = useCallback(async (id: string, updates: Partial<CostAccount>) => {
    try {
      const { error } = await supabase
        .from('cost_accounts')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
      toast.success('Conta atualizada');
      await fetchAccounts();
    } catch (err: any) {
      console.error('Error updating cost account:', err);
      toast.error('Erro ao atualizar conta');
      throw err;
    }
  }, [fetchAccounts]);

  const deleteAccount = useCallback(async (id: string) => {
    try {
      const { error } = await supabase
        .from('cost_accounts')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('Conta removida');
      await fetchAccounts();
    } catch (err: any) {
      console.error('Error deleting cost account:', err);
      toast.error('Erro ao remover conta');
      throw err;
    }
  }, [fetchAccounts]);

  const getAccountById = useCallback((id: string) => {
    return accounts.find(a => a.id === id);
  }, [accounts]);

  const activeAccounts = accounts.filter(a => a.is_active);

  return {
    accounts,
    activeAccounts,
    loading,
    fetchAccounts,
    addAccount,
    updateAccount,
    deleteAccount,
    getAccountById,
  };
}
