import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ExpenseCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
  max_limit_per_unit: number | null;
  limit_unit: 'per_transaction' | 'per_day' | 'per_month' | null;
  is_system: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface CardAssignment {
  id: string;
  card_last_digits: string;
  card_name: string | null;
  lead_id: string | null;
  lead_name: string | null;
  pluggy_account_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransactionOverride {
  id: string;
  transaction_id: string;
  category_id: string;
  lead_id: string | null;
  notes: string | null;
  created_at: string;
}

export function useExpenseCategories() {
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [cardAssignments, setCardAssignments] = useState<CardAssignment[]>([]);
  const [overrides, setOverrides] = useState<TransactionOverride[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('expense_categories')
        .select('*')
        .order('display_order', { ascending: true });

      if (error) throw error;
      setCategories((data as ExpenseCategory[]) || []);
    } catch (err: any) {
      console.error('Error fetching categories:', err);
      toast.error('Erro ao carregar categorias');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCardAssignments = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('card_assignments')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCardAssignments((data as CardAssignment[]) || []);
    } catch (err: any) {
      console.error('Error fetching card assignments:', err);
    }
  }, []);

  const fetchOverrides = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('transaction_category_overrides')
        .select('*');

      if (error) throw error;
      setOverrides((data as TransactionOverride[]) || []);
    } catch (err: any) {
      console.error('Error fetching overrides:', err);
    }
  }, []);

  const addCategory = useCallback(async (category: Partial<ExpenseCategory>) => {
    try {
      const { data, error } = await supabase
        .from('expense_categories')
        .insert([{
          name: category.name,
          icon: category.icon || 'tag',
          color: category.color || 'bg-gray-500',
          max_limit_per_unit: category.max_limit_per_unit || null,
          limit_unit: category.limit_unit || null,
          is_system: false,
          display_order: category.display_order || 50,
        }])
        .select()
        .single();

      if (error) throw error;
      toast.success('Categoria criada');
      await fetchCategories();
      return data as ExpenseCategory;
    } catch (err: any) {
      console.error('Error adding category:', err);
      toast.error('Erro ao criar categoria');
      throw err;
    }
  }, [fetchCategories]);

  const updateCategory = useCallback(async (id: string, updates: Partial<ExpenseCategory>) => {
    try {
      const { error } = await supabase
        .from('expense_categories')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
      toast.success('Categoria atualizada');
      await fetchCategories();
    } catch (err: any) {
      console.error('Error updating category:', err);
      toast.error('Erro ao atualizar categoria');
      throw err;
    }
  }, [fetchCategories]);

  const deleteCategory = useCallback(async (id: string) => {
    try {
      const { error } = await supabase
        .from('expense_categories')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('Categoria removida');
      await fetchCategories();
    } catch (err: any) {
      console.error('Error deleting category:', err);
      toast.error('Erro ao remover categoria');
      throw err;
    }
  }, [fetchCategories]);

  const assignCard = useCallback(async (assignment: Partial<CardAssignment>) => {
    try {
      const { data, error } = await supabase
        .from('card_assignments')
        .upsert([{
          card_last_digits: assignment.card_last_digits,
          card_name: assignment.card_name || null,
          lead_id: assignment.lead_id || null,
          lead_name: assignment.lead_name || null,
          pluggy_account_id: assignment.pluggy_account_id || null,
          notes: assignment.notes || null,
        }], { onConflict: 'card_last_digits,pluggy_account_id' })
        .select()
        .single();

      if (error) throw error;
      toast.success('Cartão vinculado ao acolhedor');
      await fetchCardAssignments();
      return data as CardAssignment;
    } catch (err: any) {
      console.error('Error assigning card:', err);
      toast.error('Erro ao vincular cartão');
      throw err;
    }
  }, [fetchCardAssignments]);

  const updateCardAssignment = useCallback(async (id: string, updates: Partial<CardAssignment>) => {
    try {
      const { error } = await supabase
        .from('card_assignments')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
      toast.success('Cartão atualizado');
      await fetchCardAssignments();
    } catch (err: any) {
      console.error('Error updating card assignment:', err);
      toast.error('Erro ao atualizar cartão');
      throw err;
    }
  }, [fetchCardAssignments]);

  const removeCardAssignment = useCallback(async (id: string) => {
    try {
      const { error } = await supabase
        .from('card_assignments')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('Vínculo removido');
      await fetchCardAssignments();
    } catch (err: any) {
      console.error('Error removing assignment:', err);
      toast.error('Erro ao remover vínculo');
      throw err;
    }
  }, [fetchCardAssignments]);

  const setTransactionOverride = useCallback(async (
    transactionId: string, 
    categoryId: string, 
    leadId?: string,
    notes?: string
  ) => {
    try {
      const { error } = await supabase
        .from('transaction_category_overrides')
        .upsert([{
          transaction_id: transactionId,
          category_id: categoryId,
          lead_id: leadId || null,
          notes: notes || null,
        }], { onConflict: 'transaction_id' });

      if (error) throw error;
      toast.success('Transação categorizada');
      await fetchOverrides();
    } catch (err: any) {
      console.error('Error setting override:', err);
      toast.error('Erro ao categorizar transação');
      throw err;
    }
  }, [fetchOverrides]);

  const getCardAssignment = useCallback((cardLastDigits: string) => {
    return cardAssignments.find(a => a.card_last_digits === cardLastDigits);
  }, [cardAssignments]);

  const getTransactionOverride = useCallback((transactionId: string) => {
    return overrides.find(o => o.transaction_id === transactionId);
  }, [overrides]);

  const getCategoryById = useCallback((id: string) => {
    return categories.find(c => c.id === id);
  }, [categories]);

  const checkLimitViolation = useCallback((category: ExpenseCategory, amount: number) => {
    if (!category.max_limit_per_unit || !category.limit_unit) return null;
    
    if (Math.abs(amount) > category.max_limit_per_unit) {
      return {
        exceeded: true,
        limit: category.max_limit_per_unit,
        amount: Math.abs(amount),
        diff: Math.abs(amount) - category.max_limit_per_unit,
      };
    }
    return null;
  }, []);

  useEffect(() => {
    fetchCategories();
    fetchCardAssignments();
    fetchOverrides();
  }, [fetchCategories, fetchCardAssignments, fetchOverrides]);

  return {
    categories,
    cardAssignments,
    overrides,
    loading,
    fetchCategories,
    fetchCardAssignments,
    addCategory,
    updateCategory,
    deleteCategory,
    assignCard,
    updateCardAssignment,
    removeCardAssignment,
    setTransactionOverride,
    getCardAssignment,
    getTransactionOverride,
    getCategoryById,
    checkLimitViolation,
  };
}
