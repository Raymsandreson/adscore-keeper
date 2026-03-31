import { useState } from 'react';
import { Plus, Pencil, Trash2, GripVertical, Settings2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useLeadCustomFields, CustomField, CustomFieldValue, FieldType } from '@/hooks/useLeadCustomFields';
import { useKanbanBoards, KanbanBoard } from '@/hooks/useKanbanBoards';
import { useFieldStageRequirements } from '@/hooks/useFieldStageRequirements';
import { CustomFieldInput } from '@/components/leads/CustomFieldsForm';
import { toast } from 'sonner';

const fieldTypeLabels: Record<FieldType, string> = {
  text: 'Texto',
  number: 'Número',
  date: 'Data',
  select: 'Seleção',
  checkbox: 'Checkbox',
};

interface CustomFieldsConfigPanelProps {
  leadId: string;
  currentBoardId?: string | null;
  boards?: KanbanBoard[];
  adAccountId?: string;
}

export function CustomFieldsConfigPanel({
  leadId,
  currentBoardId,
  boards: externalBoards,
  adAccountId,
}: CustomFieldsConfigPanelProps) {
  const { boards: hookBoards } = useKanbanBoards();
  const boards = externalBoards || hookBoards;
  const currentBoard = boards.find(b => b.id === currentBoardId);
  const { getStagesForField, setFieldStages, fetchRequirements } = useFieldStageRequirements(currentBoardId || undefined);

  // Stage requirements dialog
  const [stageReqDialogOpen, setStageReqDialogOpen] = useState(false);
  const [stageReqField, setStageReqField] = useState<CustomField | null>(null);
  const [selectedStageIds, setSelectedStageIds] = useState<string[]>([]);

  // Load all custom fields (no board filter to show everything relevant)
  const {
    customFields,
    loading: fieldsLoading,
    addCustomField,
    updateCustomField,
    deleteCustomField,
    getFieldValues,
    saveAllFieldValues,
  } = useLeadCustomFields(adAccountId);

  const [fieldValues, setFieldValues] = useState<Record<string, CustomFieldValue>>({});
  const [localFieldValues, setLocalFieldValues] = useState<Record<string, { type: FieldType; value: string | number | boolean | null }>>({});
  const [valuesLoaded, setValuesLoaded] = useState(false);

  // Config mode
  const [configMode, setConfigMode] = useState(false);

  // Field creation/edit dialog
  const [fieldDialogOpen, setFieldDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<CustomField | null>(null);
  const [fieldName, setFieldName] = useState('');
  const [fieldType, setFieldType] = useState<FieldType>('text');
  const [fieldOptions, setFieldOptions] = useState('');
  const [isRequired, setIsRequired] = useState(false);

  // Scope dialog
  const [scopeDialogOpen, setScopeDialogOpen] = useState(false);
  const [pendingFieldData, setPendingFieldData] = useState<Partial<CustomField> | null>(null);
  const [scopeChoice, setScopeChoice] = useState<'current' | 'all' | 'select'>('current');
  const [selectedBoardIds, setSelectedBoardIds] = useState<string[]>([]);

  // Load field values on mount
  useState(() => {
    if (leadId && !valuesLoaded) {
      getFieldValues(leadId).then(values => {
        setFieldValues(values);
        const initial: Record<string, { type: FieldType; value: string | number | boolean | null }> = {};
        customFields.forEach(field => {
          const val = values[field.id];
          if (val) {
            let value: string | number | boolean | null = null;
            switch (field.field_type) {
              case 'text': case 'select': value = val.value_text; break;
              case 'number': value = val.value_number; break;
              case 'date': value = val.value_date; break;
              case 'checkbox': value = val.value_boolean; break;
            }
            initial[field.id] = { type: field.field_type, value };
          }
        });
        setLocalFieldValues(initial);
        setValuesLoaded(true);
      });
    }
  });

  const handleFieldChange = (fieldId: string, type: FieldType, value: string | number | boolean | null) => {
    setLocalFieldValues(prev => ({ ...prev, [fieldId]: { type, value } }));
  };

  // Filter fields relevant to this lead's board
  const relevantFields = customFields.filter(f =>
    !f.board_id || f.board_id === currentBoardId
  );

  const resetFieldForm = () => {
    setFieldName('');
    setFieldType('text');
    setFieldOptions('');
    setIsRequired(false);
    setEditingField(null);
    setSelectedStageIds([]);
  };

  const openNewField = () => {
    console.log('📝 openNewField called, opening dialog');
    resetFieldForm();
    setFieldDialogOpen(true);
  };

  const openEditField = (field: CustomField) => {
    setEditingField(field);
    setFieldName(field.field_name);
    setFieldType(field.field_type);
    setFieldOptions(field.field_options?.join(', ') || '');
    setIsRequired(field.is_required);
    // Load existing stage requirements for this field
    const currentStages = getStagesForField(field.id);
    setSelectedStageIds(currentStages);
    setFieldDialogOpen(true);
  };

  const handleFieldDialogSave = () => {
    if (!fieldName.trim()) return;

    const options = fieldType === 'select'
      ? fieldOptions.split(',').map(o => o.trim()).filter(Boolean)
      : [];

    if (editingField) {
      // For editing, show scope dialog
      setPendingFieldData({
        id: editingField.id,
        field_name: fieldName,
        field_type: fieldType,
        field_options: options,
        is_required: isRequired,
      });
      setFieldDialogOpen(false);
      setScopeChoice('current');
      setSelectedBoardIds(currentBoardId ? [currentBoardId] : []);
      setScopeDialogOpen(true);
    } else {
      // For new fields, show scope dialog
      setPendingFieldData({
        field_name: fieldName,
        field_type: fieldType,
        field_options: options,
        is_required: isRequired,
        ad_account_id: adAccountId,
      });
      setFieldDialogOpen(false);
      setScopeChoice('current');
      setSelectedBoardIds(currentBoardId ? [currentBoardId] : []);
      setScopeDialogOpen(true);
    }
  };

  const handleScopeConfirm = async () => {
    if (!pendingFieldData) return;
    console.log('📝 handleScopeConfirm called', { pendingFieldData, scopeChoice, currentBoardId });
    try {
      if (editingField && pendingFieldData.id) {
        // Update existing field
        if (scopeChoice === 'all') {
          await updateCustomField(pendingFieldData.id, {
            ...pendingFieldData,
            board_id: null, // global
          });
        } else if (scopeChoice === 'current') {
          await updateCustomField(pendingFieldData.id, {
            ...pendingFieldData,
            board_id: currentBoardId || null,
          });
        } else {
          // For 'select', update the original and create copies for other boards
          await updateCustomField(pendingFieldData.id, {
            ...pendingFieldData,
            board_id: currentBoardId || null,
          });
          // Create in other selected boards
          const otherBoards = selectedBoardIds.filter(id => id !== currentBoardId);
          for (const boardId of otherBoards) {
            await addCustomField({
              ...pendingFieldData,
              board_id: boardId,
              ad_account_id: adAccountId,
            });
          }
        }
      } else {
        // Create new field
        if (scopeChoice === 'all') {
          await addCustomField({
            ...pendingFieldData,
            board_id: null,
          });
        } else if (scopeChoice === 'current') {
          await addCustomField({
            ...pendingFieldData,
            board_id: currentBoardId || null,
          });
        } else {
          // Create in each selected board
          for (const boardId of selectedBoardIds) {
            await addCustomField({
              ...pendingFieldData,
              board_id: boardId,
              ad_account_id: adAccountId,
            });
          }
        }
      }

      // Save stage requirements if field is required and stages are selected
      if (isRequired && currentBoardId && selectedStageIds.length > 0) {
        const fieldId = editingField?.id || pendingFieldData.id;
        if (fieldId) {
          await setFieldStages(fieldId, currentBoardId, selectedStageIds);
        }
      } else if (!isRequired && currentBoardId) {
        // Clear stage requirements if field is no longer required
        const fieldId = editingField?.id || pendingFieldData.id;
        if (fieldId) {
          await setFieldStages(fieldId, currentBoardId, []);
        }
      }

      setScopeDialogOpen(false);
      setPendingFieldData(null);
      resetFieldForm();
    } catch {
      // handled in hook
    }
  };

  const handleDeleteField = async (field: CustomField) => {
    if (confirm(`Tem certeza que deseja excluir o campo "${field.field_name}"? Os valores já preenchidos serão perdidos.`)) {
      await deleteCustomField(field.id);
    }
  };

  const toggleBoardSelection = (boardId: string) => {
    setSelectedBoardIds(prev =>
      prev.includes(boardId)
        ? prev.filter(id => id !== boardId)
        : [...prev, boardId]
    );
  };

  const openStageReqDialog = (field: CustomField) => {
    setStageReqField(field);
    const currentStages = getStagesForField(field.id);
    setSelectedStageIds(currentStages);
    setStageReqDialogOpen(true);
  };

  const handleSaveStageRequirements = async () => {
    if (!stageReqField || !currentBoardId) return;
    try {
      await setFieldStages(stageReqField.id, currentBoardId, selectedStageIds);
      toast.success('Obrigatoriedade por fase salva!');
      setStageReqDialogOpen(false);
    } catch {
      toast.error('Erro ao salvar');
    }
  };

  const toggleStageSelection = (stageId: string) => {
    setSelectedStageIds(prev =>
      prev.includes(stageId)
        ? prev.filter(id => id !== stageId)
        : [...prev, stageId]
    );
  };

  // Save field values (called externally via parent)
  const saveValues = async () => {
    if (Object.keys(localFieldValues).length > 0) {
      await saveAllFieldValues(leadId, localFieldValues);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header with config toggle */}
      <div className="flex items-center justify-between">
        <h4 className="font-medium flex items-center gap-2">
          <Settings2 className="h-4 w-4" />
          Campos Personalizados
          {currentBoard && (
            <Badge variant="outline" className="text-xs font-normal">
              {currentBoard.name}
            </Badge>
          )}
        </h4>
        <Button
          variant={configMode ? 'default' : 'outline'}
          size="sm"
          onClick={() => setConfigMode(!configMode)}
          className="gap-1"
        >
          <Settings2 className="h-3.5 w-3.5" />
          {configMode ? 'Concluir' : 'Configurar'}
        </Button>
      </div>

      {/* Config Mode - Kommo style field list */}
      {configMode ? (
        <div className="space-y-1 border rounded-lg overflow-hidden">
          {relevantFields.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">
              Nenhum campo personalizado criado
            </div>
          ) : (
            relevantFields.map((field) => (
              <div
                key={field.id}
                className="flex items-center justify-between px-4 py-3 border-b last:border-b-0 hover:bg-accent/30 transition-colors group"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <GripVertical className="h-4 w-4 text-muted-foreground/50 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-sm">{field.field_name}</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      {field.field_type === 'select' && field.field_options?.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {field.field_options.length} variantes
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {field.is_required && (
                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                      Obrigatório {relevantFields.filter(f => f.is_required).length}
                    </Badge>
                  )}
                  {field.board_id ? (
                    <Badge variant="secondary" className="text-[10px]">
                      {boards.find(b => b.id === field.board_id)?.name || 'Funil'}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      Global
                    </Badge>
                  )}
                  {getStagesForField(field.id).length > 0 && (
                    <Badge variant="default" className="text-[10px] gap-0.5">
                      <ShieldCheck className="h-2.5 w-2.5" />
                      {getStagesForField(field.id).length} fase(s)
                    </Badge>
                  )}
                  {currentBoard && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => openStageReqDialog(field)}
                      title="Obrigatório por fase"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => openEditField(field)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                    onClick={() => handleDeleteField(field)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))
          )}

          {/* Add field button - Kommo style */}
          <button
            onClick={openNewField}
            className="w-full flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors border-t"
          >
            <Plus className="h-4 w-4" />
            Adicionar campo
          </button>
        </div>
      ) : (
        /* Normal mode - show field values for filling */
        <>
          {fieldsLoading ? (
            <div className="text-sm text-muted-foreground py-4 text-center">
              Carregando campos...
            </div>
          ) : relevantFields.length === 0 ? (
            <div className="text-center text-muted-foreground py-6 space-y-2">
              <p className="text-sm">Nenhum campo personalizado configurado</p>
              <Button variant="outline" size="sm" onClick={() => setConfigMode(true)} className="gap-1">
                <Plus className="h-3.5 w-3.5" />
                Configurar campos
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {relevantFields.map((field) => (
                <CustomFieldInput
                  key={field.id}
                  field={field}
                  value={fieldValues[field.id] || null}
                  onChange={handleFieldChange}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Field Create/Edit Dialog */}
      <Dialog open={fieldDialogOpen} onOpenChange={setFieldDialogOpen}>
        <DialogContent className="sm:max-w-md">
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
                autoFocus
              />
            </div>
            <div>
              <Label>Tipo do Campo</Label>
              <Select value={fieldType} onValueChange={(v) => setFieldType(v as FieldType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(fieldTypeLabels).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
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
              <Switch checked={isRequired} onCheckedChange={setIsRequired} id="cfg-required" />
              <Label htmlFor="cfg-required">Campo obrigatório</Label>
            </div>

            {/* Inline stage selection when required is ON */}
            {isRequired && currentBoard && currentBoard.stages.length > 0 && (
              <div className="space-y-2 pl-1">
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3" />
                  Obrigatório em quais fases?
                </Label>
                <p className="text-xs text-muted-foreground">
                  Selecione as fases onde este campo deve ser preenchido para o lead avançar. Se nenhuma fase for selecionada, será obrigatório em todas.
                </p>
                <div className="space-y-1 border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                  {currentBoard.stages.map((stage) => (
                    <label
                      key={stage.id}
                      className="flex items-center gap-3 px-3 py-2 border-b last:border-b-0 hover:bg-accent/30 cursor-pointer transition-colors"
                    >
                      <Checkbox
                        checked={selectedStageIds.includes(stage.id)}
                        onCheckedChange={() => toggleStageSelection(stage.id)}
                      />
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: stage.color }} />
                      <span className="text-sm">{stage.name}</span>
                    </label>
                  ))}
                </div>
                {selectedStageIds.length > 0 && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">
                    ⚠️ Obrigatório em {selectedStageIds.length} fase(s) selecionada(s)
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFieldDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleFieldDialogSave} disabled={!fieldName.trim()}>
              Continuar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Scope Selection Dialog */}
      <Dialog open={scopeDialogOpen} onOpenChange={setScopeDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Onde aplicar este campo?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Escolha em quais fluxos de trabalho o campo "{pendingFieldData?.field_name}" deve aparecer.
            </p>

            {/* Current board info */}
            {currentBoard && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: currentBoard.stages?.[0]?.color || '#3b82f6' }} />
                <span className="text-sm font-medium">Fluxo atual: {currentBoard.name}</span>
              </div>
            )}

            {/* Scope options */}
            <div className="space-y-2">
              <label
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  scopeChoice === 'current' ? 'border-primary bg-primary/5' : 'hover:bg-accent/50'
                }`}
                onClick={() => setScopeChoice('current')}
              >
                <input
                  type="radio"
                  name="scope"
                  checked={scopeChoice === 'current'}
                  onChange={() => setScopeChoice('current')}
                  className="accent-primary"
                />
                <div>
                  <span className="text-sm font-medium">Somente no fluxo atual</span>
                  <p className="text-xs text-muted-foreground">
                    {currentBoard ? currentBoard.name : 'Campo global (sem funil)'}
                  </p>
                </div>
              </label>

              <label
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  scopeChoice === 'all' ? 'border-primary bg-primary/5' : 'hover:bg-accent/50'
                }`}
                onClick={() => setScopeChoice('all')}
              >
                <input
                  type="radio"
                  name="scope"
                  checked={scopeChoice === 'all'}
                  onChange={() => setScopeChoice('all')}
                  className="accent-primary"
                />
                <div>
                  <span className="text-sm font-medium">Todos os fluxos de trabalho</span>
                  <p className="text-xs text-muted-foreground">Campo global visível em todos os funis</p>
                </div>
              </label>

              <label
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  scopeChoice === 'select' ? 'border-primary bg-primary/5' : 'hover:bg-accent/50'
                }`}
                onClick={() => setScopeChoice('select')}
              >
                <input
                  type="radio"
                  name="scope"
                  checked={scopeChoice === 'select'}
                  onChange={() => setScopeChoice('select')}
                  className="accent-primary"
                />
                <div>
                  <span className="text-sm font-medium">Escolher fluxos específicos</span>
                  <p className="text-xs text-muted-foreground">Selecione em quais funis este campo deve aparecer</p>
                </div>
              </label>
            </div>

            {/* Board selection for 'select' mode */}
            {scopeChoice === 'select' && (
              <div className="space-y-2 pl-2">
                <Label className="text-xs text-muted-foreground">Selecione os fluxos:</Label>
                <ScrollArea className="max-h-48">
                  <div className="space-y-1">
                    {boards.map(board => (
                      <label
                        key={board.id}
                        className="flex items-center gap-2 p-2 rounded hover:bg-accent/30 cursor-pointer"
                      >
                        <Checkbox
                          checked={selectedBoardIds.includes(board.id)}
                          onCheckedChange={() => toggleBoardSelection(board.id)}
                        />
                        <span className="text-sm">{board.name}</span>
                        {board.id === currentBoardId && (
                          <Badge variant="outline" className="text-[10px] ml-auto">Atual</Badge>
                        )}
                      </label>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScopeDialogOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleScopeConfirm}
              disabled={scopeChoice === 'select' && selectedBoardIds.length === 0}
            >
              {editingField ? 'Salvar Campo' : 'Criar Campo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stage Requirements Dialog */}
      <Dialog open={stageReqDialogOpen} onOpenChange={setStageReqDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              Obrigatório por fase
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Selecione em quais fases do fluxo o campo <strong>"{stageReqField?.field_name}"</strong> será obrigatório para o lead avançar.
            </p>
            {currentBoard && currentBoard.stages.length > 0 ? (
              <div className="space-y-1 border rounded-lg overflow-hidden">
                {currentBoard.stages.map((stage) => (
                  <label
                    key={stage.id}
                    className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 hover:bg-accent/30 cursor-pointer transition-colors"
                  >
                    <Checkbox
                      checked={selectedStageIds.includes(stage.id)}
                      onCheckedChange={() => toggleStageSelection(stage.id)}
                    />
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: stage.color }} />
                    <span className="text-sm font-medium">{stage.name}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhuma fase configurada neste fluxo.
              </p>
            )}
            {selectedStageIds.length > 0 && (
              <p className="text-xs text-muted-foreground">
                ⚠️ Ao mover um lead para essas fases, o campo será validado como obrigatório.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStageReqDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveStageRequirements}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
