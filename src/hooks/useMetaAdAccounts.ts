import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface MetaAdAccount {
  id: string;
  name: string;
  accessToken: string;
  accountId: string;
  wabaId?: string;
}

const LEGACY_STORAGE_KEY = "meta_saved_accounts";

/**
 * Try to fetch the WABA ID from the Meta API using the access token.
 * This is needed for Conversions API for Business Messaging.
 */
async function fetchWabaId(accessToken: string): Promise<string | null> {
  try {
    // First try to get the business ID
    const meResp = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id&access_token=${accessToken}`
    );
    const meData = await meResp.json();
    if (!meData.id) return null;

    // Try to get WABA from the business
    const wabaResp = await fetch(
      `https://graph.facebook.com/v21.0/me/whatsapp_business_accounts?access_token=${accessToken}`
    );
    const wabaData = await wabaResp.json();
    
    if (wabaData.data && wabaData.data.length > 0) {
      return wabaData.data[0].id;
    }
    
    return null;
  } catch (err) {
    console.error('Error fetching WABA ID:', err);
    return null;
  }
}

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
        .select('*')
        .order('created_at', { ascending: true });

      if (error) throw error;

      const mapped: MetaAdAccount[] = (data || []).map((r: any) => ({
        id: r.id,
        name: r.name || '',
        accessToken: r.access_token,
        accountId: r.account_id,
        wabaId: r.waba_id || undefined,
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
                .select('*');

              if (!insertError && inserted) {
                localStorage.removeItem(LEGACY_STORAGE_KEY);
                setAccounts(inserted.map((r: any) => ({
                  id: r.id,
                  name: r.name || '',
                  accessToken: r.access_token,
                  accountId: r.account_id,
                  wabaId: r.waba_id || undefined,
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

    // Try to auto-detect WABA ID
    let wabaId = account.wabaId || null;
    if (!wabaId) {
      wabaId = await fetchWabaId(account.accessToken);
      if (wabaId) {
        console.log('[Meta] Auto-detected WABA ID:', wabaId);
      }
    }

    const insertData: any = {
      user_id: user.id,
      name: account.name,
      access_token: account.accessToken,
      account_id: account.accountId,
    };
    if (wabaId) insertData.waba_id = wabaId;

    const { data, error } = await supabase
      .from('meta_ad_accounts')
      .insert(insertData)
      .select('*')
      .single();

    if (error) {
      toast({ title: 'Erro ao salvar conta', description: error.message, variant: 'destructive' });
      return null;
    }

    const newAccount: MetaAdAccount = {
      id: data.id,
      name: (data as any).name || '',
      accessToken: (data as any).access_token,
      accountId: (data as any).account_id,
      wabaId: (data as any).waba_id || undefined,
    };
    setAccounts(prev => [...prev, newAccount]);

    if (wabaId) {
      toast({ title: 'WABA ID detectado', description: `Conversions API para WhatsApp configurada automaticamente (WABA: ${wabaId})` });
    }

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
    if (updates.wabaId !== undefined) payload.waba_id = updates.wabaId;

    const { error } = await supabase.from('meta_ad_accounts').update(payload).eq('id', id);
    if (error) {
      toast({ title: 'Erro ao atualizar conta', description: error.message, variant: 'destructive' });
      return;
    }
    setAccounts(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
  }, [toast]);

  return { accounts, loading, addAccount, deleteAccount, updateAccount, refetch: fetchAccounts };
}
