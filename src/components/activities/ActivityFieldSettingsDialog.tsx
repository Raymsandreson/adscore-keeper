import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Settings, GripVertical, ArrowUp, ArrowDown } from 'lucide-react';
import { ActivityFieldSetting } from '@/hooks/useActivityFieldSettings';
import { toast } from 'sonner';

interface Props {
  fields: ActivityFieldSetting[];
  onUpdateField: (id: string, updates: Partial<ActivityFieldSetting>) => Promise<{ error: any }>;
  onReorder: (fields: ActivityFieldSetting[]) => Promise<void>;
}

export function ActivityFieldSettingsDialog({ fields, onUpdateField, onReorder }: Props) {
  const [open, setOpen] = useState(false);
  const [localFields, setLocalFields] = useState<ActivityFieldSetting[]>([]);

  const handleOpen = (isOpen: boolean) => {
    if (isOpen) setLocalFields([...fields]);
    setOpen(isOpen);
  };

  const updateLabel = (id: string, label: string) => {
    setLocalFields(prev => prev.map(f => f.id === id ? { ...f, label } : f));
  };

  const toggleMessage = (id: string) => {
    setLocalFields(prev => prev.map(f => f.id === id ? { ...f, include_in_message: !f.include_in_message } : f));
  };

  const moveField = (index: number, direction: 'up' | 'down') => {
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= localFields.length) return;
    const updated = [...localFields];
    [updated[index], updated[target]] = [updated[target], updated[index]];
    updated.forEach((f, i) => f.display_order = i + 1);
    setLocalFields(updated);
  };

  const handleSave = async () => {
    try {
      for (const field of localFields) {
        const original = fields.find(f => f.id === field.id);
        if (!original) continue;
        if (original.label !== field.label || original.include_in_message !== field.include_in_message) {
          await onUpdateField(field.id, { label: field.label, include_in_message: field.include_in_message });
        }
      }
      const orderChanged = localFields.some((f, i) => f.id !== fields[i]?.id);
      if (orderChanged) {
        await onReorder(localFields);
      }
      toast.success('Configurações salvas!');
      setOpen(false);
    } catch {
      toast.error('Erro ao salvar');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Configurar campos">
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Configurar campos da atividade
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {localFields.map((field, index) => (
            <div key={field.id} className="flex items-center gap-2 p-3 border rounded-lg bg-muted/30">
              <div className="flex flex-col gap-0.5">
                <Button
                  variant="ghost" size="icon" className="h-5 w-5"
                  disabled={index === 0}
                  onClick={() => moveField(index, 'up')}
                >
                  <ArrowUp className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost" size="icon" className="h-5 w-5"
                  disabled={index === localFields.length - 1}
                  onClick={() => moveField(index, 'down')}
                >
                  <ArrowDown className="h-3 w-3" />
                </Button>
              </div>
              <div className="flex-1 space-y-2">
                <Input
                  value={field.label}
                  onChange={e => updateLabel(field.id, e.target.value)}
                  className="h-8 text-sm"
                  placeholder="Nome do campo"
                />
                <div className="flex items-center gap-2">
                  <Switch
                    checked={field.include_in_message}
                    onCheckedChange={() => toggleMessage(field.id)}
                    className="scale-75"
                  />
                  <span className="text-xs text-muted-foreground">
                    Incluir na mensagem WhatsApp
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <Button className="w-full" onClick={handleSave}>
          Salvar configurações
        </Button>
      </DialogContent>
    </Dialog>
  );
}
