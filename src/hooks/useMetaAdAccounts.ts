import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface MetaAdAccount {
  id: string;
  name: string;
  accessToken: string;
  accountId: string;
}

const LEGACY_STORAGE_KEY = "meta_saved_accounts";

export function useMetaAdAccounts() {
  const [accounts, setAccounts] = useState<MetaAdAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchAccounts = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data, error } = await supabase
        .from('meta_ad_accounts')
        .select('id, name, access_token, account_id')
        .order('created_at', { ascending: true });

      if (error) throw error;

      const mapped: MetaAdAccount[] = (data || []).map(r => ({
        id: r.id,
        name: r.name || '',
        accessToken: r.access_token,
        accountId: r.account_id,
      }));

      // Migrate from localStorage if DB is empty
      if (mapped.length === 0) {
        const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacy) {
          try {
            const legacyAccounts = JSON.parse(legacy) as any[];
            if (legacyAccounts.length > 0) {
              const rows = legacyAccounts.map(a => ({
                user_id: user.id,
                name: a.name || '',
                access_token: a.accessToken,
                account_id: a.accountId,
              }));
              const { data: inserted, error: insertError } = await supabase
                .from('meta_ad_accounts')
                .insert(rows)
                .select('id, name, access_token, account_id');

              if (!insertError && inserted) {
                localStorage.removeItem(LEGACY_STORAGE_KEY);
                setAccounts(inserted.map(r => ({
                  id: r.id,
                  name: r.name || '',
                  accessToken: r.access_token,
                  accountId: r.account_id,
                })));
                setLoading(false);
                return;
              }
            }
          } catch (e) {
            console.error('Error migrating legacy accounts:', e);
          }
        }
      }

      setAccounts(mapped);
    } catch (err) {
      console.error('Error fetching meta ad accounts:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  const addAccount = useCallback(async (account: Omit<MetaAdAccount, 'id'>): Promise<MetaAdAccount | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('meta_ad_accounts')
      .insert({
        user_id: user.id,
        name: account.name,
        access_token: account.accessToken,
        account_id: account.accountId,
      })
      .select('id, name, access_token, account_id')
      .single();

    if (error) {
      toast({ title: 'Erro ao salvar conta', description: error.message, variant: 'destructive' });
      return null;
    }

    const newAccount: MetaAdAccount = {
      id: data.id,
      name: data.name || '',
      accessToken: data.access_token,
      accountId: data.account_id,
    };
    setAccounts(prev => [...prev, newAccount]);
    return newAccount;
  }, [toast]);

  const deleteAccount = useCallback(async (id: string) => {
    const { error } = await supabase.from('meta_ad_accounts').delete().eq('id', id);
    if (error) {
      toast({ title: 'Erro ao remover conta', description: error.message, variant: 'destructive' });
      return;
    }
    setAccounts(prev => prev.filter(a => a.id !== id));
  }, [toast]);

  const updateAccount = useCallback(async (id: string, updates: Partial<Omit<MetaAdAccount, 'id'>>) => {
    const payload: Record<string, string> = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.accessToken !== undefined) payload.access_token = updates.accessToken;
    if (updates.accountId !== undefined) payload.account_id = updates.accountId;

    const { error } = await supabase.from('meta_ad_accounts').update(payload).eq('id', id);
    if (error) {
      toast({ title: 'Erro ao atualizar conta', description: error.message, variant: 'destructive' });
      return;
    }
    setAccounts(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
  }, [toast]);

  return { accounts, loading, addAccount, deleteAccount, updateAccount, refetch: fetchAccounts };
}
