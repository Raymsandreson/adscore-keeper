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

  const getFieldDescription = () => {
    switch (field.field_type) {
      case 'text':
        return 'Campo de texto livre para informações gerais';
      case 'number':
        return 'Valor numérico (ex: valores, quantidades)';
      case 'date':
        return 'Selecione uma data específica';
      case 'select':
        return `Escolha entre: ${field.field_options?.join(', ') || 'opções definidas'}`;
      case 'checkbox':
        return 'Marque para confirmar (Sim/Não)';
      default:
        return '';
    }
  };

  return (
    <div className="p-4 rounded-lg border bg-card hover:bg-accent/30 transition-colors space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">
          {field.field_name}
          {field.is_required && <span className="text-destructive ml-1">*</span>}
        </Label>
        <span className="text-xs text-muted-foreground px-2 py-0.5 rounded-full bg-muted capitalize">
          {field.field_type === 'text' ? 'Texto' : 
           field.field_type === 'number' ? 'Número' :
           field.field_type === 'date' ? 'Data' :
           field.field_type === 'select' ? 'Seleção' :
           field.field_type === 'checkbox' ? 'Checkbox' : field.field_type}
        </span>
      </div>
      
      <p className="text-xs text-muted-foreground">{getFieldDescription()}</p>
      
      {field.field_type === 'text' && (
        <Input
          placeholder={`Digite ${field.field_name.toLowerCase()}`}
          value={(currentValue as string) || ''}
          onChange={(e) => handleChange(e.target.value)}
          className="mt-1"
        />
      )}

      {field.field_type === 'number' && (
        <Input
          type="number"
          placeholder="0"
          value={currentValue !== null ? String(currentValue) : ''}
          onChange={(e) => handleChange(e.target.value ? parseFloat(e.target.value) : null)}
          className="mt-1"
        />
      )}

      {field.field_type === 'date' && (
        <Input
          type="date"
          value={(currentValue as string) || ''}
          onChange={(e) => handleChange(e.target.value || null)}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="mt-1 pointer-events-auto relative z-50"
        />
      )}

      {field.field_type === 'select' && (
        <Select
          value={(currentValue as string) || ''}
          onValueChange={(v) => handleChange(v)}
        >
          <SelectTrigger className="mt-1">
            <SelectValue placeholder="Selecione uma opção..." />
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
        <div className="flex items-center gap-2 mt-2 p-2 rounded bg-muted/50">
          <Checkbox
            id={`field-${field.id}`}
            checked={(currentValue as boolean) || false}
            onCheckedChange={(checked) => handleChange(checked as boolean)}
          />
          <label
            htmlFor={`field-${field.id}`}
            className="text-sm cursor-pointer"
          >
            Sim, confirmo
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
      <div className="flex items-center gap-2 mb-2">
        <div className="h-1 w-1 rounded-full bg-primary" />
        <Label className="text-sm font-semibold">Campos Personalizados</Label>
        <span className="text-xs text-muted-foreground">({customFields.length} campo{customFields.length !== 1 ? 's' : ''})</span>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Preencha os campos abaixo conforme necessário. Campos com * são obrigatórios.
      </p>
      <div className="space-y-3">
        {customFields.map((field) => (
          <CustomFieldInput
            key={field.id}
            field={field}
            value={fieldValues[field.id] || null}
            onChange={handleChange}
          />
        ))}
      </div>
    </div>
  );
}
