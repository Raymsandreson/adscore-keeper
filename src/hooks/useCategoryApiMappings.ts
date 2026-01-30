import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface CategoryApiMapping {
  id: string;
  category_id: string;
  api_category_name: string;
  created_at: string;
}

// Lista de todas as categorias disponíveis da API Pluggy (traduzidas)
export const availableApiCategories = [
  'Restaurantes',
  'Alimentação',
  'Fast Food',
  'Cafeterias',
  'Supermercado',
  'Supermercados',
  'Padarias',
  'Refeições Fora',
  'Transporte',
  'Postos de Combustível',
  'Combustível',
  'Estacionamento',
  'Transporte Público',
  'Táxi',
  'Uber',
  'Aplicativos de Transporte',
  'Aluguel de Carro',
  'Automóvel',
  'Manutenção de Veículo',
  'Viagem',
  'Companhias Aéreas',
  'Hotéis',
  'Hospedagem',
  'Férias',
  'Compras',
  'Vestuário',
  'Eletrônicos',
  'Lojas de Departamento',
  'Compras Online',
  'Artigos para Casa',
  'Entretenimento',
  'Cinema',
  'Música',
  'Jogos',
  'Streaming',
  'Esportes',
  'Saúde',
  'Farmácia',
  'Médico',
  'Hospitais',
  'Dentista',
  'Academia',
  'Fitness',
  'Serviços',
  'Utilidades',
  'Telefone',
  'Internet',
  'Seguros',
  'Serviços Profissionais',
  'Jurídico',
  'Serviços Digitais',
  'Educação',
  'Livros',
  'Cursos',
  'Casa',
  'Reforma',
  'Móveis',
  'Aluguel',
  'Finanças',
  'Taxas Bancárias',
  'Caixa Eletrônico',
  'Transferência',
  'Investimento',
  'Impostos',
  'Pagamento de Cartão',
  'Cartão de Crédito',
  'Animais de Estimação',
  'Pet Shop',
  'Veterinário',
  'Outros',
  'Sem Categoria',
  'Geral',
  'Diversos',
  'Desconhecido',
  'Pagamento',
  'Contas',
  'Assinatura',
  'Assinaturas',
];

export function useCategoryApiMappings() {
  const [mappings, setMappings] = useState<CategoryApiMapping[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchMappings = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('category_api_mappings')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMappings(data || []);
    } catch (err: any) {
      console.error('Error fetching category mappings:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const getMappingsForCategory = useCallback((categoryId: string) => {
    return mappings.filter(m => m.category_id === categoryId);
  }, [mappings]);

  const addMapping = useCallback(async (categoryId: string, apiCategoryName: string) => {
    try {
      const { error } = await supabase
        .from('category_api_mappings')
        .insert([{ category_id: categoryId, api_category_name: apiCategoryName }]);

      if (error) {
        if (error.code === '23505') {
          toast.error('Esta categoria da API já está vinculada');
          return;
        }
        throw error;
      }
      
      toast.success('Categoria da API vinculada');
      await fetchMappings();
    } catch (err: any) {
      console.error('Error adding mapping:', err);
      toast.error('Erro ao vincular categoria');
    }
  }, [fetchMappings]);

  const removeMapping = useCallback(async (mappingId: string) => {
    try {
      const { error } = await supabase
        .from('category_api_mappings')
        .delete()
        .eq('id', mappingId);

      if (error) throw error;
      toast.success('Vínculo removido');
      await fetchMappings();
    } catch (err: any) {
      console.error('Error removing mapping:', err);
      toast.error('Erro ao remover vínculo');
    }
  }, [fetchMappings]);

  const setMappingsForCategory = useCallback(async (categoryId: string, apiCategories: string[]) => {
    try {
      // Remove existing mappings
      await supabase
        .from('category_api_mappings')
        .delete()
        .eq('category_id', categoryId);

      // Add new mappings
      if (apiCategories.length > 0) {
        const { error } = await supabase
          .from('category_api_mappings')
          .insert(apiCategories.map(name => ({
            category_id: categoryId,
            api_category_name: name
          })));

        if (error) throw error;
      }

      await fetchMappings();
    } catch (err: any) {
      console.error('Error setting mappings:', err);
      toast.error('Erro ao salvar mapeamentos');
    }
  }, [fetchMappings]);

  // Find local category by API category name
  const findLocalCategoryByApiName = useCallback((apiCategoryName: string): string | null => {
    const mapping = mappings.find(m => 
      m.api_category_name.toLowerCase() === apiCategoryName.toLowerCase()
    );
    return mapping?.category_id || null;
  }, [mappings]);

  useEffect(() => {
    fetchMappings();
  }, [fetchMappings]);

  return {
    mappings,
    loading,
    fetchMappings,
    getMappingsForCategory,
    addMapping,
    removeMapping,
    setMappingsForCategory,
    findLocalCategoryByApiName,
    availableApiCategories,
  };
}
