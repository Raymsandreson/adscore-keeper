import { useState, useEffect } from 'react';
import { KanbanBoard, KanbanStage } from '@/hooks/useKanbanBoards';
import { useLeadCustomFields, FieldType } from '@/hooks/useLeadCustomFields';
import { useFieldStageRequirements } from '@/hooks/useFieldStageRequirements';
import { useProductsServices } from '@/hooks/useProductsServices';
import { StageAgentSelector } from './StageAgentSelector';
import { Pencil, Trash2 as Trash2Fields } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Plus, 
  Settings, 
  LayoutGrid, 
  Inbox, 
  Instagram, 
  Briefcase,
  Trash2,
  GripVertical,
  X,
} from 'lucide-react';

interface KanbanBoardSelectorProps {
  boards: KanbanBoard[];
  selectedBoardId: string | null;
  onSelectBoard: (boardId: string) => void;
  onCreateBoard: (board: Partial<KanbanBoard>) => Promise<KanbanBoard>;
  onUpdateBoard: (id: string, updates: Partial<KanbanBoard>) => Promise<KanbanBoard>;
  onDeleteBoard: (id: string) => Promise<void>;
  leadsCountByBoard?: Record<string, number>;
}

const BOARD_ICONS: Record<string, React.ReactNode> = {
  'layout-grid': <LayoutGrid className="h-4 w-4" />,
  'inbox': <Inbox className="h-4 w-4" />,
  'instagram': <Instagram className="h-4 w-4" />,
  'briefcase': <Briefcase className="h-4 w-4" />,
};

const DEFAULT_COLORS = [
  '#3b82f6', '#8b5cf6', '#22c55e', '#f97316', '#ef4444', '#06b6d4', '#ec4899',
];

const fieldTypeLabels: Record<FieldType, string> = {
  text: 'Texto',
  number: 'Número',
  date: 'Data',
  select: 'Seleção',
  checkbox: 'Checkbox',
};

function BoardCustomFieldsSection({ boardId, stages }: { boardId: string; stages: KanbanStage[] }) {
  const { customFields, loading, addCustomField, updateCustomField, deleteCustomField } = useLeadCustomFields(undefined, boardId);
  const { getStagesForField, setFieldStages } = useFieldStageRequirements(boardId);
  const [requiredStages, setRequiredStages] = useState<string[]>([]);
  const [showFieldDialog, setShowFieldDialog] = useState(false);
  const [editingField, setEditingField] = useState<{ id: string; field_name: string; field_type: FieldType; field_options: string[]; is_required: boolean } | null>(null);
  const [fieldName, setFieldName] = useState('');
  const [fieldType, setFieldType] = useState<FieldType>('text');
  const [fieldOptions, setFieldOptions] = useState('');
  const [isRequired, setIsRequired] = useState(false);

  const resetFieldForm = () => {
    setFieldName('');
    setFieldType('text');
    setFieldOptions('');
    setIsRequired(false);
    setRequiredStages([]);
    setEditingField(null);
  };

  const handleOpenFieldDialog = (field?: typeof editingField & { id: string }) => {
    if (field) {
      setEditingField(field);
      setFieldName(field.field_name);
      setFieldType(field.field_type);
      setFieldOptions(field.field_options?.join(', ') || '');
      setIsRequired(field.is_required);
      setRequiredStages(getStagesForField(field.id));
    } else {
      resetFieldForm();
    }
    setShowFieldDialog(true);
  };

  const handleSaveField = async () => {
    if (!fieldName.trim()) return;
    const options = fieldType === 'select' ? fieldOptions.split(',').map(o => o.trim()).filter(Boolean) : [];
    try {
      if (editingField) {
        await updateCustomField(editingField.id, { field_name: fieldName, field_type: fieldType, field_options: options, is_required: isRequired });
        if (isRequired) {
          await setFieldStages(editingField.id, boardId, requiredStages);
        } else {
          await setFieldStages(editingField.id, boardId, []);
        }
      } else {
        const newField = await addCustomField({ board_id: boardId, field_name: fieldName, field_type: fieldType, field_options: options, is_required: isRequired });
        if (isRequired && newField?.id) {
          await setFieldStages(newField.id, boardId, requiredStages);
        }
      }
      setShowFieldDialog(false);
      resetFieldForm();
    } catch {}
  };

  const handleDeleteField = async (id: string) => {
    if (confirm('Excluir este campo? Os valores preenchidos serão perdidos.')) {
      await deleteCustomField(id);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <Label className="text-sm font-semibold">📋 Campos Personalizados</Label>
        <Button variant="outline" size="sm" onClick={() => handleOpenFieldDialog()}>
          <Plus className="h-3 w-3 mr-1" />
          Novo
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Carregando...</p>
      ) : customFields.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum campo personalizado neste funil</p>
      ) : (
        <div className="space-y-1.5 max-h-[140px] overflow-y-auto">
          {customFields.map((field) => (
            <div key={field.id} className="flex items-center justify-between p-2 border rounded bg-muted/30 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium truncate">{field.field_name}</span>
                <Badge variant="secondary" className="text-[10px] shrink-0">{fieldTypeLabels[field.field_type]}</Badge>
                {field.is_required && <Badge variant="outline" className="text-[10px] shrink-0">Obrig.</Badge>}
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleOpenFieldDialog(field)}>
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDeleteField(field.id)}>
                  <Trash2Fields className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Inline field editor */}
      {showFieldDialog && (
        <div className="mt-2 p-3 border rounded-lg bg-card space-y-3">
          <div>
            <Label className="text-xs">Nome do Campo</Label>
            <Input value={fieldName} onChange={(e) => setFieldName(e.target.value)} placeholder="Ex: Produto" className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Tipo</Label>
            <select value={fieldType} onChange={(e) => setFieldType(e.target.value as FieldType)} className="w-full h-8 text-sm rounded border bg-background px-2">
              <option value="text">Texto</option>
              <option value="number">Número</option>
              <option value="date">Data</option>
              <option value="select">Seleção</option>
              <option value="checkbox">Checkbox</option>
            </select>
          </div>
          {fieldType === 'select' && (
            <div>
              <Label className="text-xs">Opções (vírgula)</Label>
              <Input value={fieldOptions} onChange={(e) => setFieldOptions(e.target.value)} placeholder="Op1, Op2" className="h-8 text-sm" />
            </div>
          )}
          <div className="flex items-center gap-2">
            <Switch checked={isRequired} onCheckedChange={(checked) => {
              setIsRequired(checked);
              if (!checked) setRequiredStages([]);
            }} id="field-req" />
            <Label htmlFor="field-req" className="text-xs">Obrigatório</Label>
          </div>
          {isRequired && stages.length > 0 && (
            <div className="pl-1 space-y-1.5">
              <Label className="text-xs text-muted-foreground">A partir de qual fase é obrigatório?</Label>
              <div className="space-y-1">
                {stages.map((stage) => (
                  <label key={stage.id} className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox
                      checked={requiredStages.includes(stage.id)}
                      onCheckedChange={(checked) => {
                        setRequiredStages(prev =>
                          checked
                            ? [...prev, stage.id]
                            : prev.filter(id => id !== stage.id)
                        );
                      }}
                    />
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
                    <span>{stage.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => { setShowFieldDialog(false); resetFieldForm(); }}>Cancelar</Button>
            <Button size="sm" onClick={handleSaveField} disabled={!fieldName.trim()}>{editingField ? 'Salvar' : 'Criar'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function KanbanBoardSelector({
  boards,
  selectedBoardId,
  onSelectBoard,
  onCreateBoard,
  onUpdateBoard,
  onDeleteBoard,
  leadsCountByBoard = {},
}: KanbanBoardSelectorProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingBoard, setEditingBoard] = useState<KanbanBoard | null>(null);
  const { products } = useProductsServices();
  
  // Form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formColor, setFormColor] = useState('#3b82f6');
  const [formIcon, setFormIcon] = useState('layout-grid');
  const [formStages, setFormStages] = useState<KanbanStage[]>([]);
  const [newStageName, setNewStageName] = useState('');
  const [newStageColor, setNewStageColor] = useState('#3b82f6');
  const [formBoardType, setFormBoardType] = useState<'funnel' | 'workflow'>('funnel');
  const [formProductServiceId, setFormProductServiceId] = useState<string | null>(null);

  const resetForm = () => {
    setFormName('');
    setFormDescription('');
    setFormColor('#3b82f6');
    setFormIcon('layout-grid');
    setFormStages([]);
    setNewStageName('');
    setNewStageColor('#3b82f6');
    setFormBoardType('funnel');
    setFormProductServiceId(null);
  };

  const handleOpenCreate = () => {
    resetForm();
    // Add default stages
    setFormStages([
      { id: 'new', name: 'Novo', color: '#3b82f6' },
      { id: 'in_progress', name: 'Em Andamento', color: '#f97316' },
      { id: 'done', name: 'Concluído', color: '#22c55e' },
    ]);
    setShowCreateDialog(true);
  };

  const handleOpenEdit = (board: KanbanBoard) => {
    setEditingBoard(board);
    setFormName(board.name);
    setFormDescription(board.description || '');
    setFormColor(board.color);
    setFormIcon(board.icon);
    setFormStages([...board.stages]);
    setFormBoardType(board.board_type || 'funnel');
    setFormProductServiceId(board.product_service_id || null);
    setShowEditDialog(true);
  };

  const handleCreate = async () => {
    if (!formName.trim()) return;
    
    await onCreateBoard({
      name: formName,
      description: formDescription || null,
      color: formColor,
      icon: formIcon,
      stages: formStages,
      board_type: formBoardType,
      product_service_id: formProductServiceId,
    } as Partial<KanbanBoard>);
    
    setShowCreateDialog(false);
    resetForm();
  };

  const handleUpdate = async () => {
    if (!editingBoard || !formName.trim()) return;
    
    await onUpdateBoard(editingBoard.id, {
      name: formName,
      description: formDescription || null,
      color: formColor,
      icon: formIcon,
      stages: formStages,
      product_service_id: formProductServiceId,
    });
    
    setShowEditDialog(false);
    setEditingBoard(null);
    resetForm();
  };

  const handleDelete = async () => {
    if (!editingBoard) return;
    if (!confirm(`Tem certeza que deseja excluir o quadro "${editingBoard.name}"? Os leads serão desvinculados.`)) return;
    
    await onDeleteBoard(editingBoard.id);
    setShowEditDialog(false);
    setEditingBoard(null);
    resetForm();
  };

  const handleAddStage = () => {
    if (!newStageName.trim()) return;
    
    const newStage: KanbanStage = {
      id: newStageName.toLowerCase().replace(/\s+/g, '_'),
      name: newStageName,
      color: newStageColor,
    };
    
    setFormStages([...formStages, newStage]);
    setNewStageName('');
    setNewStageColor('#3b82f6');
  };

  const handleRemoveStage = (stageId: string) => {
    setFormStages(formStages.filter(s => s.id !== stageId));
  };

  const handleMoveStage = (index: number, direction: 'up' | 'down') => {
    const newStages = [...formStages];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newStages.length) return;
    
    [newStages[index], newStages[targetIndex]] = [newStages[targetIndex], newStages[index]];
    setFormStages(newStages);
  };

  const selectedBoard = boards.find(b => b.id === selectedBoardId);

  return (
    <>
      <div className="flex items-center gap-2">
        <Select value={selectedBoardId || undefined} onValueChange={onSelectBoard}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Selecionar quadro">
              {selectedBoard && (
                <span className="flex items-center gap-2">
                  {BOARD_ICONS[selectedBoard.icon] || BOARD_ICONS['layout-grid']}
                  {selectedBoard.name}
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {boards.map((board) => (
              <SelectItem key={board.id} value={board.id}>
                <span className="flex items-center gap-2">
                  {BOARD_ICONS[board.icon] || BOARD_ICONS['layout-grid']}
                  {board.name}
                  {leadsCountByBoard[board.id] !== undefined && (
                    <Badge variant="secondary" className="ml-auto text-xs">
                      {leadsCountByBoard[board.id]}
                    </Badge>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" size="icon" onClick={handleOpenCreate} title="Criar quadro">
          <Plus className="h-4 w-4" />
        </Button>

        {selectedBoard && (
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => handleOpenEdit(selectedBoard)}
            title="Configurar quadro"
          >
            <Settings className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Create Board Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Criar Novo Quadro</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Nome do Quadro</Label>
              <Input 
                value={formName} 
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Ex: Prospecção Instagram"
              />
            </div>

            <div>
              <Label>Descrição (opcional)</Label>
              <Textarea 
                value={formDescription} 
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Descreva o propósito deste quadro..."
                rows={2}
              />
            </div>

            <div>
              <Label>Tipo do Quadro</Label>
              <Select value={formBoardType} onValueChange={(v) => setFormBoardType(v as 'funnel' | 'workflow')}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="funnel">
                    <span className="flex items-center gap-2">
                      <LayoutGrid className="h-3.5 w-3.5" />
                      Funil de Vendas
                    </span>
                  </SelectItem>
                  <SelectItem value="workflow">
                    <span className="flex items-center gap-2">
                      <Briefcase className="h-3.5 w-3.5" />
                      Fluxo de Trabalho (Processual)
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">
                {formBoardType === 'funnel' 
                  ? 'Funil livre para o período comercial (pré-fechamento)' 
                  : 'Fluxo sequencial para acompanhar processos pós-fechamento'}
              </p>
            </div>

            <div>
              <Label>Produto/Serviço vinculado</Label>
              <Select value={formProductServiceId || '__none__'} onValueChange={(v) => setFormProductServiceId(v === '__none__' ? null : v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Nenhum produto vinculado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhum</SelectItem>
                  {products.filter(p => p.is_active).map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      📦 {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">
                Leads que entrarem neste funil herdarão automaticamente este produto
              </p>
            </div>

            <div className="flex gap-4">
              <div className="flex-1">
                <Label>Cor</Label>
                <div className="flex gap-2 mt-1">
                  {DEFAULT_COLORS.map((color) => (
                    <button
                      key={color}
                      className={`w-6 h-6 rounded-full border-2 ${formColor === color ? 'border-foreground' : 'border-transparent'}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setFormColor(color)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <Label>Ícone</Label>
                <div className="flex gap-2 mt-1">
                  {Object.entries(BOARD_ICONS).map(([key, icon]) => (
                    <button
                      key={key}
                      className={`p-2 rounded border ${formIcon === key ? 'border-primary bg-primary/10' : 'border-border'}`}
                      onClick={() => setFormIcon(key)}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <Label>Estágios do Funil</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Configure os dias de alerta de estagnação por estágio (deixe vazio para desativar)
              </p>
              <ScrollArea className="h-[180px] border rounded-md p-2 mt-1">
                {formStages.map((stage, index) => (
                  <div key={stage.id} className="flex items-center gap-2 py-1.5 border-b border-border/50 last:border-0">
                    <GripVertical className="h-4 w-4 text-muted-foreground cursor-move" />
                    <div 
                      className="w-3 h-3 rounded-full shrink-0" 
                      style={{ backgroundColor: stage.color }}
                    />
                    <Input
                      value={stage.name}
                      onChange={(e) => {
                        const newStages = [...formStages];
                        newStages[index] = { ...stage, name: e.target.value };
                        setFormStages(newStages);
                      }}
                      className="flex-1 h-7 text-sm"
                    />
                    <Input
                      type="number"
                      min="0"
                      placeholder="dias"
                      value={stage.stagnationDays || ''}
                      onChange={(e) => {
                        const value = e.target.value ? parseInt(e.target.value) : undefined;
                        const newStages = [...formStages];
                        newStages[index] = { ...stage, stagnationDays: value };
                        setFormStages(newStages);
                      }}
                      className="w-16 h-7 text-xs text-center"
                      title="Dias para alerta de estagnação"
                    />
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-6 w-6 shrink-0"
                      onClick={() => handleRemoveStage(stage.id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </ScrollArea>
              
              <div className="flex gap-2 mt-2">
                <Input 
                  value={newStageName}
                  onChange={(e) => setNewStageName(e.target.value)}
                  placeholder="Nome do estágio"
                  className="flex-1"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddStage()}
                />
                <input
                  type="color"
                  value={newStageColor}
                  onChange={(e) => setNewStageColor(e.target.value)}
                  className="w-10 h-9 rounded border cursor-pointer"
                />
                <Button variant="outline" onClick={handleAddStage}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={!formName.trim() || formStages.length === 0}>
              Criar Quadro
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Board Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar Quadro</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Nome do Quadro</Label>
              <Input 
                value={formName} 
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Ex: Prospecção Instagram"
              />
            </div>

            <div>
              <Label>Descrição (opcional)</Label>
              <Textarea 
                value={formDescription} 
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Descreva o propósito deste quadro..."
                rows={2}
              />
            </div>

            <div>
              <Label>Produto/Serviço vinculado</Label>
              <Select value={formProductServiceId || '__none__'} onValueChange={(v) => setFormProductServiceId(v === '__none__' ? null : v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Nenhum produto vinculado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhum</SelectItem>
                  {products.filter(p => p.is_active).map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      📦 {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">
                Leads que entrarem neste funil herdarão automaticamente este produto
              </p>
            </div>

            <div className="flex gap-4">
              <div className="flex-1">
                <Label>Cor</Label>
                <div className="flex gap-2 mt-1">
                  {DEFAULT_COLORS.map((color) => (
                    <button
                      key={color}
                      className={`w-6 h-6 rounded-full border-2 ${formColor === color ? 'border-foreground' : 'border-transparent'}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setFormColor(color)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <Label>Ícone</Label>
                <div className="flex gap-2 mt-1">
                  {Object.entries(BOARD_ICONS).map(([key, icon]) => (
                    <button
                      key={key}
                      className={`p-2 rounded border ${formIcon === key ? 'border-primary bg-primary/10' : 'border-border'}`}
                      onClick={() => setFormIcon(key)}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <Label>Estágios do Funil</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Configure os dias de alerta de estagnação por estágio (deixe vazio para desativar)
              </p>
              <ScrollArea className="h-[180px] border rounded-md p-2 mt-1">
                {formStages.map((stage, index) => (
                  <div key={stage.id} className="flex items-center gap-2 py-1.5 border-b border-border/50 last:border-0">
                    <GripVertical className="h-4 w-4 text-muted-foreground cursor-move" />
                    <div 
                      className="w-3 h-3 rounded-full shrink-0" 
                      style={{ backgroundColor: stage.color }}
                    />
                    <Input
                      value={stage.name}
                      onChange={(e) => {
                        const newStages = [...formStages];
                        newStages[index] = { ...stage, name: e.target.value };
                        setFormStages(newStages);
                      }}
                      className="flex-1 h-7 text-sm"
                    />
                    <Input
                      type="number"
                      min="0"
                      placeholder="dias"
                      value={stage.stagnationDays || ''}
                      onChange={(e) => {
                        const value = e.target.value ? parseInt(e.target.value) : undefined;
                        const newStages = [...formStages];
                        newStages[index] = { ...stage, stagnationDays: value };
                        setFormStages(newStages);
                      }}
                      className="w-16 h-7 text-xs text-center"
                      title="Dias para alerta de estagnação"
                    />
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-6 w-6 shrink-0"
                      onClick={() => handleRemoveStage(stage.id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </ScrollArea>
              
              <div className="flex gap-2 mt-2">
                <Input 
                  value={newStageName}
                  onChange={(e) => setNewStageName(e.target.value)}
                  placeholder="Nome do estágio"
                  className="flex-1"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddStage()}
                />
                <input
                  type="color"
                  value={newStageColor}
                  onChange={(e) => setNewStageColor(e.target.value)}
                  className="w-10 h-10 rounded border cursor-pointer"
                />
                <Button variant="outline" onClick={handleAddStage}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {editingBoard && (
              <>
                <BoardCustomFieldsSection boardId={editingBoard.id} stages={editingBoard.stages} />
                <StageAgentSelector boardId={editingBoard.id} stages={formStages} />
              </>
            )}
          </div>

          <DialogFooter className="flex justify-between">
            <Button variant="destructive" onClick={handleDelete}>
              <Trash2 className="h-4 w-4 mr-2" />
              Excluir
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowEditDialog(false)}>
                Cancelar
              </Button>
              <Button onClick={handleUpdate} disabled={!formName.trim() || formStages.length === 0}>
                Salvar
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      
    </>
  );
}
