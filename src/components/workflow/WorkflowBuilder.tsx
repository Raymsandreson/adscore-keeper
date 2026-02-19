import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet';
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
  GripVertical,
  Workflow,
} from 'lucide-react';
import { useKanbanBoards, KanbanBoard, KanbanStage } from '@/hooks/useKanbanBoards';
import { useChecklists, ChecklistItem } from '@/hooks/useChecklists';
import { useActivityTypes } from '@/hooks/useActivityTypes';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface WorkflowBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onWorkflowSaved?: () => void;
}

interface PhaseObjective {
  templateId?: string;
  name: string;
  description: string;
  is_mandatory: boolean;
  items: ChecklistItem[];
  isExpanded: boolean;
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

export function WorkflowBuilder({ open, onOpenChange, onWorkflowSaved }: WorkflowBuilderProps) {
  const { boards, fetchBoards, createBoard, updateBoard, deleteBoard } = useKanbanBoards();
  const {
    templates,
    fetchTemplates,
    createTemplate,
    updateTemplate,
    fetchStageLinks,
    linkChecklistToStage,
    unlinkChecklistFromStage,
  } = useChecklists();
  const { types: activityTypes } = useActivityTypes();

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [editingBoardId, setEditingBoardId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [phases, setPhases] = useState<PhaseConfig[]>([]);
  const [newPhaseName, setNewPhaseName] = useState('');
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
    setPhases([]);
    setNewPhaseName('');
    setEditingBoardId(null);
    setViewMode('list');
  };

  const handleNewWorkflow = () => {
    resetForm();
    setFormName('');
    setFormDescription('');
    setPhases([
      { stageId: 'new_' + Date.now(), stageName: 'Novo', stageColor: '#3b82f6', objectives: [], isExpanded: false },
      { stageId: 'progress_' + Date.now(), stageName: 'Em Andamento', stageColor: '#f97316', objectives: [], isExpanded: false },
      { stageId: 'done_' + Date.now(), stageName: 'Concluído', stageColor: '#22c55e', objectives: [], isExpanded: false },
    ]);
    setViewMode('edit');
  };

  const handleEditWorkflow = async (board: KanbanBoard) => {
    setEditingBoardId(board.id);
    setFormName(board.name);
    setFormDescription(board.description || '');

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
          isExpanded: false,
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

  // Phase helpers
  const addPhase = () => {
    if (!newPhaseName.trim()) return;
    setPhases(prev => [...prev, {
      stageId: newPhaseName.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now(),
      stageName: newPhaseName,
      stageColor: '#3b82f6',
      objectives: [],
      isExpanded: false,
    }]);
    setNewPhaseName('');
  };

  const removePhase = (idx: number) => setPhases(prev => prev.filter((_, i) => i !== idx));

  const togglePhase = (idx: number) =>
    setPhases(prev => prev.map((p, i) => i === idx ? { ...p, isExpanded: !p.isExpanded } : p));

  const updatePhaseName = (idx: number, name: string) =>
    setPhases(prev => prev.map((p, i) => i === idx ? { ...p, stageName: name } : p));

  // Objective helpers
  const toggleObjective = (phaseIdx: number, objIdx: number) =>
    setPhases(prev => prev.map((p, pi) =>
      pi === phaseIdx
        ? { ...p, objectives: p.objectives.map((o, oi) => oi === objIdx ? { ...o, isExpanded: !o.isExpanded } : o) }
        : p
    ));

  const addObjective = (phaseIdx: number) => {
    setPhases(prev => prev.map((p, i) =>
      i === phaseIdx
        ? {
            ...p,
            isExpanded: true,
            objectives: [...p.objectives, {
              name: 'Novo objetivo',
              description: '',
              is_mandatory: false,
              items: [],
              isExpanded: true,
            }],
          }
        : p
    ));
  };

  const updateObjective = (phaseIdx: number, objIdx: number, updates: Partial<PhaseObjective>) => {
    setPhases(prev => prev.map((p, pi) =>
      pi === phaseIdx
        ? { ...p, objectives: p.objectives.map((o, oi) => oi === objIdx ? { ...o, ...updates } : o) }
        : p
    ));
  };

  const removeObjective = (phaseIdx: number, objIdx: number) => {
    setPhases(prev => prev.map((p, pi) =>
      pi === phaseIdx
        ? { ...p, objectives: p.objectives.filter((_, oi) => oi !== objIdx) }
        : p
    ));
  };

  // Step helpers
  const addStep = (phaseIdx: number, objIdx: number, label: string) => {
    if (!label.trim()) return;
    updateObjective(phaseIdx, objIdx, {
      items: [...(phases[phaseIdx].objectives[objIdx].items), { id: crypto.randomUUID(), label: label.trim() }],
    });
  };

  const removeStep = (phaseIdx: number, objIdx: number, stepId: string) => {
    updateObjective(phaseIdx, objIdx, {
      items: phases[phaseIdx].objectives[objIdx].items.filter(s => s.id !== stepId),
    });
  };

  const updateStepLabel = (phaseIdx: number, objIdx: number, stepId: string, label: string) => {
    updateObjective(phaseIdx, objIdx, {
      items: phases[phaseIdx].objectives[objIdx].items.map(s => s.id === stepId ? { ...s, label } : s),
    });
  };

  const updateStepDescription = (phaseIdx: number, objIdx: number, stepId: string, description: string) => {
    updateObjective(phaseIdx, objIdx, {
      items: phases[phaseIdx].objectives[objIdx].items.map(s => s.id === stepId ? { ...s, description } : s),
    });
  };

  const updateStepActivityType = (phaseIdx: number, objIdx: number, stepId: string, activityType: string) => {
    updateObjective(phaseIdx, objIdx, {
      items: phases[phaseIdx].objectives[objIdx].items.map(s => s.id === stepId ? { ...s, activityType: activityType || undefined } : s),
    });
  };

  // Save
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
          color: '#3b82f6',
          stages,
        });
        boardId = editingBoardId;
      } else {
        const created = await createBoard({
          name: formName.trim(),
          description: formDescription.trim() || null,
          color: '#3b82f6',
          stages,
        });
        boardId = created.id;
      }

      const existingLinks = await fetchStageLinks(boardId);

      for (const phase of phases) {
        const phaseLinks = existingLinks.filter(l => l.stage_id === phase.stageId);
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
            await updateTemplate(templateId, templateData);
          } else {
            const created = await createTemplate(templateData);
            templateId = created?.id;
          }

          if (templateId) {
            wantedTemplateIds.add(templateId);
            const hasLink = phaseLinks.some(l => l.checklist_template_id === templateId);
            if (!hasLink) {
              await linkChecklistToStage(templateId, boardId, phase.stageId);
            }
          }
        }

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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-xl w-full flex flex-col p-0">
        <SheetHeader className="px-6 py-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Workflow className="h-5 w-5" />
            {viewMode === 'list' ? 'Fluxos de Trabalho' : (editingBoardId ? 'Editar fluxo de trabalho' : 'Novo fluxo de trabalho')}
          </SheetTitle>
        </SheetHeader>

        {viewMode === 'list' ? (
          /* ===== LIST ===== */
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
            {boards.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhum fluxo criado ainda</p>
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
                        <Badge variant="secondary" className="text-[10px] mt-1 ml-5">
                          {board.stages.length} fases
                        </Badge>
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
            <Button className="w-full" variant="outline" onClick={handleNewWorkflow}>
              <Plus className="h-4 w-4 mr-2" />
              Novo Fluxo de Trabalho
            </Button>
          </div>
        ) : (
          /* ===== INLINE HIERARCHICAL EDITOR ===== */
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Name */}
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Nome:</Label>
                <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Ex: Prospecção Outbound" className="mt-1" />
              </div>

              {/* Description */}
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Descrição:</Label>
                <Textarea value={formDescription} onChange={e => setFormDescription(e.target.value)} placeholder="Descreva o propósito..." className="mt-1 min-h-[60px]" />
              </div>

              {/* Phases → Objectives → Steps */}
              <div className="space-y-3">
                {phases.map((phase, phaseIdx) => (
                  <div key={phase.stageId} className="border rounded-lg overflow-hidden">
                    {/* Phase header */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-muted/40">
                      <GripVertical className="h-4 w-4 text-muted-foreground/50 flex-shrink-0" />
                      <Collapsible open={phase.isExpanded} onOpenChange={() => togglePhase(phaseIdx)} className="flex-1">
                        <CollapsibleTrigger className="flex items-center gap-2 w-full text-left">
                          {phase.isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          <span className="font-semibold text-sm text-primary">{phase.stageName}</span>
                        </CollapsibleTrigger>
                      </Collapsible>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {phase.objectives.length} objetivo(s)
                      </span>
                      <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" onClick={() => addObjective(phaseIdx)}>
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" onClick={() => {
                        const newName = prompt('Renomear fase:', phase.stageName);
                        if (newName) updatePhaseName(phaseIdx, newName);
                      }}>
                        <Edit3 className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive flex-shrink-0" onClick={() => removePhase(phaseIdx)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>

                    {/* Phase description row */}
                    {phase.isExpanded && (
                      <div className="border-t">
                        {/* Objectives */}
                        {phase.objectives.length === 0 && (
                          <p className="text-xs text-muted-foreground italic px-4 py-3">Nenhum objetivo adicionado</p>
                        )}

                        {phase.objectives.map((obj, objIdx) => (
                          <div key={objIdx} className="border-t first:border-t-0">
                            {/* Objective header */}
                            <div className="flex items-center gap-2 px-4 py-2 ml-4 border-l-2 border-primary/30">
                              <Collapsible open={obj.isExpanded} onOpenChange={() => toggleObjective(phaseIdx, objIdx)} className="flex-1">
                                <CollapsibleTrigger className="flex items-center gap-2 w-full text-left">
                                  {obj.isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                  <span className="font-medium text-sm">{obj.name}</span>
                                </CollapsibleTrigger>
                              </Collapsible>
                              <span className="text-xs text-muted-foreground whitespace-nowrap">
                                {obj.items.length} passo(s)
                              </span>
                              <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" onClick={() => {
                                const newName = prompt('Renomear objetivo:', obj.name);
                                if (newName) updateObjective(phaseIdx, objIdx, { name: newName });
                              }}>
                                <Edit3 className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive flex-shrink-0" onClick={() => removeObjective(phaseIdx, objIdx)}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>

                            {/* Objective description */}
                            {obj.isExpanded && (
                              <div className="ml-4 border-l-2 border-primary/30 px-4 pb-3 space-y-2">
                                {obj.description && (
                                  <p className="text-xs text-muted-foreground border-l-2 border-muted pl-2">{obj.description}</p>
                                )}

                                <Input
                                  value={obj.description}
                                  onChange={e => updateObjective(phaseIdx, objIdx, { description: e.target.value })}
                                  placeholder="Descrição do objetivo..."
                                  className="h-7 text-xs"
                                />

                                {/* Steps */}
                                {obj.items.length === 0 ? (
                                  <p className="text-[11px] text-muted-foreground italic">Nenhum passo adicionado</p>
                                ) : (
                                  obj.items.map((step) => (
                                    <div key={step.id} className="ml-4 border-l-2 border-muted pl-3 py-2 space-y-1.5">
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm flex-1">{step.label}</span>
                                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => {
                                          const newLabel = prompt('Editar passo:', step.label);
                                          if (newLabel) updateStepLabel(phaseIdx, objIdx, step.id, newLabel);
                                        }}>
                                          <Edit3 className="h-2.5 w-2.5" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive" onClick={() => removeStep(phaseIdx, objIdx, step.id)}>
                                          <Trash2 className="h-2.5 w-2.5" />
                                        </Button>
                                      </div>
                                      {/* Activity type selector */}
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">Tipo de ativ.:</span>
                                        <Select
                                          value={step.activityType || '__none__'}
                                          onValueChange={v => updateStepActivityType(phaseIdx, objIdx, step.id, v === '__none__' ? '' : v)}
                                        >
                                          <SelectTrigger className="h-6 text-[11px] flex-1">
                                            <SelectValue placeholder="Nenhum" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="__none__">
                                              <span className="text-muted-foreground">Nenhum</span>
                                            </SelectItem>
                                            {activityTypes.filter(t => t.is_active).map(t => (
                                              <SelectItem key={t.id} value={t.key}>
                                                <div className="flex items-center gap-1.5">
                                                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                                                  {t.label}
                                                </div>
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                      <Input
                                        value={step.description || ''}
                                        onChange={e => updateStepDescription(phaseIdx, objIdx, step.id, e.target.value)}
                                        placeholder="Descrição do passo (opcional)..."
                                        className="h-6 text-[11px]"
                                      />
                                    </div>
                                  ))
                                )}

                                {/* Add step inline */}
                                <StepAdder onAdd={(label) => addStep(phaseIdx, objIdx, label)} />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {/* Add phase */}
                <div className="flex gap-2">
                  <Input
                    value={newPhaseName}
                    onChange={e => setNewPhaseName(e.target.value)}
                    placeholder="Nova fase..."
                    className="flex-1"
                    onKeyDown={e => e.key === 'Enter' && addPhase()}
                  />
                  <Button variant="outline" onClick={addPhase} disabled={!newPhaseName.trim()}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            <SheetFooter className="px-6 py-3 border-t mt-auto flex justify-between">
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
                  {saving ? 'Salvando...' : 'Salvar'}
                </Button>
              </div>
            </SheetFooter>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Small inline component for adding a step */
function StepAdder({ onAdd }: { onAdd: (label: string) => void }) {
  const [label, setLabel] = useState('');
  return (
    <div className="flex gap-1.5">
      <Input
        value={label}
        onChange={e => setLabel(e.target.value)}
        placeholder="Novo passo..."
        className="flex-1 h-7 text-xs"
        onKeyDown={e => {
          if (e.key === 'Enter' && label.trim()) {
            onAdd(label);
            setLabel('');
          }
        }}
      />
      <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => {
        if (label.trim()) { onAdd(label); setLabel(''); }
      }}>
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );
}
