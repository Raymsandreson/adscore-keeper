import { useState, useEffect, useCallback } from 'react';
import { db } from '@/integrations/supabase';
import { toast } from 'sonner';
import type { FieldType } from './useLeadCustomFields';

export type ContactFieldType = FieldType;

export interface ContactCustomField {
  id: string;
  field_name: string;
  field_type: ContactFieldType;
  field_options: string[];
  is_required: boolean;
  display_order: number;
  tab: string;
  created_at: string;
  updated_at: string;
}

export interface ContactCustomFieldValue {
  id: string;
  contact_id: string;
  field_id: string;
  value_text: string | null;
  value_number: number | null;
  value_date: string | null;
  value_boolean: boolean | null;
}

export function useContactCustomFields() {
  const [customFields, setCustomFields] = useState<ContactCustomField[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCustomFields = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (db as any)
        .from('contact_custom_fields')
        .select('*')
        .order('display_order', { ascending: true });
      if (error) throw error;
      setCustomFields((data || []) as ContactCustomField[]);
    } catch (e) {
      console.error('useContactCustomFields fetch', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const addCustomField = async (field: Partial<ContactCustomField>) => {
    const { data, error } = await (db as any)
      .from('contact_custom_fields')
      .insert({
        field_name: field.field_name,
        field_type: field.field_type || 'text',
        field_options: field.field_options || [],
        is_required: field.is_required || false,
        display_order: field.display_order ?? customFields.length,
        tab: field.tab || 'info',
      })
      .select()
      .single();
    if (error) { toast.error('Erro ao criar campo'); throw error; }
    await fetchCustomFields();
    toast.success('Campo criado!');
    return data;
  };

  const updateCustomField = async (id: string, updates: Partial<ContactCustomField>, options?: { silent?: boolean; refetch?: boolean }) => {
    const { error } = await (db as any).from('contact_custom_fields').update(updates).eq('id', id);
    if (error) { toast.error('Erro ao atualizar campo'); throw error; }
    if (options?.refetch !== false) await fetchCustomFields();
    if (!options?.silent) toast.success('Campo atualizado!');
  };

  const deleteCustomField = async (id: string) => {
    const { error } = await (db as any).from('contact_custom_fields').delete().eq('id', id);
    if (error) { toast.error('Erro ao remover campo'); throw error; }
    await fetchCustomFields();
    toast.success('Campo removido!');
  };

  const getFieldValues = async (contactId: string): Promise<Record<string, ContactCustomFieldValue>> => {
    const { data, error } = await (db as any)
      .from('contact_custom_field_values')
      .select('*')
      .eq('contact_id', contactId);
    if (error) { console.error(error); return {}; }
    const map: Record<string, ContactCustomFieldValue> = {};
    (data || []).forEach((v: ContactCustomFieldValue) => { map[v.field_id] = v; });
    return map;
  };

  const saveFieldValue = async (
    contactId: string,
    fieldId: string,
    fieldType: ContactFieldType,
    value: string | number | boolean | null
  ) => {
    const payload: any = { contact_id: contactId, field_id: fieldId, value_text: null, value_number: null, value_date: null, value_boolean: null };
    switch (fieldType) {
      case 'text': case 'select': case 'url': case 'password': payload.value_text = value as string; break;
      case 'number': payload.value_number = value as number; break;
      case 'date': payload.value_date = value as string; break;
      case 'checkbox': payload.value_boolean = value as boolean; break;
    }
    const { data: existing } = await (db as any)
      .from('contact_custom_field_values')
      .select('id')
      .eq('contact_id', contactId)
      .eq('field_id', fieldId)
      .maybeSingle();
    if (existing) {
      const { error } = await (db as any).from('contact_custom_field_values').update(payload).eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await (db as any).from('contact_custom_field_values').insert(payload);
      if (error) throw error;
    }
  };

  const saveAllFieldValues = async (
    contactId: string,
    values: Record<string, { type: ContactFieldType; value: string | number | boolean | null }>
  ) => {
    await Promise.all(
      Object.entries(values).map(([fieldId, { type, value }]) =>
        saveFieldValue(contactId, fieldId, type, value)
      )
    );
  };

  useEffect(() => { fetchCustomFields(); }, [fetchCustomFields]);

  return {
    customFields, loading, fetchCustomFields,
    addCustomField, updateCustomField, deleteCustomField,
    getFieldValues, saveFieldValue, saveAllFieldValues,
  };
}
