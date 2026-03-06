import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ContactClassificationRecord {
  id: string;
  name: string;
  color: string;
  icon: string;
  display_order: number;
  is_system: boolean;
  show_in_workflow: boolean;
  created_at: string;
}

// Color options for new classifications
export const classificationColors = [
  { value: 'bg-red-500', label: 'Vermelho' },
  { value: 'bg-orange-500', label: 'Laranja' },
  { value: 'bg-amber-500', label: 'Âmbar' },
  { value: 'bg-yellow-500', label: 'Amarelo' },
  { value: 'bg-lime-500', label: 'Lima' },
  { value: 'bg-green-500', label: 'Verde' },
  { value: 'bg-emerald-500', label: 'Esmeralda' },
  { value: 'bg-teal-500', label: 'Teal' },
  { value: 'bg-cyan-500', label: 'Ciano' },
  { value: 'bg-sky-500', label: 'Céu' },
  { value: 'bg-blue-500', label: 'Azul' },
  { value: 'bg-indigo-500', label: 'Índigo' },
  { value: 'bg-violet-500', label: 'Violeta' },
  { value: 'bg-purple-500', label: 'Roxo' },
  { value: 'bg-fuchsia-500', label: 'Fúcsia' },
  { value: 'bg-pink-500', label: 'Rosa' },
  { value: 'bg-rose-500', label: 'Rose' },
  { value: 'bg-slate-500', label: 'Cinza' },
];

export const useContactClassifications = () => {
  const [classifications, setClassifications] = useState<ContactClassificationRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchClassifications = useCallback(async () => {
    try {
      const { data, error } = await (supabase as any)
        .from('contact_classifications')
        .select('*')
        .order('display_order', { ascending: true });

      if (error) throw error;
      setClassifications((data || []) as ContactClassificationRecord[]);
    } catch (error) {
      console.error('Error fetching classifications:', error);
    }
  }, []);

  const addClassification = async (name: string, color: string = 'bg-gray-500', showInWorkflow: boolean = true) => {
    if (!name.trim()) {
      toast.error('Nome da classificação é obrigatório');
      return null;
    }

    // Check if classification already exists
    const exists = classifications.some(
      c => c.name.toLowerCase() === name.toLowerCase().trim()
    );
    if (exists) {
      toast.error('Essa classificação já existe');
      return null;
    }

    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('contact_classifications')
        .insert([{
          name: name.toLowerCase().trim().replace(/\s+/g, '_'),
          color,
          display_order: classifications.length + 1,
          is_system: false,
          show_in_workflow: showInWorkflow
        }])
        .select()
        .single();

      if (error) throw error;
      
      toast.success('Classificação criada com sucesso!');
      await fetchClassifications();
      return data;
    } catch (error: any) {
      console.error('Error adding classification:', error);
      if (error.code === '23505') {
        toast.error('Essa classificação já existe');
      } else {
        toast.error('Erro ao criar classificação');
      }
      return null;
    } finally {
      setLoading(false);
    }
  };

  const updateClassification = async (id: string, updates: Partial<Pick<ContactClassificationRecord, 'name' | 'color' | 'show_in_workflow'>>) => {
    try {
      const { error } = await (supabase as any)
        .from('contact_classifications')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
      
      toast.success('Classificação atualizada');
      await fetchClassifications();
    } catch (error) {
      console.error('Error updating classification:', error);
      toast.error('Erro ao atualizar classificação');
    }
  };

  const deleteClassification = async (id: string) => {
    try {
      const { error } = await (supabase as any)
        .from('contact_classifications')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      toast.success('Classificação removida');
      await fetchClassifications();
    } catch (error) {
      console.error('Error deleting classification:', error);
      toast.error('Erro ao remover classificação');
    }
  };

  useEffect(() => {
    fetchClassifications();
  }, [fetchClassifications]);

  // Build config object for use in components
  const classificationConfig = classifications.reduce((acc, c) => {
    const labelMap: Record<string, string> = {
      client: 'Cliente',
      non_client: 'Não-Cliente',
      prospect: 'Prospect',
      partner: 'Parceiro',
      supplier: 'Fornecedor',
      ponte: 'Ponte',
      ex_cliente: 'Ex-cliente',
      advogado_interno: 'Advogado Interno',
      advogado_externo: 'Advogado Externo',
      advogado_adverso: 'Advogado Adverso',
      parte_contraria: 'Parte Contrária',
      prestador_servico: 'Prestador de Serviço',
      equipe_interna: 'Equipe Interna',
    };
    acc[c.name] = {
      label: labelMap[c.name] || c.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      color: c.color,
      isSystem: c.is_system,
      showInWorkflow: c.show_in_workflow
    };
    return acc;
  }, {} as Record<string, { label: string; color: string; isSystem: boolean; showInWorkflow: boolean }>);

  return {
    classifications,
    classificationConfig,
    loading,
    fetchClassifications,
    addClassification,
    updateClassification,
    deleteClassification,
  };
};
