import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface FormLayoutTab {
  id: string;
  name: string;
  icon: string;
  display_order: number;
  is_system: boolean;
  system_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface FormLayoutField {
  id: string;
  tab_id: string;
  field_key: string | null;
  custom_field_id: string | null;
  label_override: string | null;
  display_order: number;
  is_hidden: boolean;
  col_span: number;
  created_at: string;
  updated_at: string;
}

export function useFormLayout() {
  const [tabs, setTabs] = useState<FormLayoutTab[]>([]);
  const [fields, setFields] = useState<FormLayoutField[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLayout = useCallback(async () => {
    setLoading(true);
    try {
      const [tabsRes, fieldsRes] = await Promise.all([
        supabase.from('form_layout_tabs').select('*').order('display_order'),
        supabase.from('form_layout_fields').select('*').order('display_order'),
      ]);

      if (tabsRes.error) throw tabsRes.error;
      if (fieldsRes.error) throw fieldsRes.error;

      setTabs((tabsRes.data || []) as FormLayoutTab[]);
      setFields((fieldsRes.data || []) as FormLayoutField[]);
    } catch (error) {
      console.error('Error fetching form layout:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLayout();
  }, [fetchLayout]);

  const addTab = async (name: string, icon: string = 'FileText') => {
    try {
      const maxOrder = tabs.length > 0 ? Math.max(...tabs.map(t => t.display_order)) + 1 : 0;
      const { error } = await supabase.from('form_layout_tabs').insert({
        name,
        icon,
        display_order: maxOrder,
        is_system: false,
      });
      if (error) throw error;
      await fetchLayout();
      toast.success('Grupo criado!');
    } catch (error) {
      console.error('Error adding tab:', error);
      toast.error('Erro ao criar grupo');
    }
  };

  const updateTab = async (id: string, updates: Partial<FormLayoutTab>) => {
    try {
      const { error } = await supabase.from('form_layout_tabs').update(updates).eq('id', id);
      if (error) throw error;
      await fetchLayout();
    } catch (error) {
      console.error('Error updating tab:', error);
      toast.error('Erro ao atualizar grupo');
    }
  };

  const deleteTab = async (id: string) => {
    try {
      const { error } = await supabase.from('form_layout_tabs').delete().eq('id', id);
      if (error) throw error;
      await fetchLayout();
      toast.success('Grupo removido!');
    } catch (error) {
      console.error('Error deleting tab:', error);
      toast.error('Erro ao remover grupo');
    }
  };

  const reorderTabs = async (orderedIds: string[]) => {
    try {
      const promises = orderedIds.map((id, index) =>
        supabase.from('form_layout_tabs').update({ display_order: index }).eq('id', id)
      );
      await Promise.all(promises);
      await fetchLayout();
    } catch (error) {
      console.error('Error reordering tabs:', error);
    }
  };

  const addField = async (tabId: string, fieldKey?: string, customFieldId?: string, colSpan: number = 1) => {
    try {
      const tabFields = fields.filter(f => f.tab_id === tabId);
      const maxOrder = tabFields.length > 0 ? Math.max(...tabFields.map(f => f.display_order)) + 1 : 0;
      const { error } = await supabase.from('form_layout_fields').insert({
        tab_id: tabId,
        field_key: fieldKey || null,
        custom_field_id: customFieldId || null,
        display_order: maxOrder,
        col_span: colSpan,
      });
      if (error) throw error;
      await fetchLayout();
      toast.success('Campo adicionado!');
    } catch (error) {
      console.error('Error adding field:', error);
      toast.error('Erro ao adicionar campo');
    }
  };

  const updateField = async (id: string, updates: Partial<FormLayoutField>) => {
    try {
      const { error } = await supabase.from('form_layout_fields').update(updates).eq('id', id);
      if (error) throw error;
      await fetchLayout();
    } catch (error) {
      console.error('Error updating field:', error);
    }
  };

  const deleteField = async (id: string) => {
    try {
      const { error } = await supabase.from('form_layout_fields').delete().eq('id', id);
      if (error) throw error;
      await fetchLayout();
      toast.success('Campo removido!');
    } catch (error) {
      console.error('Error deleting field:', error);
      toast.error('Erro ao remover campo');
    }
  };

  const moveField = async (fieldId: string, newTabId: string, newOrder: number) => {
    try {
      const { error } = await supabase.from('form_layout_fields').update({
        tab_id: newTabId,
        display_order: newOrder,
      }).eq('id', fieldId);
      if (error) throw error;
      await fetchLayout();
    } catch (error) {
      console.error('Error moving field:', error);
    }
  };

  const reorderFields = async (tabId: string, orderedIds: string[]) => {
    try {
      const promises = orderedIds.map((id, index) =>
        supabase.from('form_layout_fields').update({ display_order: index }).eq('id', id)
      );
      await Promise.all(promises);
      await fetchLayout();
    } catch (error) {
      console.error('Error reordering fields:', error);
    }
  };

  const getFieldsForTab = (tabId: string) => {
    return fields
      .filter(f => f.tab_id === tabId && !f.is_hidden)
      .sort((a, b) => a.display_order - b.display_order);
  };

  // Get all field keys that are already placed in any tab
  const getPlacedFieldKeys = () => {
    return fields.filter(f => f.field_key).map(f => f.field_key!);
  };

  return {
    tabs,
    fields,
    loading,
    fetchLayout,
    addTab,
    updateTab,
    deleteTab,
    reorderTabs,
    addField,
    updateField,
    deleteField,
    moveField,
    reorderFields,
    getFieldsForTab,
    getPlacedFieldKeys,
  };
}
