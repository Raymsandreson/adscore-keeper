import { useState, useEffect, useMemo, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  useProcessCustomFields,
  ProcessCustomField,
  ProcessCustomFieldValue,
  FieldType,
} from '@/hooks/useProcessCustomFields';

// Render + edição dos valores de campos personalizados de UM processo.
// Mostra campos globais (workflow_id null) + os do workflow do processo, agrupados por aba.
// Componente próprio (não reusa o do lead) — zero acoplamento.

interface ProcessCustomFieldsFormProps {
  processId: string;
  workflowId?: string | null;
}

type LocalValue = string | number | boolean | null;

function normalizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

export function ProcessCustomFieldsForm({ processId, workflowId }: ProcessCustomFieldsFormProps) {
  const { customFields, loading, getFieldValues, saveAllFieldValues } = useProcessCustomFields();
  const [values, setValues] = useState<Record<string, ProcessCustomFieldValue>>({});
  const [local, setLocal] = useState<Record<string, LocalValue>>({});
  const [saving, setSaving] = useState(false);
  const [loadingValues, setLoadingValues] = useState(true);

  // Aplicáveis: globais OU do workflow do processo.
  const applicable = useMemo(
    () => customFields.filter(f => !f.workflow_id || f.workflow_id === workflowId),
    [customFields, workflowId],
  );

  const loadValues = useCallback(async () => {
    if (!processId) return;
    setLoadingValues(true);
    const map = await getFieldValues(processId);
    setValues(map);
    setLocal({});
    setLoadingValues(false);
  }, [processId, getFieldValues]);

  useEffect(() => { loadValues(); }, [loadValues]);

  const getCurrent = (field: ProcessCustomField): LocalValue => {
    if (field.id in local) return local[field.id];
    const v = values[field.id];
    if (!v) return null;
    switch (field.field_type) {
      case 'number': return v.value_number;
      case 'date': return v.value_date;
      case 'checkbox': return v.value_boolean;
      default: return v.value_text;
    }
  };

  const setValue = (fieldId: string, value: LocalValue) =>
    setLocal(prev => ({ ...prev, [fieldId]: value }));

  const dirty = Object.keys(local).length > 0;

  const handleSave = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      const payload: Record<string, { type: FieldType; value: LocalValue }> = {};
      for (const f of applicable) {
        if (f.id in local) payload[f.id] = { type: f.field_type, value: local[f.id] };
      }
      await saveAllFieldValues(processId, payload);
      toast.success('Campos do processo salvos!');
      await loadValues();
    } catch {
      toast.error('Erro ao salvar campos do processo');
    } finally {
      setSaving(false);
    }
  };

  // Agrupa por aba
  const byTab = useMemo(() => {
    const groups: Record<string, ProcessCustomField[]> = {};
    for (const f of applicable) {
      const tab = f.tab && f.tab !== 'basic' ? f.tab : 'Geral';
      (groups[tab] ||= []).push(f);
    }
    return groups;
  }, [applicable]);

  if (loading || loadingValues) {
    return <div className="text-sm text-muted-foreground py-4 text-center">Carregando campos...</div>;
  }

  if (applicable.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-6 text-center">
        Nenhum campo personalizado configurado para este fluxo.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {Object.entries(byTab).map(([tab, fields]) => (
        <div key={tab} className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tab}</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map(field => {
              const current = getCurrent(field);
              return (
                <div key={field.id} className="space-y-1.5">
                  <Label className="text-sm">
                    {field.field_name}
                    {field.is_required && <span className="text-destructive ml-1">*</span>}
                  </Label>

                  {field.field_type === 'text' && (
                    <Input value={(current as string) || ''} onChange={e => setValue(field.id, e.target.value)} />
                  )}

                  {field.field_type === 'number' && (
                    <Input
                      type="number"
                      value={current !== null && current !== undefined ? String(current) : ''}
                      onChange={e => setValue(field.id, e.target.value ? parseFloat(e.target.value) : null)}
                    />
                  )}

                  {field.field_type === 'date' && (
                    <Input
                      type="date"
                      value={(current as string) || ''}
                      onChange={e => setValue(field.id, e.target.value || null)}
                    />
                  )}

                  {field.field_type === 'select' && (
                    <Select value={(current as string) || ''} onValueChange={v => setValue(field.id, v)}>
                      <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                      <SelectContent>
                        {field.field_options?.map(opt => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {field.field_type === 'checkbox' && (
                    <div className="flex items-center gap-2 pt-1">
                      <Checkbox
                        checked={!!current}
                        onCheckedChange={c => setValue(field.id, !!c)}
                        id={`pcf-${field.id}`}
                      />
                      <Label htmlFor={`pcf-${field.id}`} className="text-sm text-muted-foreground">Sim</Label>
                    </div>
                  )}

                  {(field.field_type === 'url' || field.field_type === 'password') && (
                    <div className="flex items-center gap-1">
                      <Input
                        type={field.field_type === 'password' ? 'password' : 'text'}
                        value={(current as string) || ''}
                        onChange={e => setValue(field.id, e.target.value)}
                        className={field.field_type === 'password' ? 'font-mono' : undefined}
                      />
                      {field.field_type === 'url' && current && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => {
                            const u = normalizeUrl(current as string);
                            if (u) window.open(u, '_blank', 'noopener');
                          }}
                          title="Abrir link"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex justify-end pt-1">
        <Button onClick={handleSave} disabled={!dirty || saving} size="sm">
          {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
          Salvar campos
        </Button>
      </div>
    </div>
  );
}
