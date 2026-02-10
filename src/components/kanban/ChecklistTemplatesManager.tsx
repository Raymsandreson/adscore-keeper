import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Plus,
  Trash2,
  Edit3,
  CheckSquare,
  GripVertical,
  X,
  ListChecks,
} from 'lucide-react';
import { useChecklists, ChecklistTemplate, ChecklistItem } from '@/hooks/useChecklists';

interface ChecklistTemplatesManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChecklistTemplatesManager({ open, onOpenChange }: ChecklistTemplatesManagerProps) {
  const {
    templates,
    fetchTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
  } = useChecklists();

  const [editingTemplate, setEditingTemplate] = useState<ChecklistTemplate | null>(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formMandatory, setFormMandatory] = useState(false);
  const [formItems, setFormItems] = useState<ChecklistItem[]>([]);
  const [newItemLabel, setNewItemLabel] = useState('');
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (open) fetchTemplates();
  }, [open, fetchTemplates]);

  const resetForm = () => {
    setFormName('');
    setFormDescription('');
    setFormMandatory(false);
    setFormItems([]);
    setNewItemLabel('');
    setEditingTemplate(null);
    setShowForm(false);
  };

  const handleEdit = (template: ChecklistTemplate) => {
    setEditingTemplate(template);
    setFormName(template.name);
    setFormDescription(template.description || '');
    setFormMandatory(template.is_mandatory);
    setFormItems([...template.items]);
    setShowForm(true);
  };

  const handleNew = () => {
    resetForm();
    setShowForm(true);
  };

  const handleAddItem = () => {
    if (!newItemLabel.trim()) return;
    setFormItems([...formItems, {
      id: crypto.randomUUID(),
      label: newItemLabel.trim(),
    }]);
    setNewItemLabel('');
  };

  const handleRemoveItem = (id: string) => {
    setFormItems(formItems.filter(i => i.id !== id));
  };

  const handleSave = async () => {
    if (!formName.trim() || formItems.length === 0) return;

    const data = {
      name: formName.trim(),
      description: formDescription.trim() || null,
      is_mandatory: formMandatory,
      items: formItems,
    };

    if (editingTemplate) {
      await updateTemplate(editingTemplate.id, data);
    } else {
      await createTemplate(data);
    }
    resetForm();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remover este checklist? Instâncias em leads serão mantidas.')) return;
    await deleteTemplate(id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5" />
            Gerenciar Checklists
          </DialogTitle>
        </DialogHeader>

        {showForm ? (
          <div className="space-y-4">
            <div>
              <Label>Nome do Checklist</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Ex: Documentação Inicial"
              />
            </div>

            <div>
              <Label>Descrição (opcional)</Label>
              <Input
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Breve descrição..."
              />
            </div>

            <div className="flex items-center gap-3">
              <Switch checked={formMandatory} onCheckedChange={setFormMandatory} />
              <Label>Obrigatório para avançar de etapa</Label>
            </div>

            <div>
              <Label>Itens</Label>
              <ScrollArea className="max-h-[200px] border rounded-md p-2 mt-1">
                {formItems.map((item, idx) => (
                  <div key={item.id} className="flex items-center gap-2 py-1 border-b border-border/50 last:border-0">
                    <GripVertical className="h-3 w-3 text-muted-foreground" />
                    <CheckSquare className="h-3 w-3 text-muted-foreground" />
                    <Input
                      value={item.label}
                      onChange={(e) => {
                        const updated = [...formItems];
                        updated[idx] = { ...item, label: e.target.value };
                        setFormItems(updated);
                      }}
                      className="flex-1 h-7 text-sm"
                    />
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleRemoveItem(item.id)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </ScrollArea>

              <div className="flex gap-2 mt-2">
                <Input
                  value={newItemLabel}
                  onChange={(e) => setNewItemLabel(e.target.value)}
                  placeholder="Novo item..."
                  className="flex-1"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddItem()}
                />
                <Button variant="outline" size="sm" onClick={handleAddItem}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={resetForm}>Cancelar</Button>
              <Button onClick={handleSave} disabled={!formName.trim() || formItems.length === 0}>
                {editingTemplate ? 'Salvar' : 'Criar'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <ScrollArea className="max-h-[400px]">
              {templates.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Nenhum checklist criado ainda
                </p>
              ) : (
                templates.map(t => (
                  <Card key={t.id} className="mb-2">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{t.name}</span>
                            {t.is_mandatory && (
                              <Badge variant="destructive" className="text-[10px] h-4">Obrigatório</Badge>
                            )}
                          </div>
                          {t.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            {t.items.length} {t.items.length === 1 ? 'item' : 'itens'}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(t)}>
                            <Edit3 className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(t.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </ScrollArea>

            <Button className="w-full" variant="outline" onClick={handleNew}>
              <Plus className="h-4 w-4 mr-2" />
              Novo Checklist
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
