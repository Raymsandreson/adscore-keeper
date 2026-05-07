import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { GripVertical, EyeOff, Eye } from 'lucide-react';
import { LEAD_FIELD_REGISTRY, TAB_DEFS, type LeadFieldTab } from '@/components/leads/leadFormFields';
import type { ResolvedField } from '@/hooks/useLeadFieldLayout';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  resolved: ResolvedField[];
  onSave: (next: ResolvedField[]) => Promise<void> | void;
  boardName?: string;
}

export function LeadFormLayoutEditor({ open, onOpenChange, resolved, onSave, boardName }: Props) {
  const [draft, setDraft] = useState<ResolvedField[]>([]);
  const [dragKey, setDragKey] = useState<string | null>(null);

  useEffect(() => {
    if (open) setDraft(resolved.map(f => ({ ...f })));
  }, [open, resolved]);

  const labelFor = (key: string) => LEAD_FIELD_REGISTRY.find(d => d.key === key)?.label || key;

  const fieldsOf = (tab: LeadFieldTab) =>
    draft.filter(f => f.tab === tab).sort((a, b) => a.display_order - b.display_order);

  const reindex = (arr: ResolvedField[]) =>
    arr.map((f, i) => ({ ...f, display_order: i + 1 }));

  const handleDrop = (targetTab: LeadFieldTab, targetKey: string | null) => {
    if (!dragKey) return;
    setDraft(prev => {
      const moving = prev.find(f => f.field_key === dragKey);
      if (!moving) return prev;
      const others = prev.filter(f => f.field_key !== dragKey);
      const tabFields = others.filter(f => f.tab === targetTab).sort((a, b) => a.display_order - b.display_order);
      const targetIdx = targetKey ? tabFields.findIndex(f => f.field_key === targetKey) : tabFields.length;
      const insertAt = targetIdx < 0 ? tabFields.length : targetIdx;
      tabFields.splice(insertAt, 0, { ...moving, tab: targetTab });
      const reIndexed = reindex(tabFields);
      const otherTabs = others.filter(f => f.tab !== targetTab);
      return [...otherTabs, ...reIndexed];
    });
    setDragKey(null);
  };

  const toggleHidden = (key: string) => {
    setDraft(prev => prev.map(f => f.field_key === key ? { ...f, hidden: !f.hidden } : f));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Personalizar layout do formulário {boardName ? `— ${boardName}` : ''}</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Arraste os campos entre as abas. Use o switch para ocultar um campo neste funil (o valor existente no banco é preservado).
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          {TAB_DEFS.map(tab => {
            const items = fieldsOf(tab.key);
            return (
              <div
                key={tab.key}
                className="border rounded-lg bg-muted/30 p-2 min-h-[200px] flex flex-col"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(tab.key, null)}
              >
                <div className="text-xs font-semibold uppercase text-muted-foreground mb-2 px-1">
                  {tab.label} <span className="text-muted-foreground/60">({items.filter(i=>!i.hidden).length})</span>
                </div>
                <div className="space-y-1 flex-1">
                  {items.map(f => (
                    <div
                      key={f.field_key}
                      draggable
                      onDragStart={() => setDragKey(f.field_key)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.stopPropagation(); handleDrop(tab.key, f.field_key); }}
                      className={`flex items-center gap-1 p-1.5 rounded border bg-background text-xs cursor-grab active:cursor-grabbing ${f.hidden ? 'opacity-50' : ''}`}
                      title={f.field_key}
                    >
                      <GripVertical className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="flex-1 truncate">{labelFor(f.field_key)}</span>
                      <button
                        type="button"
                        onClick={() => toggleHidden(f.field_key)}
                        className="text-muted-foreground hover:text-foreground p-0.5"
                        title={f.hidden ? 'Mostrar' : 'Ocultar'}
                      >
                        {f.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </button>
                    </div>
                  ))}
                  {items.length === 0 && (
                    <div className="text-[10px] text-muted-foreground/60 italic text-center py-4 border-2 border-dashed rounded">
                      Solte campos aqui
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={async () => { await onSave(draft); onOpenChange(false); }}>
            Salvar layout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
