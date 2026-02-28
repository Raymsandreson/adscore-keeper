import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';
import { format } from 'date-fns';

export interface FinancialEntry {
  id: string;
  entry_date: string;
  entry_type: 'entrada' | 'saida';
  company_id: string;
  cost_center_id: string | null;
  category_id: string | null;
  nature: string | null;
  recurrence: string | null;
  nucleus_id: string | null;
  beneficiary_id: string | null;
  description: string | null;
  cash_amount: number;
  accrual_amount: number | null;
  accrual_start_date: string | null;
  accrual_end_date: string | null;
  invoice_number: string | null;
  invoice_url: string | null;
  linked_account: string | null;
  payment_method: string | null;
  reference_id: string | null;
  source_type: 'manual' | 'credit_card' | 'bank' | null;
  source_transaction_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface DateRange { start: Date; end: Date; }

export function useFinancialEntries() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<FinancialEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchEntries = useCallback(async (dateRange?: DateRange, filters?: { company_id?: string; entry_type?: string }) => {
    if (!user) return;
    setLoading(true);
    try {
      let query = supabase.from('financial_entries').select('*').order('entry_date', { ascending: false });
      if (dateRange) {
        query = query.gte('entry_date', format(dateRange.start, 'yyyy-MM-dd')).lte('entry_date', format(dateRange.end, 'yyyy-MM-dd'));
      }
      if (filters?.company_id) query = query.eq('company_id', filters.company_id);
      if (filters?.entry_type) query = query.eq('entry_type', filters.entry_type);
      const { data, error } = await query;
      if (error) throw error;
      setEntries((data as FinancialEntry[]) || []);
    } catch (err: any) {
      console.error('Error fetching financial entries:', err);
      toast.error('Erro ao carregar lançamentos');
    } finally {
      setLoading(false);
    }
  }, [user]);

  const addEntry = useCallback(async (entry: Partial<FinancialEntry>) => {
    if (!user) throw new Error('Not authenticated');
    const insertData = {
      entry_date: entry.entry_date,
      entry_type: entry.entry_type || 'saida',
      company_id: entry.company_id!,
      cost_center_id: entry.cost_center_id || null,
      category_id: entry.category_id || null,
      nature: entry.nature || null,
      recurrence: entry.recurrence || null,
      nucleus_id: entry.nucleus_id || null,
      beneficiary_id: entry.beneficiary_id || null,
      description: entry.description || null,
      cash_amount: entry.cash_amount || 0,
      accrual_amount: entry.accrual_amount || null,
      accrual_start_date: entry.accrual_start_date || null,
      accrual_end_date: entry.accrual_end_date || null,
      invoice_number: entry.invoice_number || null,
      invoice_url: entry.invoice_url || null,
      linked_account: entry.linked_account || null,
      payment_method: entry.payment_method || null,
      reference_id: entry.reference_id || null,
      source_type: entry.source_type || 'manual',
      source_transaction_id: entry.source_transaction_id || null,
      created_by: user.id,
    };
    const { data, error } = await supabase.from('financial_entries').insert([insertData]).select().single();
    if (error) throw error;
    toast.success('Lançamento criado');
    return data as FinancialEntry;
  }, [user]);

  const updateEntry = useCallback(async (id: string, updates: Partial<FinancialEntry>) => {
    const { error } = await supabase.from('financial_entries').update(updates).eq('id', id);
    if (error) throw error;
    toast.success('Lançamento atualizado');
  }, []);

  const deleteEntry = useCallback(async (id: string) => {
    const { error } = await supabase.from('financial_entries').delete().eq('id', id);
    if (error) throw error;
    toast.success('Lançamento removido');
  }, []);

  const uploadInvoice = useCallback(async (file: File, entryId: string) => {
    const ext = file.name.split('.').pop();
    const path = `${user?.id}/${entryId}.${ext}`;
    const { error: uploadError } = await supabase.storage.from('invoices').upload(path, file, { upsert: true });
    if (uploadError) throw uploadError;
    const { data: urlData } = supabase.storage.from('invoices').getPublicUrl(path);
    await updateEntry(entryId, { invoice_url: urlData.publicUrl });
    return urlData.publicUrl;
  }, [user, updateEntry]);

  return { entries, loading, fetchEntries, addEntry, updateEntry, deleteEntry, uploadInvoice };
}
