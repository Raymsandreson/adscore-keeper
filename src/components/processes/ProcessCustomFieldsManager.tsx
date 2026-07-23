import { useState, useMemo } from 'react';
import { Plus, Trash2, GripVertical, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useProcessCustomFields, ProcessCustomField, FieldType } from '@/hooks/useProcessCustomFields';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';

// Editor dedicado de campos personalizados de PROCESSO. Espelha a ideia do
// CustomFieldsManager do lead, porém: (1) escopo por workflow (board_type='workflow')
// em vez de funil, (2) campo de "aba" livre pra agrupar (ex.: "Perícias"),
// (3) sem obrigatoriedade-por-fase. Não compartilha código com o do lead — zero risco.

interface ProcessCustomFieldsManagerProps {
  adAccountId?: string;
}

const fieldTypeLabels: Record<FieldType, string> = {
  text: 'Texto',
  number: 'Número',
  date: 'Data',
  select: 'Seleção',
  checkbox: 'Checkbox',
  url: 'Link',
  password: 'Senha',
};

export function ProcessCustomFieldsManager({ adAccountId }: ProcessCustomFieldsManagerProps) {
  const { boards } = useKanbanBoards();
  const workflows = useMemo(() => boards.filter((b: any) => b.board_type === 'workflow'), [boards]);

  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('all');
  const workflowFilter = selectedWorkflowId === 'all' ? undefined : selectedWorkflowId;
  const { customFields, loading, addCustomField, updateCustomField, deleteCustomField } =
    useProcessCustomFields(workflowFilter);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<ProcessCustomField | null>(null);

  const [fieldName, setFieldName] = useState('');
  const [fieldType, setFieldType] = useState<FieldType>('text');
  const [fieldOptions, setFieldOptions] = useState('');
  const [isRequired, setIsRequired] = useState(false);
  const [fieldWorkflowId, setFieldWorkflowId] = useState<string>('none');
  const [fieldTab, setFieldTab] = useState('Geral');

  const resetForm = () => {
    setFieldName('');
    setFieldType('text');
    setFieldOptions('');
    setIsRequired(false);
    setFieldWorkflowId(selectedWorkflowId !== 'all' ? selectedWorkflowId : 'none');
    setFieldTab('Geral');
    setEditingField(null);
  };

  const handleOpenDialog = (field?: ProcessCustomField) => {
    if (field) {
      setEditingField(field);
      setFieldName(field.field_name);
      setFieldType(field.field_type);
      setFieldOptions(field.field_options?.join(', ') || '');
      setIsRequired(field.is_required);
      setFieldWorkflowId(field.workflow_id || 'none');
      setFieldTab(field.tab || 'Geral');
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

    const workflowIdValue = fieldWorkflowId === 'none' ? null : fieldWorkflowId;
    const tabValue = fieldTab.trim() || 'Geral';

    try {
      if (editingField) {
        await updateCustomField(editingField.id, {
          field_name: fieldName,
          field_type: fieldType,
          field_options: options,
          is_required: isRequired,
          workflow_id: workflowIdValue,
          tab: tabValue,
        });
      } else {
        await addCustomField({
          ad_account_id: adAccountId,
          workflow_id: workflowIdValue,
          field_name: fieldName,
          field_type: fieldType,
          field_options: options,
          is_required: isRequired,
          tab: tabValue,
        });
      }
      handleCloseDialog();
    } catch {
      // erro tratado no hook
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Tem certeza que deseja excluir este campo? Os valores já preenchidos serão perdidos.')) {
      await deleteCustomField(id);
    }
  };

  const getWorkflowName = (workflowId: string | null) => {
    if (!workflowId) return null;
    return workflows.find((b: any) => b.id === workflowId)?.name;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Campos do Processo</CardTitle>
            <CardDescription>
              Campos adicionais por POP (ex.: datas de perícia médica e social no fluxo BPC)
            </CardDescription>
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
                <DialogTitle>{editingField ? 'Editar Campo' : 'Novo Campo do Processo'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>POP</Label>
                  <Select value={fieldWorkflowId} onValueChange={setFieldWorkflowId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Todos os fluxos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Todos os fluxos (global)</SelectItem>
                      {workflows.map((wf: any) => (
                        <SelectItem key={wf.id} value={wf.id}>{wf.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Aba</Label>
                  <Input
                    placeholder="Ex: Perícias"
                    value={fieldTab}
                    onChange={(e) => setFieldTab(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Nome do Campo</Label>
                  <Input
                    placeholder="Ex: Data da perícia médica"
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
                      <SelectItem value="url">Link (URL com prévia)</SelectItem>
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
                  <Switch checked={isRequired} onCheckedChange={setIsRequired} id="process-field-required" />
                  <Label htmlFor="process-field-required">Campo obrigatório</Label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={handleCloseDialog}>Cancelar</Button>
                <Button onClick={handleSave} disabled={!fieldName.trim()}>
                  {editingField ? 'Salvar' : 'Criar Campo'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Filtro por fluxo */}
        <div className="pt-2">
          <Select value={selectedWorkflowId} onValueChange={setSelectedWorkflowId}>
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue placeholder="Filtrar por fluxo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os fluxos</SelectItem>
              {workflows.map((wf: any) => (
                <SelectItem key={wf.id} value={wf.id}>{wf.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center text-muted-foreground py-4">Carregando...</div>
        ) : customFields.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            <p>Nenhum campo de processo criado</p>
            <p className="text-sm">Clique em "Novo Campo" para adicionar</p>
          </div>
        ) : (
          <div className="space-y-2">
            {customFields.map((field) => (
              <div key={field.id} className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                <div className="flex items-center gap-3">
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="font-medium">{field.field_name}</div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
                      <Badge variant="secondary" className="text-xs">{fieldTypeLabels[field.field_type]}</Badge>
                      {field.tab && field.tab !== 'basic' && (
                        <Badge variant="outline" className="text-xs">{field.tab}</Badge>
                      )}
                      {field.is_required && <Badge variant="outline" className="text-xs">Obrigatório</Badge>}
                      {field.workflow_id ? (
                        <Badge variant="default" className="text-xs">{getWorkflowName(field.workflow_id) || 'POP'}</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-muted-foreground">Global</Badge>
                      )}
                      {field.field_type === 'select' && field.field_options?.length > 0 && (
                        <span className="text-xs">({field.field_options.length} opções)</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(field)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(field.id)}>
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
