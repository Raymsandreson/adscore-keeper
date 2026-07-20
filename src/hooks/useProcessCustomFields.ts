import { useState, useEffect, useCallback } from 'react';
import { db } from '@/integrations/supabase';
import { toast } from 'sonner';

// Espelha useLeadCustomFields, mas para PROCESSOS (lead_processes).
// Diferenças de escopo: campos são vinculados a um workflow (kanban_board
// board_type='workflow') via workflow_id, em vez de board_id do lead.
// Tabelas: process_custom_fields / process_custom_field_values (Externo).

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'url' | 'password';

export interface ProcessCustomField {
  id: string;
  ad_account_id: string | null;
  workflow_id: string | null;
  field_name: string;
  field_type: FieldType;
  field_options: string[];
  is_required: boolean;
  display_order: number;
  tab: string;
  created_at: string;
  updated_at: string;
}

export interface ProcessCustomFieldValue {
  id: string;
  process_id: string;
  field_id: string;
  value_text: string | null;
  value_number: number | null;
  value_date: string | null;
  value_boolean: boolean | null;
  created_at: string;
  updated_at: string;
}

export function useProcessCustomFields(workflowId?: string | null) {
  const [customFields, setCustomFields] = useState<ProcessCustomField[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCustomFields = useCallback(async () => {
    setLoading(true);
    try {
      let query = (db as any)
        .from('process_custom_fields')
        .select('*')
        .order('display_order', { ascending: true });

      if (workflowId) {
        query = query.eq('workflow_id', workflowId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setCustomFields((data || []) as ProcessCustomField[]);
    } catch (error) {
      console.error('Error fetching process custom fields:', error);
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  const addCustomField = async (field: Partial<ProcessCustomField>) => {
    try {
      const { data, error } = await (db as any)
        .from('process_custom_fields')
        .insert({
          ad_account_id: field.ad_account_id || null,
          workflow_id: field.workflow_id || null,
          field_name: field.field_name,
          field_type: field.field_type || 'text',
          field_options: field.field_options || [],
          is_required: field.is_required || false,
          display_order: field.display_order || customFields.length,
          tab: field.tab || 'basic',
        })
        .select()
        .single();

      if (error) throw error;

      await fetchCustomFields();
      toast.success('Campo personalizado criado!');
      return data;
    } catch (error) {
      console.error('Error adding process custom field:', error);
      toast.error('Erro ao criar campo personalizado');
      throw error;
    }
  };

  const updateCustomField = async (
    id: string,
    updates: Partial<ProcessCustomField>,
    options?: { silent?: boolean; refetch?: boolean },
  ) => {
    try {
      const { error } = await (db as any)
        .from('process_custom_fields')
        .update(updates)
        .eq('id', id);

      if (error) throw error;

      if (options?.refetch !== false) await fetchCustomFields();
      if (!options?.silent) toast.success('Campo atualizado!');
    } catch (error) {
      console.error('Error updating process custom field:', error);
      toast.error('Erro ao atualizar campo');
      throw error;
    }
  };

  const deleteCustomField = async (id: string) => {
    try {
      const { error } = await (db as any)
        .from('process_custom_fields')
        .delete()
        .eq('id', id);

      if (error) throw error;

      await fetchCustomFields();
      toast.success('Campo removido!');
    } catch (error) {
      console.error('Error deleting process custom field:', error);
      toast.error('Erro ao remover campo');
      throw error;
    }
  };

  // Valores de um processo específico (mapa por field_id).
  // useCallback é obrigatório: ProcessCustomFieldsForm usa esta função como
  // dependência do useCallback/useEffect que carrega os valores. Sem
  // identidade estável, o efeito re-dispara a cada render e vira loop
  // infinito de fetch (medido: ~26k requisições em 1,5s).
  const getFieldValues = useCallback(async (processId: string): Promise<Record<string, ProcessCustomFieldValue>> => {
    try {
      const { data, error } = await (db as any)
        .from('process_custom_field_values')
        .select('*')
        .eq('process_id', processId);

      if (error) throw error;

      const valuesMap: Record<string, ProcessCustomFieldValue> = {};
      (data || []).forEach((value: ProcessCustomFieldValue) => {
        valuesMap[value.field_id] = value;
      });

      return valuesMap;
    } catch (error) {
      console.error('Error fetching process field values:', error);
      return {};
    }
  }, []);

  const saveFieldValue = async (
    processId: string,
    fieldId: string,
    fieldType: FieldType,
    value: string | number | boolean | null,
  ) => {
    try {
      const valueData: Partial<ProcessCustomFieldValue> = {
        process_id: processId,
        field_id: fieldId,
        value_text: null,
        value_number: null,
        value_date: null,
        value_boolean: null,
      };

      switch (fieldType) {
        case 'text':
        case 'select':
        case 'url':
        case 'password':
          valueData.value_text = value as string;
          break;
        case 'number':
          valueData.value_number = value as number;
          break;
        case 'date':
          valueData.value_date = value as string;
          break;
        case 'checkbox':
          valueData.value_boolean = value as boolean;
          break;
      }

      const { data: existing } = await (db as any)
        .from('process_custom_field_values')
        .select('id')
        .eq('process_id', processId)
        .eq('field_id', fieldId)
        .maybeSingle();

      if (existing) {
        const { error } = await (db as any)
          .from('process_custom_field_values')
          .update({
            value_text: valueData.value_text,
            value_number: valueData.value_number,
            value_date: valueData.value_date,
            value_boolean: valueData.value_boolean,
          })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await (db as any)
          .from('process_custom_field_values')
          .insert({
            process_id: processId,
            field_id: fieldId,
            value_text: valueData.value_text,
            value_number: valueData.value_number,
            value_date: valueData.value_date,
            value_boolean: valueData.value_boolean,
          });
        if (error) throw error;
      }
    } catch (error) {
      console.error('Error saving process field value:', error);
      throw error;
    }
  };

  const saveAllFieldValues = async (
    processId: string,
    values: Record<string, { type: FieldType; value: string | number | boolean | null }>,
  ) => {
    try {
      const promises = Object.entries(values).map(([fieldId, { type, value }]) =>
        saveFieldValue(processId, fieldId, type, value),
      );
      await Promise.all(promises);
    } catch (error) {
      console.error('Error saving process field values:', error);
      throw error;
    }
  };

  useEffect(() => {
    fetchCustomFields();
  }, [fetchCustomFields]);

  return {
    customFields,
    loading,
    fetchCustomFields,
    addCustomField,
    updateCustomField,
    deleteCustomField,
    getFieldValues,
    saveFieldValue,
    saveAllFieldValues,
  };
}
