import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { CustomFieldInput } from '@/components/leads/CustomFieldsForm';
import type { ContactCustomField, ContactCustomFieldValue, ContactFieldType } from '@/hooks/useContactCustomFields';
import type { CustomField } from '@/hooks/useLeadCustomFields';

interface Props {
  contactId: string;
  customFields: ContactCustomField[];
  getFieldValues: (contactId: string) => Promise<Record<string, ContactCustomFieldValue>>;
  onValuesChange: (values: Record<string, { type: ContactFieldType; value: string | number | boolean | null }>) => void;
}

// Adapter: ContactCustomField → CustomField (lead-shaped) for the shared input
function asLeadField(cf: ContactCustomField): CustomField {
  return {
    id: cf.id,
    ad_account_id: null,
    board_id: null,
    field_name: cf.field_name,
    field_type: cf.field_type,
    field_options: cf.field_options || [],
    is_required: cf.is_required,
    display_order: cf.display_order,
    tab: 'basic',
    created_at: cf.created_at,
    updated_at: cf.updated_at,
  };
}

export function ContactCustomFieldsInline({ contactId, customFields, getFieldValues, onValuesChange }: Props) {
  const [values, setValues] = useState<Record<string, ContactCustomFieldValue>>({});
  const [local, setLocal] = useState<Record<string, { type: ContactFieldType; value: string | number | boolean | null }>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!contactId || customFields.length === 0) { setLoaded(true); return; }
    let cancelled = false;
    (async () => {
      const v = await getFieldValues(contactId);
      if (cancelled) return;
      setValues(v);
      const init: Record<string, { type: ContactFieldType; value: string | number | boolean | null }> = {};
      customFields.forEach(f => {
        const val = v[f.id];
        if (!val) return;
        let raw: string | number | boolean | null = null;
        switch (f.field_type) {
          case 'text': case 'select': case 'url': case 'password': raw = val.value_text; break;
          case 'number': raw = val.value_number; break;
          case 'date': raw = val.value_date; break;
          case 'checkbox': raw = val.value_boolean; break;
        }
        init[f.id] = { type: f.field_type, value: raw };
      });
      setLocal(init);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [contactId, customFields, getFieldValues]);

  const handleChange = (fieldId: string, type: any, value: any) => {
    const next = { ...local, [fieldId]: { type, value } };
    setLocal(next);
    onValuesChange(next);
  };

  if (!loaded) return <div className="text-sm text-muted-foreground">Carregando campos...</div>;
  if (customFields.length === 0) {
    return <div className="text-sm text-muted-foreground italic">Nenhum campo personalizado nesta aba. Use o botão "Personalizar" no topo para criar.</div>;
  }

  return (
    <div className="space-y-3">
      {customFields.map(cf => (
        <CustomFieldInput
          key={cf.id}
          field={asLeadField(cf)}
          value={(values[cf.id] as any) || null}
          localValue={local[cf.id]?.value}
          onChange={handleChange}
        />
      ))}
    </div>
  );
}
