import { externalSupabase as supabase } from '@/integrations/supabase/external-client';
import { useSharedFetch, setSharedData } from '@/lib/sharedFetch';

export interface ActivityFieldSetting {
  id: string;
  field_key: string;
  label: string;
  display_order: number;
  include_in_message: boolean;
  placeholder: string | null;
}

const DEFAULT_FIELDS: ActivityFieldSetting[] = [
  { id: '2', field_key: 'current_status', label: 'Como está?', display_order: 1, include_in_message: true, placeholder: 'Situação atual do caso...' },
  { id: '1', field_key: 'what_was_done', label: 'O que foi feito?', display_order: 2, include_in_message: true, placeholder: 'Descreva o que foi realizado...' },
  { id: '3', field_key: 'next_steps', label: 'Próximo passo', display_order: 3, include_in_message: true, placeholder: 'Qual será o próximo passo...' },
  { id: '4', field_key: 'notes', label: 'Observações', display_order: 4, include_in_message: false, placeholder: 'Notas adicionais...' },
];

const CACHE_KEY = 'activity_field_settings';

export function useActivityFieldSettings() {
  const { data: fields, loading, refetch } = useSharedFetch<ActivityFieldSetting[]>(
    CACHE_KEY,
    async () => {
      const { data, error } = await supabase
        .from('activity_field_settings')
        .select('*')
        .order('display_order');
      if (error) throw error;
      // Tabela vazia continua caindo nos campos padrão, como antes.
      return data && data.length > 0 ? (data as ActivityFieldSetting[]) : DEFAULT_FIELDS;
    },
    DEFAULT_FIELDS,
  );

  const updateField = async (id: string, updates: Partial<ActivityFieldSetting>) => {
    const { error } = await supabase
      .from('activity_field_settings')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (!error) {
      setSharedData(CACHE_KEY, fields.map(f => f.id === id ? { ...f, ...updates } : f));
    }
    return { error };
  };

  const reorderFields = async (reordered: ActivityFieldSetting[]) => {
    setSharedData(CACHE_KEY, reordered);
    for (let i = 0; i < reordered.length; i++) {
      await supabase
        .from('activity_field_settings')
        .update({ display_order: i + 1, updated_at: new Date().toISOString() })
        .eq('id', reordered[i].id);
    }
  };

  const sortedFields = [...fields].sort((a, b) => a.display_order - b.display_order);

  return { fields: sortedFields, loading, updateField, reorderFields, refetch };
}
