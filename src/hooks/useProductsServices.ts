import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ProductService {
  id: string;
  company_id: string | null;
  nucleus_id: string | null;
  name: string;
  description: string | null;
  ticket_tier: 'low' | 'medium' | 'high';
  product_type: 'product' | 'service' | 'subscription' | 'consulting';
  strategy_focus: 'cash' | 'equity' | 'hybrid';
  area: string | null;
  price_range_min: number | null;
  price_range_max: number | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export function useProductsServices() {
  const [products, setProducts] = useState<ProductService[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('products_services')
        .select('*')
        .order('display_order', { ascending: true });
      if (error) throw error;
      setProducts((data as ProductService[]) || []);
    } catch (err: any) {
      console.error('Error fetching products:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const addProduct = useCallback(async (p: Partial<ProductService>) => {
    const { data, error } = await supabase
      .from('products_services')
      .insert([{
        company_id: p.company_id || null,
        nucleus_id: p.nucleus_id || null,
        name: p.name,
        description: p.description || null,
        ticket_tier: p.ticket_tier || 'medium',
        product_type: p.product_type || 'service',
        strategy_focus: p.strategy_focus || 'cash',
        area: p.area || null,
        price_range_min: p.price_range_min || null,
        price_range_max: p.price_range_max || null,
        is_active: true,
        display_order: p.display_order || 0,
      }])
      .select().single();
    if (error) throw error;
    toast.success('Produto/serviço criado');
    await fetchProducts();
    return data as ProductService;
  }, [fetchProducts]);

  const updateProduct = useCallback(async (id: string, updates: Partial<ProductService>) => {
    const { error } = await supabase.from('products_services').update(updates).eq('id', id);
    if (error) throw error;
    toast.success('Produto/serviço atualizado');
    await fetchProducts();
  }, [fetchProducts]);

  const deleteProduct = useCallback(async (id: string) => {
    const { error } = await supabase.from('products_services').delete().eq('id', id);
    if (error) throw error;
    toast.success('Produto/serviço removido');
    await fetchProducts();
  }, [fetchProducts]);

  const getByCompany = useCallback((companyId: string) => {
    return products.filter(p => p.company_id === companyId && p.is_active);
  }, [products]);

  const getByTier = useCallback((tier: string) => {
    return products.filter(p => p.ticket_tier === tier && p.is_active);
  }, [products]);

  return { products, loading, fetchProducts, addProduct, updateProduct, deleteProduct, getByCompany, getByTier };
}
