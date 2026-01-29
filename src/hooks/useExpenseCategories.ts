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
  parent_id: string | null;
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

export interface DailyLimitAnalysis {
  date: string;
  categoryId: string;
  categoryName: string;
  limit: number;
  totalSpent: number;
  exceeded: boolean;
  diff: number;
  transactionCount: number;
}

export interface AverageLimitAnalysis {
  categoryId: string;
  categoryName: string;
  limit: number;
  averageDaily: number;
  averageMonthly: number;
  daysWithTransactions: number;
  totalSpent: number;
  exceedsAverageDaily: boolean;
  exceedsAverageMonthly: boolean;
}

export interface Transaction {
  id: string;
  amount: number;
  transaction_date: string;
  category?: string | null;
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
          parent_id: category.parent_id || null,
        }])
        .select()
        .single();

      if (error) throw error;
      toast.success(category.parent_id ? 'Subcategoria criada' : 'Categoria criada');
      await fetchCategories();
      return data as ExpenseCategory;
    } catch (err: any) {
      console.error('Error adding category:', err);
      toast.error('Erro ao criar categoria');
      throw err;
    }
  }, [fetchCategories]);

  const getParentCategories = useCallback(() => {
    return categories.filter(c => !c.parent_id);
  }, [categories]);

  const getSubcategories = useCallback((parentId: string) => {
    return categories.filter(c => c.parent_id === parentId);
  }, [categories]);

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

  // Check if a category has linked expenses (overrides)
  const getCategoryExpenseCount = useCallback(async (categoryId: string): Promise<number> => {
    const { count, error } = await supabase
      .from('transaction_category_overrides')
      .select('*', { count: 'exact', head: true })
      .eq('category_id', categoryId);
    
    if (error) {
      console.error('Error counting expenses:', error);
      return 0;
    }
    return count || 0;
  }, []);

  // Reassign expenses from one category to another
  const reassignExpenses = useCallback(async (fromCategoryId: string, toCategoryId: string) => {
    try {
      const { error } = await supabase
        .from('transaction_category_overrides')
        .update({ category_id: toCategoryId })
        .eq('category_id', fromCategoryId);

      if (error) throw error;
      await fetchOverrides();
    } catch (err: any) {
      console.error('Error reassigning expenses:', err);
      throw err;
    }
  }, [fetchOverrides]);

  const deleteCategory = useCallback(async (id: string, reassignToCategoryId?: string) => {
    try {
      // If reassignment is needed, do it first
      if (reassignToCategoryId) {
        await reassignExpenses(id, reassignToCategoryId);
      }

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
  }, [fetchCategories, reassignExpenses]);

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

  // Check limit violation for a single transaction (per_transaction type)
  const checkLimitViolation = useCallback((category: ExpenseCategory, amount: number) => {
    if (!category.max_limit_per_unit || category.limit_unit !== 'per_transaction') return null;
    
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

  // Calculate daily totals for a category from a list of transactions
  const calculateDailyLimits = useCallback((
    transactions: Transaction[],
    categoryId: string,
    overridesMap: Map<string, string>
  ): DailyLimitAnalysis[] => {
    const category = categories.find(c => c.id === categoryId);
    if (!category || !category.max_limit_per_unit || category.limit_unit !== 'per_day') {
      return [];
    }

    // Group transactions by date
    const dailyTotals = new Map<string, { total: number; count: number }>();

    transactions.forEach(tx => {
      const txCategoryId = overridesMap.get(tx.id) || null;
      if (txCategoryId !== categoryId) return;

      const dateKey = tx.transaction_date;
      const current = dailyTotals.get(dateKey) || { total: 0, count: 0 };
      dailyTotals.set(dateKey, {
        total: current.total + Math.abs(tx.amount),
        count: current.count + 1,
      });
    });

    const results: DailyLimitAnalysis[] = [];
    dailyTotals.forEach((data, date) => {
      const exceeded = data.total > category.max_limit_per_unit!;
      results.push({
        date,
        categoryId,
        categoryName: category.name,
        limit: category.max_limit_per_unit!,
        totalSpent: data.total,
        exceeded,
        diff: exceeded ? data.total - category.max_limit_per_unit! : 0,
        transactionCount: data.count,
      });
    });

    return results.sort((a, b) => b.date.localeCompare(a.date));
  }, [categories]);

  // Calculate average spending analysis for a category
  const calculateAverageAnalysis = useCallback((
    transactions: Transaction[],
    categoryId: string,
    overridesMap: Map<string, string>
  ): AverageLimitAnalysis | null => {
    const category = categories.find(c => c.id === categoryId);
    if (!category || !category.max_limit_per_unit) {
      return null;
    }

    // Filter transactions for this category
    const categoryTransactions = transactions.filter(tx => {
      const txCategoryId = overridesMap.get(tx.id) || null;
      return txCategoryId === categoryId;
    });

    if (categoryTransactions.length === 0) {
      return null;
    }

    // Calculate totals
    const totalSpent = categoryTransactions.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
    
    // Get unique days with transactions
    const uniqueDays = new Set(categoryTransactions.map(tx => tx.transaction_date));
    const daysWithTransactions = uniqueDays.size;

    // Calculate averages
    const averageDaily = daysWithTransactions > 0 ? totalSpent / daysWithTransactions : 0;
    
    // For monthly average, we estimate based on the date range
    const dates = categoryTransactions.map(tx => new Date(tx.transaction_date));
    const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
    const monthsSpan = Math.max(1, (maxDate.getFullYear() - minDate.getFullYear()) * 12 + (maxDate.getMonth() - minDate.getMonth()) + 1);
    const averageMonthly = totalSpent / monthsSpan;

    // Check if averages exceed limits based on limit_unit
    let exceedsAverageDaily = false;
    let exceedsAverageMonthly = false;

    if (category.limit_unit === 'per_day') {
      exceedsAverageDaily = averageDaily > category.max_limit_per_unit;
    } else if (category.limit_unit === 'per_month') {
      exceedsAverageMonthly = averageMonthly > category.max_limit_per_unit;
    }

    return {
      categoryId,
      categoryName: category.name,
      limit: category.max_limit_per_unit,
      averageDaily,
      averageMonthly,
      daysWithTransactions,
      totalSpent,
      exceedsAverageDaily,
      exceedsAverageMonthly,
    };
  }, [categories]);

  // Get all daily violations across all categories
  const getAllDailyViolations = useCallback((
    transactions: Transaction[]
  ): DailyLimitAnalysis[] => {
    const overridesMap = new Map(overrides.map(o => [o.transaction_id, o.category_id]));
    
    const allViolations: DailyLimitAnalysis[] = [];
    
    categories.forEach(category => {
      if (category.limit_unit === 'per_day' && category.max_limit_per_unit) {
        const dailyResults = calculateDailyLimits(transactions, category.id, overridesMap);
        allViolations.push(...dailyResults.filter(r => r.exceeded));
      }
    });

    return allViolations.sort((a, b) => b.date.localeCompare(a.date));
  }, [categories, overrides, calculateDailyLimits]);

  // Get average analysis for all categories
  const getAllAverageAnalysis = useCallback((
    transactions: Transaction[]
  ): AverageLimitAnalysis[] => {
    const overridesMap = new Map(overrides.map(o => [o.transaction_id, o.category_id]));
    
    const analyses: AverageLimitAnalysis[] = [];
    
    categories.forEach(category => {
      if (category.max_limit_per_unit) {
        const analysis = calculateAverageAnalysis(transactions, category.id, overridesMap);
        if (analysis) {
          analyses.push(analysis);
        }
      }
    });

    return analyses;
  }, [categories, overrides, calculateAverageAnalysis]);

  useEffect(() => {
    let isMounted = true;
    
    const loadData = async () => {
      if (isMounted) {
        await fetchCategories();
        await fetchCardAssignments();
        await fetchOverrides();
      }
    };
    
    loadData();
    
    return () => {
      isMounted = false;
    };
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
    getCategoryExpenseCount,
    reassignExpenses,
    assignCard,
    updateCardAssignment,
    removeCardAssignment,
    setTransactionOverride,
    getCardAssignment,
    getTransactionOverride,
    getCategoryById,
    checkLimitViolation,
    getParentCategories,
    getSubcategories,
    calculateDailyLimits,
    calculateAverageAnalysis,
    getAllDailyViolations,
    getAllAverageAnalysis,
  };
}
