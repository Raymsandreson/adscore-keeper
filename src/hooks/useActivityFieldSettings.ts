import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ActivityFieldSetting {
  id: string;
  field_key: string;
  label: string;
  display_order: number;
  include_in_message: boolean;
  placeholder: string | null;
}

const DEFAULT_FIELDS: ActivityFieldSetting[] = [
  { id: '1', field_key: 'what_was_done', label: 'O que foi feito?', display_order: 1, include_in_message: true, placeholder: 'Descreva o que foi realizado...' },
  { id: '2', field_key: 'current_status', label: 'Como está?', display_order: 2, include_in_message: true, placeholder: 'Situação atual do caso...' },
  { id: '3', field_key: 'next_steps', label: 'Próximo passo', display_order: 3, include_in_message: true, placeholder: 'Qual será o próximo passo...' },
  { id: '4', field_key: 'notes', label: 'Observações', display_order: 4, include_in_message: false, placeholder: 'Notas adicionais...' },
];

export function useActivityFieldSettings() {
  const [fields, setFields] = useState<ActivityFieldSetting[]>(DEFAULT_FIELDS);
  const [loading, setLoading] = useState(true);

  const fetchFields = useCallback(async () => {
    const { data, error } = await supabase
      .from('activity_field_settings')
      .select('*')
      .order('display_order');
    
    if (!error && data && data.length > 0) {
      setFields(data as ActivityFieldSetting[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchFields(); }, [fetchFields]);

  const updateField = async (id: string, updates: Partial<ActivityFieldSetting>) => {
    const { error } = await supabase
      .from('activity_field_settings')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id);
    
    if (!error) {
      setFields(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
    }
    return { error };
  };

  const reorderFields = async (reordered: ActivityFieldSetting[]) => {
    setFields(reordered);
    for (let i = 0; i < reordered.length; i++) {
      await supabase
        .from('activity_field_settings')
        .update({ display_order: i + 1, updated_at: new Date().toISOString() })
        .eq('id', reordered[i].id);
    }
  };

  const sortedFields = [...fields].sort((a, b) => a.display_order - b.display_order);

  return { fields: sortedFields, loading, updateField, reorderFields, refetch: fetchFields };
}
