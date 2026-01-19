import { useState } from 'react';
import { Plus, Trash2, GripVertical, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useLeadCustomFields, CustomField, FieldType } from '@/hooks/useLeadCustomFields';

interface CustomFieldsManagerProps {
  adAccountId?: string;
}

const fieldTypeLabels: Record<FieldType, string> = {
  text: 'Texto',
  number: 'Número',
  date: 'Data',
  select: 'Seleção',
  checkbox: 'Checkbox',
};

export function CustomFieldsManager({ adAccountId }: CustomFieldsManagerProps) {
  const { customFields, loading, addCustomField, updateCustomField, deleteCustomField } = useLeadCustomFields(adAccountId);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<CustomField | null>(null);
  
  const [fieldName, setFieldName] = useState('');
  const [fieldType, setFieldType] = useState<FieldType>('text');
  const [fieldOptions, setFieldOptions] = useState('');
  const [isRequired, setIsRequired] = useState(false);

  const resetForm = () => {
    setFieldName('');
    setFieldType('text');
    setFieldOptions('');
    setIsRequired(false);
    setEditingField(null);
  };

  const handleOpenDialog = (field?: CustomField) => {
    if (field) {
      setEditingField(field);
      setFieldName(field.field_name);
      setFieldType(field.field_type);
      setFieldOptions(field.field_options?.join(', ') || '');
      setIsRequired(field.is_required);
    } else {
      resetForm();
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    resetForm();
  };

  const handleSave = async () => {
    if (!fieldName.trim()) return;

    const options = fieldType === 'select' 
      ? fieldOptions.split(',').map(o => o.trim()).filter(Boolean)
      : [];

    try {
      if (editingField) {
        await updateCustomField(editingField.id, {
          field_name: fieldName,
          field_type: fieldType,
          field_options: options,
          is_required: isRequired,
        });
      } else {
        await addCustomField({
          ad_account_id: adAccountId,
          field_name: fieldName,
          field_type: fieldType,
          field_options: options,
          is_required: isRequired,
        });
      }
      handleCloseDialog();
    } catch (error) {
      // Error handled in hook
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Tem certeza que deseja excluir este campo? Os valores já preenchidos serão perdidos.')) {
      await deleteCustomField(id);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Campos Personalizados</CardTitle>
            <CardDescription>Crie campos adicionais para seus leads</CardDescription>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={() => handleOpenDialog()}>
                <Plus className="h-4 w-4 mr-1" />
                Novo Campo
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingField ? 'Editar Campo' : 'Novo Campo Personalizado'}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Nome do Campo</Label>
                  <Input
                    placeholder="Ex: Produto de Interesse"
                    value={fieldName}
                    onChange={(e) => setFieldName(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Tipo do Campo</Label>
                  <Select value={fieldType} onValueChange={(v) => setFieldType(v as FieldType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">Texto</SelectItem>
                      <SelectItem value="number">Número</SelectItem>
                      <SelectItem value="date">Data</SelectItem>
                      <SelectItem value="select">Seleção (dropdown)</SelectItem>
                      <SelectItem value="checkbox">Checkbox (sim/não)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {fieldType === 'select' && (
                  <div>
                    <Label>Opções (separadas por vírgula)</Label>
                    <Input
                      placeholder="Opção 1, Opção 2, Opção 3"
                      value={fieldOptions}
                      onChange={(e) => setFieldOptions(e.target.value)}
                    />
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Switch
                    checked={isRequired}
                    onCheckedChange={setIsRequired}
                    id="is-required"
                  />
                  <Label htmlFor="is-required">Campo obrigatório</Label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={handleCloseDialog}>
                  Cancelar
                </Button>
                <Button onClick={handleSave} disabled={!fieldName.trim()}>
                  {editingField ? 'Salvar' : 'Criar Campo'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center text-muted-foreground py-4">Carregando...</div>
        ) : customFields.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            <p>Nenhum campo personalizado criado</p>
            <p className="text-sm">Clique em "Novo Campo" para adicionar</p>
          </div>
        ) : (
          <div className="space-y-2">
            {customFields.map((field) => (
              <div
                key={field.id}
                className="flex items-center justify-between p-3 border rounded-lg bg-muted/30"
              >
                <div className="flex items-center gap-3">
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="font-medium">{field.field_name}</div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Badge variant="secondary" className="text-xs">
                        {fieldTypeLabels[field.field_type]}
                      </Badge>
                      {field.is_required && (
                        <Badge variant="outline" className="text-xs">
                          Obrigatório
                        </Badge>
                      )}
                      {field.field_type === 'select' && field.field_options?.length > 0 && (
                        <span className="text-xs">
                          ({field.field_options.length} opções)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleOpenDialog(field)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(field.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
