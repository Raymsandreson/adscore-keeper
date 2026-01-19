import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'checkbox';

export interface CustomField {
  id: string;
  ad_account_id: string | null;
  field_name: string;
  field_type: FieldType;
  field_options: string[];
  is_required: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface CustomFieldValue {
  id: string;
  lead_id: string;
  field_id: string;
  value_text: string | null;
  value_number: number | null;
  value_date: string | null;
  value_boolean: boolean | null;
  created_at: string;
  updated_at: string;
}

export function useLeadCustomFields(adAccountId?: string) {
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCustomFields = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('lead_custom_fields')
        .select('*')
        .order('display_order', { ascending: true });

      if (adAccountId) {
        query = query.eq('ad_account_id', adAccountId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setCustomFields((data || []) as CustomField[]);
    } catch (error) {
      console.error('Error fetching custom fields:', error);
    } finally {
      setLoading(false);
    }
  }, [adAccountId]);

  const addCustomField = async (field: Partial<CustomField>) => {
    try {
      const { data, error } = await supabase
        .from('lead_custom_fields')
        .insert({
          ad_account_id: field.ad_account_id || null,
          field_name: field.field_name,
          field_type: field.field_type || 'text',
          field_options: field.field_options || [],
          is_required: field.is_required || false,
          display_order: field.display_order || customFields.length,
        })
        .select()
        .single();

      if (error) throw error;
      
      await fetchCustomFields();
      toast.success('Campo personalizado criado!');
      return data;
    } catch (error) {
      console.error('Error adding custom field:', error);
      toast.error('Erro ao criar campo personalizado');
      throw error;
    }
  };

  const updateCustomField = async (id: string, updates: Partial<CustomField>) => {
    try {
      const { error } = await supabase
        .from('lead_custom_fields')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
      
      await fetchCustomFields();
      toast.success('Campo atualizado!');
    } catch (error) {
      console.error('Error updating custom field:', error);
      toast.error('Erro ao atualizar campo');
      throw error;
    }
  };

  const deleteCustomField = async (id: string) => {
    try {
      const { error } = await supabase
        .from('lead_custom_fields')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      await fetchCustomFields();
      toast.success('Campo removido!');
    } catch (error) {
      console.error('Error deleting custom field:', error);
      toast.error('Erro ao remover campo');
      throw error;
    }
  };

  // Get field values for a specific lead
  const getFieldValues = async (leadId: string): Promise<Record<string, CustomFieldValue>> => {
    try {
      const { data, error } = await supabase
        .from('lead_custom_field_values')
        .select('*')
        .eq('lead_id', leadId);

      if (error) throw error;

      const valuesMap: Record<string, CustomFieldValue> = {};
      (data || []).forEach((value: CustomFieldValue) => {
        valuesMap[value.field_id] = value;
      });

      return valuesMap;
    } catch (error) {
      console.error('Error fetching field values:', error);
      return {};
    }
  };

  // Save field value for a lead
  const saveFieldValue = async (
    leadId: string,
    fieldId: string,
    fieldType: FieldType,
    value: string | number | boolean | null
  ) => {
    try {
      const valueData: Partial<CustomFieldValue> = {
        lead_id: leadId,
        field_id: fieldId,
        value_text: null,
        value_number: null,
        value_date: null,
        value_boolean: null,
      };

      switch (fieldType) {
        case 'text':
        case 'select':
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

      // Check if value exists
      const { data: existing } = await supabase
        .from('lead_custom_field_values')
        .select('id')
        .eq('lead_id', leadId)
        .eq('field_id', fieldId)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('lead_custom_field_values')
          .update({
            value_text: valueData.value_text,
            value_number: valueData.value_number,
            value_date: valueData.value_date,
            value_boolean: valueData.value_boolean,
          })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('lead_custom_field_values')
          .insert({
            lead_id: leadId,
            field_id: fieldId,
            value_text: valueData.value_text,
            value_number: valueData.value_number,
            value_date: valueData.value_date,
            value_boolean: valueData.value_boolean,
          });
        if (error) throw error;
      }
    } catch (error) {
      console.error('Error saving field value:', error);
      throw error;
    }
  };

  // Save multiple field values at once
  const saveAllFieldValues = async (
    leadId: string,
    values: Record<string, { type: FieldType; value: string | number | boolean | null }>
  ) => {
    try {
      const promises = Object.entries(values).map(([fieldId, { type, value }]) =>
        saveFieldValue(leadId, fieldId, type, value)
      );
      await Promise.all(promises);
    } catch (error) {
      console.error('Error saving field values:', error);
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
