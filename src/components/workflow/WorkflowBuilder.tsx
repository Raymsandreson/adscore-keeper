import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Plus,
  Trash2,
  Edit3,
  X,
  ChevronRight,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  Workflow,
  Target,
  CheckSquare,
  GripVertical,
} from 'lucide-react';
import { useKanbanBoards, KanbanBoard, KanbanStage } from '@/hooks/useKanbanBoards';
import { useChecklists, ChecklistTemplate, ChecklistItem, ChecklistStageLink } from '@/hooks/useChecklists';
import { toast } from 'sonner';

interface WorkflowBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onWorkflowSaved?: () => void;
}

interface PhaseObjective {
  templateId?: string; // existing template id, undefined for new
  name: string;
  description: string;
  is_mandatory: boolean;
  items: ChecklistItem[];
}

interface PhaseConfig {
  stageId: string;
  stageName: string;
  stageColor: string;
  stagnationDays?: number;
  objectives: PhaseObjective[];
  isExpanded: boolean;
}

type ViewMode = 'list' | 'edit';

const DEFAULT_COLORS = [
  '#3b82f6', '#8b5cf6', '#22c55e', '#f97316', '#ef4444', '#06b6d4', '#ec4899',
];

export function WorkflowBuilder({ open, onOpenChange, onWorkflowSaved }: WorkflowBuilderProps) {
  const { boards, fetchBoards, createBoard, updateBoard, deleteBoard } = useKanbanBoards();
  const {
    templates,
    fetchTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    fetchStageLinks,
    linkChecklistToStage,
    unlinkChecklistFromStage,
  } = useChecklists();

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [editingBoardId, setEditingBoardId] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formColor, setFormColor] = useState('#3b82f6');
  const [phases, setPhases] = useState<PhaseConfig[]>([]);
  const [newPhaseName, setNewPhaseName] = useState('');
  const [newPhaseColor, setNewPhaseColor] = useState('#3b82f6');

  // Objective editing
  const [editingObjectivePhaseIdx, setEditingObjectivePhaseIdx] = useState<number | null>(null);
  const [editingObjectiveIdx, setEditingObjectiveIdx] = useState<number | null>(null);
  const [objName, setObjName] = useState('');
  const [objDescription, setObjDescription] = useState('');
  const [objMandatory, setObjMandatory] = useState(false);
  const [objItems, setObjItems] = useState<ChecklistItem[]>([]);
  const [newStepLabel, setNewStepLabel] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      fetchBoards();
      fetchTemplates();
    }
  }, [open]);

  const resetForm = () => {
    setFormName('');
    setFormDescription('');
    setFormColor('#3b82f6');
    setPhases([]);
    setNewPhaseName('');
    setEditingBoardId(null);
    setEditingObjectivePhaseIdx(null);
    setEditingObjectiveIdx(null);
    setViewMode('list');
  };

  const handleNewWorkflow = () => {
    resetForm();
    setPhases([
      { stageId: 'new', stageName: 'Novo', stageColor: '#3b82f6', objectives: [], isExpanded: false },
      { stageId: 'in_progress', stageName: 'Em Andamento', stageColor: '#f97316', objectives: [], isExpanded: false },
      { stageId: 'done', stageName: 'Concluído', stageColor: '#22c55e', objectives: [], isExpanded: false },
    ]);
    setViewMode('edit');
  };

  const handleEditWorkflow = async (board: KanbanBoard) => {
    setEditingBoardId(board.id);
    setFormName(board.name);
    setFormDescription(board.description || '');
    setFormColor(board.color);

    // Load objectives for each phase
    const links = await fetchStageLinks(board.id);
    const phaseConfigs: PhaseConfig[] = board.stages.map(stage => {
      const stageLinks = links.filter(l => l.stage_id === stage.id);
      const objectives: PhaseObjective[] = stageLinks.map(link => {
        const tmpl = templates.find(t => t.id === link.checklist_template_id);
        return {
          templateId: link.checklist_template_id,
          name: tmpl?.name || 'Objetivo',
          description: tmpl?.description || '',
          is_mandatory: tmpl?.is_mandatory || false,
          items: tmpl?.items || [],
        };
      });
      return {
        stageId: stage.id,
        stageName: stage.name,
        stageColor: stage.color,
        stagnationDays: stage.stagnationDays,
        objectives,
        isExpanded: false,
      };
    });

    setPhases(phaseConfigs);
    setViewMode('edit');
  };

  const handleDeleteWorkflow = async (board: KanbanBoard) => {
    if (!confirm(`Excluir o fluxo "${board.name}"? Leads serão desvinculados.`)) return;
    await deleteBoard(board.id);
    fetchBoards();
  };

  // Phase management
  const handleAddPhase = () => {
    if (!newPhaseName.trim()) return;
    setPhases([...phases, {
      stageId: newPhaseName.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now(),
      stageName: newPhaseName,
      stageColor: newPhaseColor,
      objectives: [],
      isExpanded: false,
    }]);
    setNewPhaseName('');
  };

  const handleRemovePhase = (idx: number) => {
    setPhases(phases.filter((_, i) => i !== idx));
  };

  const handleMovePhase = (idx: number, direction: 'up' | 'down') => {
    const newPhases = [...phases];
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= newPhases.length) return;
    [newPhases[idx], newPhases[targetIdx]] = [newPhases[targetIdx], newPhases[idx]];
    setPhases(newPhases);
  };

  const togglePhaseExpand = (idx: number) => {
    setPhases(prev => prev.map((p, i) => i === idx ? { ...p, isExpanded: !p.isExpanded } : p));
  };

  // Objective management
  const startAddObjective = (phaseIdx: number) => {
    setEditingObjectivePhaseIdx(phaseIdx);
    setEditingObjectiveIdx(null);
    setObjName('');
    setObjDescription('');
    setObjMandatory(false);
    setObjItems([]);
    setNewStepLabel('');
  };

  const startEditObjective = (phaseIdx: number, objIdx: number) => {
    const obj = phases[phaseIdx].objectives[objIdx];
    setEditingObjectivePhaseIdx(phaseIdx);
    setEditingObjectiveIdx(objIdx);
    setObjName(obj.name);
    setObjDescription(obj.description);
    setObjMandatory(obj.is_mandatory);
    setObjItems([...obj.items]);
    setNewStepLabel('');
  };

  const cancelObjectiveEdit = () => {
    setEditingObjectivePhaseIdx(null);
    setEditingObjectiveIdx(null);
  };

  const handleAddStep = () => {
    if (!newStepLabel.trim()) return;
    setObjItems([...objItems, { id: crypto.randomUUID(), label: newStepLabel.trim() }]);
    setNewStepLabel('');
  };

  const handleMoveStep = (idx: number, direction: 'up' | 'down') => {
    const newItems = [...objItems];
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= newItems.length) return;
    [newItems[idx], newItems[targetIdx]] = [newItems[targetIdx], newItems[idx]];
    setObjItems(newItems);
  };

  const saveObjective = () => {
    if (!objName.trim() || objItems.length === 0 || editingObjectivePhaseIdx === null) return;

    const newObj: PhaseObjective = {
      templateId: editingObjectiveIdx !== null
        ? phases[editingObjectivePhaseIdx].objectives[editingObjectiveIdx].templateId
        : undefined,
      name: objName.trim(),
      description: objDescription.trim(),
      is_mandatory: objMandatory,
      items: objItems,
    };

    setPhases(prev => prev.map((p, i) => {
      if (i !== editingObjectivePhaseIdx) return p;
      const newObjs = [...p.objectives];
      if (editingObjectiveIdx !== null) {
        newObjs[editingObjectiveIdx] = newObj;
      } else {
        newObjs.push(newObj);
      }
      return { ...p, objectives: newObjs, isExpanded: true };
    }));

    cancelObjectiveEdit();
  };

  const removeObjective = (phaseIdx: number, objIdx: number) => {
    setPhases(prev => prev.map((p, i) => {
      if (i !== phaseIdx) return p;
      return { ...p, objectives: p.objectives.filter((_, j) => j !== objIdx) };
    }));
  };

  // Save workflow
  const handleSave = async () => {
    if (!formName.trim() || phases.length === 0) return;
    setSaving(true);

    try {
      const stages: KanbanStage[] = phases.map(p => ({
        id: p.stageId,
        name: p.stageName,
        color: p.stageColor,
        stagnationDays: p.stagnationDays,
      }));

      let boardId: string;

      if (editingBoardId) {
        await updateBoard(editingBoardId, {
          name: formName.trim(),
          description: formDescription.trim() || null,
          color: formColor,
          stages,
        });
        boardId = editingBoardId;
      } else {
        const created = await createBoard({
          name: formName.trim(),
          description: formDescription.trim() || null,
          color: formColor,
          stages,
        });
        boardId = created.id;
      }

      // Sync objectives: create/update templates and link to stages
      // First, get existing links for cleanup
      const existingLinks = await fetchStageLinks(boardId);

      for (const phase of phases) {
        const phaseLinks = existingLinks.filter(l => l.stage_id === phase.stageId);

        // Track which template IDs we want linked
        const wantedTemplateIds = new Set<string>();

        for (const obj of phase.objectives) {
          let templateId = obj.templateId;

          const templateData = {
            name: obj.name,
            description: obj.description || null,
            is_mandatory: obj.is_mandatory,
            items: obj.items,
          };

          if (templateId) {
            // Update existing template
            await updateTemplate(templateId, templateData);
          } else {
            // Create new template
            const created = await createTemplate(templateData);
            templateId = created?.id;
          }

          if (templateId) {
            wantedTemplateIds.add(templateId);

            // Ensure link exists
            const hasLink = phaseLinks.some(l => l.checklist_template_id === templateId);
            if (!hasLink) {
              await linkChecklistToStage(templateId, boardId, phase.stageId);
            }
          }
        }

        // Remove links that are no longer wanted for this phase
        for (const link of phaseLinks) {
          if (!wantedTemplateIds.has(link.checklist_template_id)) {
            await unlinkChecklistFromStage(link.id);
          }
        }
      }

      toast.success(editingBoardId ? 'Fluxo atualizado!' : 'Fluxo criado!');
      resetForm();
      fetchBoards();
      fetchTemplates();
      onWorkflowSaved?.();
    } catch (error) {
      console.error('Error saving workflow:', error);
      toast.error('Erro ao salvar fluxo');
    } finally {
      setSaving(false);
    }
  };

  const isEditingObjective = editingObjectivePhaseIdx !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Workflow className="h-5 w-5" />
            {viewMode === 'list' ? 'Fluxos de Trabalho' : (editingBoardId ? 'Editar Fluxo' : 'Novo Fluxo de Trabalho')}
          </DialogTitle>
        </DialogHeader>

        {viewMode === 'list' ? (
          /* ===== WORKFLOW LIST ===== */
          <div className="space-y-3">
            <ScrollArea className="max-h-[60vh]">
              {boards.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Nenhum fluxo criado ainda
                </p>
              ) : (
                boards.map(board => (
                  <Card key={board.id} className="mb-2">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: board.color }} />
                            <span className="font-medium text-sm">{board.name}</span>
                          </div>
                          {board.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 ml-5">{board.description}</p>
                          )}
                          <div className="flex gap-2 mt-1 ml-5">
                            <Badge variant="secondary" className="text-[10px]">
                              {board.stages.length} fases
                            </Badge>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEditWorkflow(board)}>
                            <Edit3 className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteWorkflow(board)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </ScrollArea>

            <Button className="w-full" variant="outline" onClick={handleNewWorkflow}>
              <Plus className="h-4 w-4 mr-2" />
              Novo Fluxo de Trabalho
            </Button>
          </div>
        ) : isEditingObjective ? (
          /* ===== OBJECTIVE EDITOR ===== */
          <div className="flex flex-col min-h-0 flex-1">
            <div className="overflow-y-auto flex-1 space-y-4 pr-1" style={{ maxHeight: 'calc(90vh - 160px)' }}>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <button onClick={cancelObjectiveEdit} className="hover:text-foreground transition-colors">
                  ← Voltar ao fluxo
                </button>
              </div>

              <div>
                <Label>Nome do Objetivo</Label>
                <Input value={objName} onChange={e => setObjName(e.target.value)} placeholder="Ex: Documentação Inicial" />
              </div>

              <div>
                <Label>Descrição (opcional)</Label>
                <Input value={objDescription} onChange={e => setObjDescription(e.target.value)} placeholder="Breve descrição..." />
              </div>

              <div className="flex items-center gap-3">
                <Switch checked={objMandatory} onCheckedChange={setObjMandatory} />
                <Label>Obrigatório para avançar de fase</Label>
              </div>

              <div>
                <Label>Passos</Label>
                <div className="border rounded-md p-2 mt-1 space-y-1">
                  {objItems.map((item, idx) => (
                    <div key={item.id} className="flex items-center gap-1 py-1 border-b border-border/50 last:border-0">
                      <div className="flex flex-col">
                        <Button variant="ghost" size="icon" className="h-4 w-4 p-0" onClick={() => handleMoveStep(idx, 'up')} disabled={idx === 0}>
                          <ArrowUp className="h-2.5 w-2.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-4 w-4 p-0" onClick={() => handleMoveStep(idx, 'down')} disabled={idx === objItems.length - 1}>
                          <ArrowDown className="h-2.5 w-2.5" />
                        </Button>
                      </div>
                      <CheckSquare className="h-3 w-3 text-muted-foreground" />
                      <Input
                        value={item.label}
                        onChange={e => {
                          const updated = [...objItems];
                          updated[idx] = { ...item, label: e.target.value };
                          setObjItems(updated);
                        }}
                        className="flex-1 h-7 text-sm"
                      />
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setObjItems(objItems.filter(i => i.id !== item.id))}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 mt-2">
                  <Input
                    value={newStepLabel}
                    onChange={e => setNewStepLabel(e.target.value)}
                    placeholder="Novo passo..."
                    className="flex-1"
                    onKeyDown={e => e.key === 'Enter' && handleAddStep()}
                  />
                  <Button variant="outline" size="sm" onClick={handleAddStep}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            <DialogFooter className="pt-3 border-t mt-3">
              <Button variant="outline" onClick={cancelObjectiveEdit}>Cancelar</Button>
              <Button onClick={saveObjective} disabled={!objName.trim() || objItems.length === 0}>
                Salvar Objetivo
              </Button>
            </DialogFooter>
          </div>
        ) : (
          /* ===== WORKFLOW EDITOR ===== */
          <div className="flex flex-col min-h-0 flex-1">
            <div className="overflow-y-auto flex-1 space-y-4 pr-1" style={{ maxHeight: 'calc(90vh - 160px)' }}>
              <div>
                <Label>Nome do Fluxo</Label>
                <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Ex: Prospecção Outbound" />
              </div>

              <div>
                <Label>Descrição (opcional)</Label>
                <Input value={formDescription} onChange={e => setFormDescription(e.target.value)} placeholder="Descreva o propósito..." />
              </div>

              <div>
                <Label>Cor</Label>
                <div className="flex gap-2 mt-1">
                  {DEFAULT_COLORS.map(color => (
                    <button
                      key={color}
                      className={`w-6 h-6 rounded-full border-2 ${formColor === color ? 'border-foreground' : 'border-transparent'}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setFormColor(color)}
                    />
                  ))}
                </div>
              </div>

              {/* Phases */}
              <div>
                <Label className="flex items-center gap-2">
                  <Workflow className="h-4 w-4" />
                  Fases do Fluxo
                </Label>
                <div className="border rounded-md mt-1 overflow-hidden">
                  {phases.map((phase, idx) => (
                    <Collapsible key={phase.stageId} open={phase.isExpanded} onOpenChange={() => togglePhaseExpand(idx)}>
                      <div className="border-b border-border/50 last:border-0">
                        <div className="flex items-center gap-1 px-2 py-1.5">
                          <div className="flex flex-col">
                            <Button variant="ghost" size="icon" className="h-4 w-4 p-0" onClick={(e) => { e.stopPropagation(); handleMovePhase(idx, 'up'); }} disabled={idx === 0}>
                              <ArrowUp className="h-2.5 w-2.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-4 w-4 p-0" onClick={(e) => { e.stopPropagation(); handleMovePhase(idx, 'down'); }} disabled={idx === phases.length - 1}>
                              <ArrowDown className="h-2.5 w-2.5" />
                            </Button>
                          </div>

                          <CollapsibleTrigger asChild>
                            <button className="flex items-center gap-2 flex-1 text-left py-1 hover:bg-accent/50 rounded px-1">
                              {phase.isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: phase.stageColor }} />
                              <span className="text-sm font-medium">{phase.stageName}</span>
                              {phase.objectives.length > 0 && (
                                <Badge variant="secondary" className="text-[10px] h-4 px-1.5 ml-auto">
                                  {phase.objectives.length} obj.
                                </Badge>
                              )}
                            </button>
                          </CollapsibleTrigger>

                          <Input
                            value={phase.stageName}
                            onChange={e => {
                              setPhases(prev => prev.map((p, i) => i === idx ? { ...p, stageName: e.target.value } : p));
                            }}
                            className="w-32 h-7 text-sm"
                            onClick={e => e.stopPropagation()}
                          />

                          <input
                            type="color"
                            value={phase.stageColor}
                            onChange={e => setPhases(prev => prev.map((p, i) => i === idx ? { ...p, stageColor: e.target.value } : p))}
                            className="w-7 h-7 rounded border cursor-pointer"
                            onClick={e => e.stopPropagation()}
                          />

                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleRemovePhase(idx)}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>

                        <CollapsibleContent>
                          <div className="px-4 py-2 bg-muted/30 space-y-1.5">
                            {phase.objectives.length === 0 ? (
                              <p className="text-xs text-muted-foreground italic py-1">Nenhum objetivo nesta fase</p>
                            ) : (
                              phase.objectives.map((obj, objIdx) => (
                                <div key={objIdx} className="flex items-center gap-2 p-2 rounded bg-background border">
                                  <Target className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-sm font-medium truncate">{obj.name}</span>
                                      {obj.is_mandatory && (
                                        <Badge variant="destructive" className="text-[9px] h-3.5 px-1">Obrigatório</Badge>
                                      )}
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">{obj.items.length} passos</p>
                                  </div>
                                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => startEditObjective(idx, objIdx)}>
                                    <Edit3 className="h-3 w-3" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeObjective(idx, objIdx)}>
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              ))
                            )}
                            <Button variant="outline" size="sm" className="w-full text-xs h-7" onClick={() => startAddObjective(idx)}>
                              <Plus className="h-3 w-3 mr-1" />
                              Adicionar Objetivo
                            </Button>
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  ))}
                </div>

                <div className="flex gap-2 mt-2">
                  <Input
                    value={newPhaseName}
                    onChange={e => setNewPhaseName(e.target.value)}
                    placeholder="Nova fase..."
                    className="flex-1"
                    onKeyDown={e => e.key === 'Enter' && handleAddPhase()}
                  />
                  <input
                    type="color"
                    value={newPhaseColor}
                    onChange={e => setNewPhaseColor(e.target.value)}
                    className="w-10 h-9 rounded border cursor-pointer"
                  />
                  <Button variant="outline" onClick={handleAddPhase}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            <DialogFooter className="pt-3 border-t mt-3 flex justify-between">
              {editingBoardId && (
                <Button variant="destructive" size="sm" onClick={() => {
                  const board = boards.find(b => b.id === editingBoardId);
                  if (board) handleDeleteWorkflow(board);
                }}>
                  <Trash2 className="h-4 w-4 mr-1" />
                  Excluir
                </Button>
              )}
              <div className="flex gap-2 ml-auto">
                <Button variant="outline" onClick={resetForm}>Cancelar</Button>
                <Button onClick={handleSave} disabled={!formName.trim() || phases.length === 0 || saving}>
                  {saving ? 'Salvando...' : (editingBoardId ? 'Salvar' : 'Criar Fluxo')}
                </Button>
              </div>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
