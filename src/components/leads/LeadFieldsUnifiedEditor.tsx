import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { GripVertical, EyeOff, Eye, Pencil, Trash2, Plus, Lock } from 'lucide-react';
import { LEAD_FIELD_REGISTRY, TAB_DEFS, type LeadFieldTab } from './leadFormFields';
import { useLeadFieldLayout, type ResolvedField } from '@/hooks/useLeadFieldLayout';
import { useLeadCustomFields, type CustomField, type FieldType } from '@/hooks/useLeadCustomFields';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  boardId: string;
  boardName?: string;
  adAccountId?: string;
  /** When true, renders inline (no Dialog wrapper). */
  inline?: boolean;
}

type UnifiedItem = {
  key: string;            // 'fixed:lead_name' | 'custom:<uuid>'
  kind: 'fixed' | 'custom';
  refKey: string;         // field_key for fixed; field_id for custom
  label: string;
  tab: LeadFieldTab;
  display_order: number;
  hidden: boolean;
  custom?: CustomField;
};

const fieldTypeLabels: Record<FieldType, string> = {
  text: 'Texto', number: 'Número', date: 'Data', select: 'Seleção', checkbox: 'Sim/Não',
};

export function LeadFieldsUnifiedEditor({ open, onOpenChange, boardId, boardName, adAccountId, inline }: Props) {
  const { resolved, saveLayout, refetch: refetchLayout } = useLeadFieldLayout(boardId);
  const { customFields, addCustomField, updateCustomField, deleteCustomField, fetchCustomFields } =
    useLeadCustomFields(adAccountId);

  const [items, setItems] = useState<UnifiedItem[]>([]);
  const [dragKey, setDragKey] = useState<string | null>(null);

  // Custom field edit dialog
  const [cfDialogOpen, setCfDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CustomField | null>(null);
  const [cfName, setCfName] = useState('');
  const [cfType, setCfType] = useState<FieldType>('text');
  const [cfOptions, setCfOptions] = useState('');
  const [cfRequired, setCfRequired] = useState(false);
  const [cfTab, setCfTab] = useState<LeadFieldTab>('basic');

  // relevant custom fields for this board
  const relevantCustom = useMemo(
    () => customFields.filter(f => !f.board_id || f.board_id === boardId),
    [customFields, boardId]
  );

  useEffect(() => {
    if (!open && !inline) return;
    const labelOf = (k: string) => LEAD_FIELD_REGISTRY.find(d => d.key === k)?.label || k;
    const fixed: UnifiedItem[] = resolved.map(r => ({
      key: 'fixed:' + r.field_key,
      kind: 'fixed',
      refKey: r.field_key,
      label: labelOf(r.field_key),
      tab: r.tab,
      display_order: r.display_order,
      hidden: r.hidden,
    }));
    const custom: UnifiedItem[] = relevantCustom.map((cf, idx) => ({
      key: 'custom:' + cf.id,
      kind: 'custom',
      refKey: cf.id,
      label: cf.field_name,
      tab: ((cf as any).tab as LeadFieldTab) || 'basic',
      display_order: 1000 + (cf.display_order ?? idx),
      hidden: false,
      custom: cf,
    }));
    setItems([...fixed, ...custom]);
  }, [open, resolved, relevantCustom]);

  const fieldsOf = (tab: LeadFieldTab) =>
    items.filter(i => i.tab === tab).sort((a, b) => a.display_order - b.display_order);

  const reindex = (arr: UnifiedItem[]) => arr.map((f, i) => ({ ...f, display_order: i + 1 }));

  const handleDrop = (targetTab: LeadFieldTab, targetKey: string | null) => {
    if (!dragKey) return;
    setItems(prev => {
      const moving = prev.find(f => f.key === dragKey);
      if (!moving) return prev;
      const others = prev.filter(f => f.key !== dragKey);
      const tabFields = others.filter(f => f.tab === targetTab).sort((a, b) => a.display_order - b.display_order);
      const targetIdx = targetKey ? tabFields.findIndex(f => f.key === targetKey) : tabFields.length;
      const insertAt = targetIdx < 0 ? tabFields.length : targetIdx;
      tabFields.splice(insertAt, 0, { ...moving, tab: targetTab });
      const reIndexed = reindex(tabFields);
      const otherTabs = others.filter(f => f.tab !== targetTab);
      return [...otherTabs, ...reIndexed];
    });
    setDragKey(null);
  };

  const toggleHidden = (key: string) => {
    setItems(prev => prev.map(f => f.key === key ? { ...f, hidden: !f.hidden } : f));
  };

  const openNewCustom = (tab: LeadFieldTab = 'basic') => {
    setEditing(null);
    setCfName(''); setCfType('text'); setCfOptions(''); setCfRequired(false); setCfTab(tab);
    setCfDialogOpen(true);
  };

  const openEditCustom = (cf: CustomField, tab: LeadFieldTab) => {
    setEditing(cf);
    setCfName(cf.field_name);
    setCfType(cf.field_type);
    setCfOptions(cf.field_options?.join(', ') || '');
    setCfRequired(cf.is_required);
    setCfTab(tab);
    setCfDialogOpen(true);
  };

  const handleCustomSave = async () => {
    if (!cfName.trim()) { toast.error('Informe o nome do campo'); return; }
    const options = cfType === 'select'
      ? cfOptions.split(',').map(o => o.trim()).filter(Boolean)
      : [];
    try {
      if (editing) {
        await updateCustomField(editing.id, {
          field_name: cfName, field_type: cfType, field_options: options,
          is_required: cfRequired, tab: cfTab as any,
        } as any);
      } else {
        await addCustomField({
          field_name: cfName, field_type: cfType, field_options: options,
          is_required: cfRequired, board_id: boardId,
          ad_account_id: adAccountId, tab: cfTab as any,
        } as any);
      }
      setCfDialogOpen(false);
      await fetchCustomFields();
    } catch {/* toast handled */}
  };

  const handleCustomDelete = async (cf: CustomField) => {
    if (!confirm(`Excluir o campo "${cf.field_name}"? Os valores preenchidos serão perdidos.`)) return;
    await deleteCustomField(cf.id);
    await fetchCustomFields();
  };

  const handleSaveAll = async () => {
    // 1) save fixed layout
    const fixedPayload: ResolvedField[] = items
      .filter(i => i.kind === 'fixed')
      .map(i => ({ field_key: i.refKey, tab: i.tab, display_order: i.display_order, hidden: i.hidden }));
    await saveLayout(fixedPayload);

    // 2) save custom field tabs/order
    const customItems = items.filter(i => i.kind === 'custom');
    for (const it of customItems) {
      const cf = it.custom!;
      const needs = (((cf as any).tab as LeadFieldTab) || 'basic') !== it.tab
        || (cf.display_order ?? 0) !== it.display_order;
      if (needs) {
        await updateCustomField(cf.id, { tab: it.tab as any, display_order: it.display_order } as any);
      }
    }
    await refetchLayout();
    await fetchCustomFields();
    onOpenChange(false);
  };

  const body = (
    <>
      <p className="text-xs text-muted-foreground">
        Arraste qualquer campo (fixo ou personalizado) entre as abas. Use o olho para ocultar campos fixos neste funil — o valor existente no banco é preservado.
        Personalizados podem ser editados, excluídos ou criados em qualquer aba.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 mt-3">
        {TAB_DEFS.map(tab => {
          const list = fieldsOf(tab.key);
          return (
            <div
              key={tab.key}
              className="border rounded-lg bg-muted/30 p-2 min-h-[260px] flex flex-col"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(tab.key, null)}
            >
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-2 px-1 flex items-center justify-between">
                <span>{tab.label} <span className="text-muted-foreground/60">({list.filter(i => !i.hidden).length})</span></span>
              </div>
              <div className="space-y-1 flex-1">
                {list.map(f => (
                  <div
                    key={f.key}
                    draggable
                    onDragStart={() => setDragKey(f.key)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.stopPropagation(); handleDrop(tab.key, f.key); }}
                    className={`flex items-center gap-1 p-1.5 rounded border bg-background text-xs cursor-grab active:cursor-grabbing group ${f.hidden ? 'opacity-50' : ''}`}
                  >
                    <GripVertical className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate" title={f.label}>{f.label}</span>
                    {f.kind === 'fixed' ? (
                      <>
                        <Badge variant="outline" className="text-[9px] py-0 px-1 hidden group-hover:inline-flex" title="Campo fixo do sistema">
                          <Lock className="h-2.5 w-2.5" />
                        </Badge>
                        <button type="button" onClick={() => toggleHidden(f.key)}
                          className="text-muted-foreground hover:text-foreground p-0.5"
                          title={f.hidden ? 'Mostrar' : 'Ocultar'}>
                          {f.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        </button>
                      </>
                    ) : (
                      <>
                        {f.custom?.is_required && (
                          <Badge variant="destructive" className="text-[9px] py-0 px-1">obr</Badge>
                        )}
                        <button type="button" onClick={() => openEditCustom(f.custom!, tab.key)}
                          className="text-muted-foreground hover:text-foreground p-0.5" title="Editar">
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button type="button" onClick={() => handleCustomDelete(f.custom!)}
                          className="text-muted-foreground hover:text-destructive p-0.5" title="Excluir">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
                {list.length === 0 && (
                  <div className="text-[10px] text-muted-foreground/60 italic text-center py-4 border-2 border-dashed rounded">
                    Solte campos aqui
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => openNewCustom(tab.key)}
                className="mt-2 w-full flex items-center justify-center gap-1 text-[11px] text-muted-foreground hover:text-foreground border border-dashed rounded py-1"
              >
                <Plus className="h-3 w-3" /> Adicionar campo
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <Button variant="outline" onClick={() => onOpenChange(false)}>{inline ? 'Concluir' : 'Cancelar'}</Button>
        <Button onClick={handleSaveAll}>Salvar</Button>
      </div>
    </>
  );

  return (
    <>
      {inline ? (
        <div>{body}</div>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Campos e grupos {boardName ? `— ${boardName}` : ''}</DialogTitle>
            </DialogHeader>
            {body}
          </DialogContent>
        </Dialog>
      )}

      {/* Custom field create/edit dialog */}
      <Dialog open={cfDialogOpen} onOpenChange={setCfDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar campo' : 'Novo campo personalizado'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome</Label>
              <Input value={cfName} onChange={(e) => setCfName(e.target.value)} placeholder="Ex: CPF, Data do parto..." autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tipo</Label>
                <Select value={cfType} onValueChange={(v) => setCfType(v as FieldType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(fieldTypeLabels).map(([k, l]) => (
                      <SelectItem key={k} value={k}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Aba</Label>
                <Select value={cfTab} onValueChange={(v) => setCfTab(v as LeadFieldTab)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TAB_DEFS.map(t => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {cfType === 'select' && (
              <div>
                <Label>Opções (separadas por vírgula)</Label>
                <Input value={cfOptions} onChange={(e) => setCfOptions(e.target.value)} placeholder="Opção 1, Opção 2" />
              </div>
            )}
            <div className="flex items-center justify-between border rounded p-2">
              <Label className="text-sm">Obrigatório</Label>
              <Switch checked={cfRequired} onCheckedChange={setCfRequired} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCfDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleCustomSave}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
