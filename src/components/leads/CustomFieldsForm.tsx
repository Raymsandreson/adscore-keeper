import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { CustomField, CustomFieldValue, FieldType } from '@/hooks/useLeadCustomFields';

interface CustomFieldInputProps {
  field: CustomField;
  value: CustomFieldValue | null;
  onChange: (fieldId: string, type: FieldType, value: string | number | boolean | null) => void;
}

export function CustomFieldInput({ field, value, onChange }: CustomFieldInputProps) {
  const getValue = () => {
    if (!value) return null;
    switch (field.field_type) {
      case 'text':
      case 'select':
        return value.value_text;
      case 'number':
        return value.value_number;
      case 'date':
        return value.value_date;
      case 'checkbox':
        return value.value_boolean;
      default:
        return null;
    }
  };

  const currentValue = getValue();

  const handleChange = (newValue: string | number | boolean | null) => {
    onChange(field.id, field.field_type, newValue);
  };

  return (
    <div>
      <Label>
        {field.field_name}
        {field.is_required && <span className="text-destructive ml-1">*</span>}
      </Label>
      
      {field.field_type === 'text' && (
        <Input
          placeholder={`Digite ${field.field_name.toLowerCase()}`}
          value={(currentValue as string) || ''}
          onChange={(e) => handleChange(e.target.value)}
        />
      )}

      {field.field_type === 'number' && (
        <Input
          type="number"
          placeholder="0"
          value={currentValue !== null ? String(currentValue) : ''}
          onChange={(e) => handleChange(e.target.value ? parseFloat(e.target.value) : null)}
        />
      )}

      {field.field_type === 'date' && (
        <Input
          type="date"
          value={(currentValue as string) || ''}
          onChange={(e) => handleChange(e.target.value || null)}
        />
      )}

      {field.field_type === 'select' && (
        <Select
          value={(currentValue as string) || ''}
          onValueChange={(v) => handleChange(v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione..." />
          </SelectTrigger>
          <SelectContent>
            {field.field_options?.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {field.field_type === 'checkbox' && (
        <div className="flex items-center gap-2 mt-2">
          <Checkbox
            id={`field-${field.id}`}
            checked={(currentValue as boolean) || false}
            onCheckedChange={(checked) => handleChange(checked as boolean)}
          />
          <label
            htmlFor={`field-${field.id}`}
            className="text-sm text-muted-foreground cursor-pointer"
          >
            Sim
          </label>
        </div>
      )}
    </div>
  );
}

interface CustomFieldsFormProps {
  customFields: CustomField[];
  leadId: string;
  getFieldValues: (leadId: string) => Promise<Record<string, CustomFieldValue>>;
  onValuesChange: (values: Record<string, { type: FieldType; value: string | number | boolean | null }>) => void;
}

export function CustomFieldsForm({ customFields, leadId, getFieldValues, onValuesChange }: CustomFieldsFormProps) {
  const [fieldValues, setFieldValues] = useState<Record<string, CustomFieldValue>>({});
  const [localValues, setLocalValues] = useState<Record<string, { type: FieldType; value: string | number | boolean | null }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadValues = async () => {
      if (!leadId) {
        setLoading(false);
        return;
      }
      
      setLoading(true);
      const values = await getFieldValues(leadId);
      setFieldValues(values);
      
      // Initialize local values
      const initial: Record<string, { type: FieldType; value: string | number | boolean | null }> = {};
      customFields.forEach(field => {
        const val = values[field.id];
        if (val) {
          let value: string | number | boolean | null = null;
          switch (field.field_type) {
            case 'text':
            case 'select':
              value = val.value_text;
              break;
            case 'number':
              value = val.value_number;
              break;
            case 'date':
              value = val.value_date;
              break;
            case 'checkbox':
              value = val.value_boolean;
              break;
          }
          initial[field.id] = { type: field.field_type, value };
        }
      });
      setLocalValues(initial);
      
      setLoading(false);
    };

    loadValues();
  }, [leadId, getFieldValues, customFields]);

  const handleChange = (fieldId: string, type: FieldType, value: string | number | boolean | null) => {
    const updated = { ...localValues, [fieldId]: { type, value } };
    setLocalValues(updated);
    onValuesChange(updated);
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Carregando campos...</div>;
  }

  if (customFields.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4 border-t pt-4 mt-4">
      <Label className="text-sm font-medium text-muted-foreground">Campos Personalizados</Label>
      {customFields.map((field) => (
        <CustomFieldInput
          key={field.id}
          field={field}
          value={fieldValues[field.id] || null}
          onChange={handleChange}
        />
      ))}
    </div>
  );
}
