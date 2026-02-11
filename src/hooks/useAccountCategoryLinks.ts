import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface AccountCategoryLink {
  id: string;
  pluggy_account_id: string;
  category_id: string;
  created_at: string;
}

export function useAccountCategoryLinks() {
  const [links, setLinks] = useState<AccountCategoryLink[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLinks = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('account_category_links')
        .select('*');

      if (error) throw error;
      setLinks((data as AccountCategoryLink[]) || []);
    } catch (err: any) {
      console.error('Error fetching account category links:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const getLinksForAccount = useCallback((pluggyAccountId: string) => {
    return links.filter(l => l.pluggy_account_id === pluggyAccountId);
  }, [links]);

  const getLinksForCategory = useCallback((categoryId: string) => {
    return links.filter(l => l.category_id === categoryId);
  }, [links]);

  // Get categories available for a specific account
  // If no links exist for this account, all categories are available
  const getCategoryIdsForAccount = useCallback((pluggyAccountId: string): string[] | null => {
    const accountLinks = links.filter(l => l.pluggy_account_id === pluggyAccountId);
    if (accountLinks.length === 0) return null; // null means "all categories"
    return accountLinks.map(l => l.category_id);
  }, [links]);

  const setLinksForCategory = useCallback(async (categoryId: string, accountIds: string[]) => {
    try {
      // Delete existing links for this category
      await supabase
        .from('account_category_links')
        .delete()
        .eq('category_id', categoryId);

      // Insert new links
      if (accountIds.length > 0) {
        const inserts = accountIds.map(accountId => ({
          pluggy_account_id: accountId,
          category_id: categoryId,
        }));

        const { error } = await supabase
          .from('account_category_links')
          .insert(inserts);

        if (error) throw error;
      }

      await fetchLinks();
      toast.success('Contas vinculadas à categoria');
    } catch (err: any) {
      console.error('Error setting account category links:', err);
      toast.error('Erro ao vincular contas');
      throw err;
    }
  }, [fetchLinks]);

  const addLinkForAccount = useCallback(async (pluggyAccountId: string, categoryId: string) => {
    try {
      const { error } = await supabase
        .from('account_category_links')
        .upsert([{ pluggy_account_id: pluggyAccountId, category_id: categoryId }], {
          onConflict: 'pluggy_account_id,category_id'
        });

      if (error) throw error;
      await fetchLinks();
    } catch (err: any) {
      console.error('Error adding link:', err);
      throw err;
    }
  }, [fetchLinks]);

  const removeLinkForAccount = useCallback(async (pluggyAccountId: string, categoryId: string) => {
    try {
      const { error } = await supabase
        .from('account_category_links')
        .delete()
        .eq('pluggy_account_id', pluggyAccountId)
        .eq('category_id', categoryId);

      if (error) throw error;
      await fetchLinks();
    } catch (err: any) {
      console.error('Error removing link:', err);
      throw err;
    }
  }, [fetchLinks]);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  return {
    links,
    loading,
    fetchLinks,
    getLinksForAccount,
    getLinksForCategory,
    getCategoryIdsForAccount,
    setLinksForCategory,
    addLinkForAccount,
    removeLinkForAccount,
  };
}
