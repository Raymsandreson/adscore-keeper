import { useState, useEffect } from 'react';
import { useConfirmDelete } from '@/hooks/useConfirmDelete';
import { cn } from '@/lib/utils';
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Plus,
  Trash2,
  Edit3,
  X,
  ChevronRight,
  ChevronDown,
  GripVertical,
  Workflow,
  MessageSquareText,
  Info,
  ClipboardList,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { useKanbanBoards, KanbanBoard, KanbanStage } from '@/hooks/useKanbanBoards';
import { useChecklists, ChecklistItem, DocChecklistItem, CHECKLIST_TYPES, ChecklistType } from '@/hooks/useChecklists';
import { useActivityTypes } from '@/hooks/useActivityTypes';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface WorkflowBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onWorkflowSaved?: () => void;
  initialEditBoardId?: string | null;
  initialCreateNew?: boolean;
  boardType?: 'workflow' | 'funnel';
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

export function WorkflowBuilder({ open, onOpenChange, onWorkflowSaved, initialEditBoardId, initialCreateNew, boardType = 'workflow' }: WorkflowBuilderProps) {
  const { boards: allBoards, fetchBoards, createBoard, updateBoard, deleteBoard } = useKanbanBoards();
  const boards = allBoards.filter(b => b.board_type === boardType);
  const isFunnel = boardType === 'funnel';
  const typeLabel = isFunnel ? 'Funil de Vendas' : 'Fluxo de Trabalho';
  const typeLabelLower = isFunnel ? 'funil' : 'fluxo de trabalho';
  const { confirmDelete, ConfirmDeleteDialog } = useConfirmDelete();
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
  const [scriptDialog, setScriptDialog] = useState<{ phaseIdx: number; objIdx: number; stepId: string; script: string } | null>(null);
  const [descDialog, setDescDialog] = useState<{ phaseIdx: number; objIdx: number; stepId: string; description: string } | null>(null);
  const [docChecklistDialog, setDocChecklistDialog] = useState<{ phaseIdx: number; objIdx: number; stepId: string; items: DocChecklistItem[]; checklistType: ChecklistType } | null>(null);
  const [newDocItem, setNewDocItem] = useState('');
  const [dragItem, setDragItem] = useState<{ type: 'objective' | 'step'; phaseIdx: number; objIdx: number; stepIdx?: number } | null>(null);
  const [dragOverItem, setDragOverItem] = useState<{ type: 'objective' | 'step'; phaseIdx: number; objIdx: number; stepIdx?: number } | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [showAiDialog, setShowAiDialog] = useState(false);
  const [aiMode, setAiMode] = useState<'create' | 'edit'>('create');
  const [aiChangelog, setAiChangelog] = useState<Array<{ action: string; location: string; detail: string }> | null>(null);

  // Reset viewMode when sheet opens based on props
  useEffect(() => {
    if (!open) {
      // Reset on close
      resetForm();
      return;
    }

    fetchBoards();
    fetchTemplates();
  }, [open]);

  // Handle initialEditBoardId or initialCreateNew after boards load
  useEffect(() => {
    if (!open || boards.length === 0) return;

    if (initialEditBoardId) {
      const board = boards.find(b => b.id === initialEditBoardId);
      if (board && viewMode === 'list') {
        handleEditWorkflow(board);
      }
    } else if (initialCreateNew && viewMode === 'list') {
      handleNewWorkflow();
    }
  }, [open, initialEditBoardId, initialCreateNew, boards.length]);

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

  const handleGenerateWithAI = async () => {
    if (!aiPrompt.trim()) return;
    setGenerating(true);
    setAiChangelog(null);
    try {
      if (aiMode === 'edit' && phases.length > 0) {
        // Edit mode: send current workflow to AI for modification
        const currentWorkflow = {
          name: formName,
          description: formDescription,
          phases: phases.map(p => ({
            stageId: p.stageId,
            stageName: p.stageName,
            stageColor: p.stageColor,
            objectives: p.objectives.map(o => ({
              templateId: o.templateId,
              name: o.name,
              description: o.description,
              is_mandatory: o.is_mandatory,
              steps: o.items.map(s => ({
                id: s.id,
                label: s.label,
                description: s.description,
                script: s.script,
                activityType: s.activityType,
                nextStageId: s.nextStageId,
                docChecklist: s.docChecklist,
              })),
            })),
          })),
        };

        const { data, error } = await cloudFunctions.invoke('edit-workflow', {
          body: {
            description: aiPrompt,
            currentWorkflow,
            activityTypes: activityTypes.map(t => t.label),
          },
        });

        if (error) throw error;
        if (data.error) throw new Error(data.error);

        const editedPhases: PhaseConfig[] = (data.phases || []).map((phase: any) => ({
          stageId: phase.stageId,
          stageName: phase.stageName,
          stageColor: phase.stageColor || '#3b82f6',
          objectives: (phase.objectives || []).map((obj: any) => ({
            templateId: obj.templateId || undefined,
            name: obj.name,
            description: obj.description || '',
            is_mandatory: obj.is_mandatory || false,
            items: (obj.steps || []).map((step: any) => ({
              id: step.id || crypto.randomUUID(),
              label: step.label,
              description: step.description || undefined,
              script: step.script || undefined,
              activityType: step.activityType || undefined,
              nextStageId: step.nextStageId || undefined,
              docChecklist: step.docChecklist?.length
                ? step.docChecklist.map((d: any) => ({ id: d.id || crypto.randomUUID(), label: d.label, type: d.type || 'documentos', nextStageId: d.nextStageId }))
                : undefined,
            })),
            isExpanded: true,
          })),
          isExpanded: true,
        }));

        setPhases(editedPhases);
        setAiChangelog(data.changelog || []);
        setShowAiDialog(false);
        setAiPrompt('');
        toast.success(`Fluxo editado! ${(data.changelog || []).length} alteração(ões) aplicada(s)`);
      } else {
        // Create mode
        const { data, error } = await cloudFunctions.invoke('generate-workflow', {
          body: {
            description: aiPrompt,
            activityTypes: activityTypes.map(t => t.label),
          },
        });

        if (error) throw error;
        if (data.error) throw new Error(data.error);

        setFormName(data.name || '');
        setFormDescription(data.description || '');

        const generatedPhases: PhaseConfig[] = (data.phases || []).map((phase: any) => ({
          stageId: phase.name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          stageName: phase.name,
          stageColor: phase.color || '#3b82f6',
          objectives: (phase.objectives || []).map((obj: any) => ({
            name: obj.name,
            description: obj.description || '',
            is_mandatory: obj.is_mandatory || false,
            items: (obj.steps || []).map((step: any) => ({
              id: crypto.randomUUID(),
              label: step.label,
              description: step.description || undefined,
              script: step.script || undefined,
              activityType: step.activityType || undefined,
              docChecklist: step.docChecklist?.length
                ? step.docChecklist.map((d: any) => ({ id: crypto.randomUUID(), label: d.label, type: d.type || 'documentos' }))
                : undefined,
            })),
            isExpanded: true,
          })),
          isExpanded: true,
        }));

        setPhases(generatedPhases);
        setShowAiDialog(false);
        setAiPrompt('');
        toast.success(`Fluxo "${data.name}" gerado com ${generatedPhases.length} fases!`);
      }
    } catch (error: any) {
      console.error('Error with AI workflow:', error);
      toast.error(error.message || 'Erro ao processar com IA');
    } finally {
      setGenerating(false);
    }
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

  const handleDeleteWorkflow = (board: KanbanBoard) => {
    confirmDelete(
      `Excluir ${typeLabel}`,
      `Excluir o ${typeLabelLower} "${board.name}"? Leads serão desvinculados. Esta ação não pode ser desfeita.`,
      async () => { await deleteBoard(board.id); fetchBoards(); }
    );
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

  const updateStepScript = (phaseIdx: number, objIdx: number, stepId: string, script: string) => {
    updateObjective(phaseIdx, objIdx, {
      items: phases[phaseIdx].objectives[objIdx].items.map(s => s.id === stepId ? { ...s, script: script || undefined } : s),
    });
  };

  const updateStepNextStage = (phaseIdx: number, objIdx: number, stepId: string, nextStageId: string) => {
    updateObjective(phaseIdx, objIdx, {
      items: phases[phaseIdx].objectives[objIdx].items.map(s => s.id === stepId ? { ...s, nextStageId: nextStageId || undefined } : s),
    });
  };

  const updateStepDocChecklist = (phaseIdx: number, objIdx: number, stepId: string, docChecklist: DocChecklistItem[]) => {
    updateObjective(phaseIdx, objIdx, {
      items: phases[phaseIdx].objectives[objIdx].items.map(s => s.id === stepId ? { ...s, docChecklist: docChecklist.length > 0 ? docChecklist : undefined } : s),
    });
  };

  // Drag-and-drop handlers
  const handleDragStart = (type: 'objective' | 'step', phaseIdx: number, objIdx: number, stepIdx?: number) => {
    setDragItem({ type, phaseIdx, objIdx, stepIdx });
  };

  const handleDragOver = (e: React.DragEvent, type: 'objective' | 'step', phaseIdx: number, objIdx: number, stepIdx?: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverItem({ type, phaseIdx, objIdx, stepIdx });
  };

  const handleDragEnd = () => {
    if (!dragItem || !dragOverItem) {
      setDragItem(null);
      setDragOverItem(null);
      return;
    }

    if (dragItem.type === 'objective' && dragOverItem.type === 'objective') {
      // Move objective within same phase or between phases
      setPhases(prev => {
        const next = prev.map(p => ({ ...p, objectives: [...p.objectives] }));
        const [moved] = next[dragItem.phaseIdx].objectives.splice(dragItem.objIdx, 1);
        next[dragOverItem.phaseIdx].objectives.splice(dragOverItem.objIdx, 0, moved);
        return next;
      });
    } else if (dragItem.type === 'step' && dragOverItem.type === 'step' && dragItem.stepIdx !== undefined && dragOverItem.stepIdx !== undefined) {
      // Move step within same objective or between objectives
      setPhases(prev => {
        const next = prev.map(p => ({
          ...p,
          objectives: p.objectives.map(o => ({ ...o, items: [...o.items] })),
        }));
        const [moved] = next[dragItem.phaseIdx].objectives[dragItem.objIdx].items.splice(dragItem.stepIdx!, 1);
        next[dragOverItem.phaseIdx].objectives[dragOverItem.objIdx].items.splice(dragOverItem.stepIdx!, 0, moved);
        return next;
      });
    }

    setDragItem(null);
    setDragOverItem(null);
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
          board_type: boardType,
        } as any);
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

      // Notify users working with this workflow about the change
      if (editingBoardId) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.rpc('notify_workflow_change', {
            p_board_id: boardId,
            p_board_name: formName.trim(),
            p_changed_by: user.id,
            p_change_description: `O fluxo de trabalho "${formName.trim()}" foi atualizado. Verifique as alterações nos passos e checklists.`,
          });
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
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-xl w-full flex flex-col p-0">
        <SheetHeader className="px-6 py-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Workflow className="h-5 w-5" />
            {viewMode === 'list' ? (isFunnel ? 'Funis de Vendas' : 'Fluxos de Trabalho') : (editingBoardId ? `Editar ${typeLabelLower}` : `Novo ${typeLabelLower}`)}
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
            <div className="flex gap-2">
              <Button className="flex-1" variant="outline" onClick={handleNewWorkflow}>
                <Plus className="h-4 w-4 mr-2" />
                Novo Fluxo
              </Button>
              <Button className="flex-1" variant="default" onClick={() => { resetForm(); setViewMode('edit'); setAiMode('create'); setShowAiDialog(true); }}>
                <Sparkles className="h-4 w-4 mr-2" />
                Gerar com IA
              </Button>
            </div>
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

              {/* AI Generate/Edit Button */}
              <Button variant="outline" className="w-full border-dashed" onClick={() => {
                setAiMode(editingBoardId ? 'edit' : 'create');
                setAiChangelog(null);
                setShowAiDialog(true);
              }}>
                <Sparkles className="h-4 w-4 mr-2" />
                {editingBoardId ? 'Editar com IA' : 'Preencher com IA a partir de uma descrição'}
              </Button>

              {/* AI Changelog */}
              {aiChangelog && aiChangelog.length > 0 && (
                <Card className="border-primary/30 bg-primary/5">
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-primary flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5" />
                        Alterações da IA ({aiChangelog.length})
                      </span>
                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setAiChangelog(null)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="space-y-1.5">
                      {aiChangelog.map((change, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs">
                          <Badge variant={change.action === 'added' ? 'default' : change.action === 'removed' ? 'destructive' : 'secondary'} className="text-[9px] px-1.5 py-0 flex-shrink-0 mt-0.5">
                            {change.action === 'added' ? '+ Novo' : change.action === 'removed' ? '- Removido' : '✎ Editado'}
                          </Badge>
                          <div className="min-w-0">
                            <p className="font-medium text-foreground">{change.location}</p>
                            <p className="text-muted-foreground">{change.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Phases → Objectives → Steps */}
              <div className="space-y-3">
                {phases.map((phase, phaseIdx) => (
                   <div key={phase.stageId} className="border rounded-lg overflow-hidden">
                     {/* Phase header */}
                     <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-l-4 border-muted-foreground/30">
                       <GripVertical className="h-4 w-4 text-muted-foreground/50 flex-shrink-0" />
                       <Collapsible open={phase.isExpanded} onOpenChange={() => togglePhase(phaseIdx)} className="flex-1 min-w-0">
                         <CollapsibleTrigger className="flex items-center gap-2 w-full text-left min-w-0">
                            {phase.isExpanded ? <ChevronDown className="h-4 w-4 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 flex-shrink-0" />}
                            <span className="flex-shrink-0 h-5 w-5 rounded-full bg-muted-foreground/20 text-muted-foreground text-[10px] font-bold flex items-center justify-center">
                              {phaseIdx + 1}
                            </span>
                            {phase.isExpanded ? (
                              <Input
                                value={phase.stageName}
                                onChange={e => updatePhaseName(phaseIdx, e.target.value)}
                                onClick={e => e.stopPropagation()}
                                placeholder="Nome da fase..."
                                className="h-7 text-sm font-semibold text-foreground flex-1"
                              />
                            ) : (
                              <span className="font-semibold text-sm text-foreground truncate">{phase.stageName}</span>
                            )}
                         </CollapsibleTrigger>
                       </Collapsible>
                       <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                         {phase.objectives.length} obj.
                       </span>
                       <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" title="Adicionar objetivo" onClick={() => addObjective(phaseIdx)}>
                         <Plus className="h-3.5 w-3.5" />
                       </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive/80 hover:text-destructive flex-shrink-0" onClick={() => removePhase(phaseIdx)}>
                          <X className="h-3.5 w-3.5" />
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
                           <div
                             key={objIdx}
                             className={cn(
                               "border-t first:border-t-0 transition-all",
                               dragOverItem?.type === 'objective' && dragOverItem.phaseIdx === phaseIdx && dragOverItem.objIdx === objIdx && "border-t-2 border-t-blue-400"
                             )}
                             draggable
                             onDragStart={() => handleDragStart('objective', phaseIdx, objIdx)}
                             onDragOver={(e) => handleDragOver(e, 'objective', phaseIdx, objIdx)}
                             onDragEnd={handleDragEnd}
                           >
                             {/* Objective header */}
                             <div className="flex items-center gap-2 px-4 py-2 ml-4 border-l-2 border-blue-400/40">
                                <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 cursor-grab flex-shrink-0" />
                                <Collapsible open={obj.isExpanded} onOpenChange={() => toggleObjective(phaseIdx, objIdx)} className="flex-1 min-w-0">
                                  <CollapsibleTrigger className="flex items-center gap-2 w-full text-left min-w-0">
                                    {obj.isExpanded ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />}
                                    <span className="flex-shrink-0 h-5 w-5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-[10px] font-bold flex items-center justify-center">
                                      {objIdx + 1}
                                    </span>
                                    {obj.isExpanded ? (
                                      <Input
                                        value={obj.name}
                                        onChange={e => updateObjective(phaseIdx, objIdx, { name: e.target.value })}
                                        onClick={e => e.stopPropagation()}
                                        placeholder="Nome do objetivo..."
                                        className="h-7 text-sm font-medium flex-1"
                                      />
                                    ) : (
                                      <span className="font-medium text-sm truncate">{obj.name}</span>
                                    )}
                                 </CollapsibleTrigger>
                               </Collapsible>
                               <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                                 {obj.items.length} passo(s)
                               </span>
                                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive/80 hover:text-destructive flex-shrink-0" onClick={() => removeObjective(phaseIdx, objIdx)}>
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                             </div>

                            {/* Objective content */}
                            {obj.isExpanded && (
                              <div className="ml-4 border-l-2 border-blue-400/30 px-4 pb-4 pt-2 space-y-3">
                                {/* Objective description field */}
                                <div>
                                  <Label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Descrição do objetivo</Label>
                                  <Textarea
                                    value={obj.description}
                                    onChange={e => updateObjective(phaseIdx, objIdx, { description: e.target.value })}
                                    placeholder="Descreva o objetivo desta fase do funil..."
                                    className="mt-1 min-h-[52px] text-xs resize-none"
                                  />
                                </div>

                                {/* Steps */}
                                <div>
                                  <Label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Passos</Label>
                                  <div className="mt-1.5 space-y-2">
                                    {obj.items.length === 0 ? (
                                      <p className="text-[11px] text-muted-foreground italic py-1">Nenhum passo adicionado</p>
                                    ) : (
                                      obj.items.map((step, stepIdx) => (
                                        <div
                                          key={step.id}
                                          className={cn(
                                            "border border-green-200 dark:border-green-900/40 rounded-md bg-green-50/30 dark:bg-green-950/10 p-2.5 space-y-2 transition-all",
                                            dragOverItem?.type === 'step' && dragOverItem.phaseIdx === phaseIdx && dragOverItem.objIdx === objIdx && dragOverItem.stepIdx === stepIdx && "ring-2 ring-green-400"
                                          )}
                                          draggable
                                          onDragStart={(e) => { e.stopPropagation(); handleDragStart('step', phaseIdx, objIdx, stepIdx); }}
                                          onDragOver={(e) => { e.stopPropagation(); handleDragOver(e, 'step', phaseIdx, objIdx, stepIdx); }}
                                          onDragEnd={handleDragEnd}
                                        >
                                          {/* Step header: number + delete */}
                                          <div className="flex items-center gap-2">
                                            <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 cursor-grab flex-shrink-0" />
                                            <span className="flex-shrink-0 h-5 w-5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-[10px] font-bold flex items-center justify-center">
                                              {stepIdx + 1}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                              <Input
                                                value={step.label}
                                                onChange={e => updateStepLabel(phaseIdx, objIdx, step.id, e.target.value)}
                                                placeholder="Nome do passo..."
                                                className="h-7 text-sm font-medium"
                                              />
                                            </div>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className={cn("h-6 w-6 flex-shrink-0", step.script ? "text-primary" : "text-muted-foreground")}
                                              title={step.script ? "Editar script de contato" : "Adicionar script de contato"}
                                              onClick={() => setScriptDialog({ phaseIdx, objIdx, stepId: step.id, script: step.script || '' })}
                                            >
                                              <MessageSquareText className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className={cn("h-6 w-6 flex-shrink-0", step.docChecklist?.length ? "text-orange-500" : "text-muted-foreground")}
                                              title={step.docChecklist?.length ? `Checklist (${step.docChecklist.length})` : "Adicionar checklist"}
                                              onClick={() => {
                                                const existingType = step.docChecklist?.[0]?.type || 'documentos';
                                                setDocChecklistDialog({ phaseIdx, objIdx, stepId: step.id, items: step.docChecklist ? [...step.docChecklist] : [], checklistType: existingType });
                                              }}
                                            >
                                              <ClipboardList className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive/80 hover:text-destructive flex-shrink-0" onClick={() => removeStep(phaseIdx, objIdx, step.id)}>
                                              <X className="h-3.5 w-3.5" />
                                            </Button>
                                          </div>

                                          {/* Tipo de atividade */}
                                          <div className="flex items-center gap-2">
                                            <Label className="text-[10px] text-muted-foreground whitespace-nowrap w-20 flex-shrink-0">Tipo de atv.:</Label>
                                            <Select
                                              value={step.activityType || '__none__'}
                                              onValueChange={v => updateStepActivityType(phaseIdx, objIdx, step.id, v === '__none__' ? '' : v)}
                                            >
                                              <SelectTrigger className="h-7 text-xs flex-1">
                                                <SelectValue placeholder="Nenhum" />
                                              </SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="__none__">
                                                  <span className="text-muted-foreground">Nenhum</span>
                                                </SelectItem>
                                                {activityTypes.filter(t => t.is_active).map(t => (
                                                  <SelectItem key={t.id} value={t.key}>
                                                    <div className="flex items-center gap-1.5">
                                                      <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                                                      {t.label}
                                                    </div>
                                                  </SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                          </div>

                                          {/* Descrição do passo - minimal icon */}
                                          <div className="flex items-start gap-1.5">
                                            <button
                                              className={cn(
                                                "flex items-center gap-1 text-[10px] rounded px-1 py-0.5 transition-colors",
                                                step.description
                                                  ? "text-muted-foreground hover:text-foreground"
                                                  : "text-muted-foreground/40 hover:text-muted-foreground"
                                              )}
                                              title={step.description || 'Adicionar descrição'}
                                              onClick={() => setDescDialog({ phaseIdx, objIdx, stepId: step.id, description: step.description || '' })}
                                            >
                                              <Info className="h-3 w-3 flex-shrink-0" />
                                              {step.description && (
                                                <span className="line-clamp-1 max-w-[200px] text-left">{step.description}</span>
                                              )}
                                            </button>
                                            {step.description && (
                                              <button
                                                className="text-muted-foreground/60 hover:text-foreground p-0.5"
                                                onClick={() => setDescDialog({ phaseIdx, objIdx, stepId: step.id, description: step.description || '' })}
                                              >
                                                <Edit3 className="h-3 w-3" />
                                              </button>
                                            )}
                                          </div>

                                          {/* Ramificação condicional - mover para fase */}
                                          <div className="flex items-center gap-2">
                                            <Label className="text-[10px] text-muted-foreground whitespace-nowrap w-20 flex-shrink-0">Mover para:</Label>
                                            <Select
                                              value={step.nextStageId || '__none__'}
                                              onValueChange={v => updateStepNextStage(phaseIdx, objIdx, step.id, v === '__none__' ? '' : v)}
                                            >
                                              <SelectTrigger className="h-7 text-xs flex-1">
                                                <SelectValue placeholder="Não mover" />
                                              </SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="__none__">
                                                  <span className="text-muted-foreground">Não mover</span>
                                                </SelectItem>
                                                <SelectItem value="__finalize__">
                                                  <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 font-medium">
                                                    <span className="h-2.5 w-2.5 rounded-full flex-shrink-0 bg-green-500" />
                                                    ✅ Finalizar
                                                  </div>
                                                </SelectItem>
                                                {phases.filter((_, pi) => pi !== phaseIdx).map(p => (
                                                  <SelectItem key={p.stageId} value={p.stageId}>
                                                    <div className="flex items-center gap-1.5">
                                                      <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.stageColor }} />
                                                      {p.stageName}
                                                    </div>
                                                  </SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                          </div>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </div>

                                {/* Add step */}
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
                <Button variant="outline" onClick={() => {
                  if (initialEditBoardId || initialCreateNew) {
                    onOpenChange(false);
                  } else {
                    resetForm();
                  }
                }}>Cancelar</Button>
                <Button onClick={handleSave} disabled={!formName.trim() || phases.length === 0 || saving}>
                  {saving ? 'Salvando...' : 'Salvar'}
                </Button>
              </div>
            </SheetFooter>
          </div>
        )}
      </SheetContent>
    </Sheet>

    {/* Script dialog */}
    <Dialog open={!!scriptDialog} onOpenChange={(open) => !open && setScriptDialog(null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquareText className="h-5 w-5" />
            Script de Contato
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Defina o roteiro que o usuário deve seguir ao fazer contato neste passo. Este script ficará disponível no WhatsApp, nas atividades e no progresso do fluxo.
          </p>
          <Textarea
            value={scriptDialog?.script || ''}
            onChange={e => setScriptDialog(prev => prev ? { ...prev, script: e.target.value } : null)}
            placeholder="Ex: Olá [nome], tudo bem? Sou [seu nome] do escritório... Estou entrando em contato porque..."
            className="min-h-[200px] text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setScriptDialog(null)}>Cancelar</Button>
            <Button size="sm" onClick={() => {
              if (scriptDialog) {
                updateStepScript(scriptDialog.phaseIdx, scriptDialog.objIdx, scriptDialog.stepId, scriptDialog.script);
                setScriptDialog(null);
                toast.success('Script salvo!');
              }
            }}>
              Salvar Script
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Description dialog */}
    <Dialog open={!!descDialog} onOpenChange={(open) => !open && setDescDialog(null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            Descrição do Passo
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            value={descDialog?.description || ''}
            onChange={e => setDescDialog(prev => prev ? { ...prev, description: e.target.value } : null)}
            placeholder="Instruções detalhadas para este passo..."
            className="min-h-[150px] text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setDescDialog(null)}>Cancelar</Button>
            <Button size="sm" onClick={() => {
              if (descDialog) {
                updateStepDescription(descDialog.phaseIdx, descDialog.objIdx, descDialog.stepId, descDialog.description);
                setDescDialog(null);
                toast.success('Descrição salva!');
              }
            }}>
              Salvar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Checklist dialog */}
    <Dialog open={!!docChecklistDialog} onOpenChange={(open) => { if (!open) { setDocChecklistDialog(null); setNewDocItem(''); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Checklist
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {/* Type selector */}
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Tipo do Checklist</Label>
            <Select
              value={docChecklistDialog?.checklistType || 'documentos'}
              onValueChange={v => setDocChecklistDialog(prev => prev ? { ...prev, checklistType: v as ChecklistType } : null)}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHECKLIST_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>
                    <span className="flex items-center gap-2">
                      <span>{t.icon}</span>
                      {t.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-muted-foreground">
            Defina os itens que precisam ser verificados neste passo. Eles aparecerão como checklist na atividade correspondente.
          </p>

          {/* Existing items */}
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
            {(docChecklistDialog?.items || []).map((item, idx) => (
              <div key={item.id} className="p-2 rounded-md border bg-muted/20 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="flex-shrink-0 h-5 w-5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 text-[10px] font-bold flex items-center justify-center">
                    {idx + 1}
                  </span>
                  <span className="text-sm flex-1">{item.label}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive/80 hover:text-destructive flex-shrink-0"
                    onClick={() => setDocChecklistDialog(prev => prev ? { ...prev, items: prev.items.filter(i => i.id !== item.id) } : null)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {/* Mover para fase */}
                <div className="flex items-center gap-2 ml-7">
                  <Label className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">Mover para:</Label>
                  <Select
                    value={item.nextStageId || '__none__'}
                    onValueChange={v => setDocChecklistDialog(prev => prev ? {
                      ...prev,
                      items: prev.items.map(i => i.id === item.id ? { ...i, nextStageId: v === '__none__' ? undefined : v } : i),
                    } : null)}
                  >
                    <SelectTrigger className="h-6 text-[10px] flex-1">
                      <SelectValue placeholder="Não mover" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        <span className="text-muted-foreground">Não mover</span>
                      </SelectItem>
                      <SelectItem value="__finalize__">
                        <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 font-medium">
                          <span className="h-2 w-2 rounded-full flex-shrink-0 bg-green-500" />
                          ✅ Finalizar
                        </div>
                      </SelectItem>
                      {phases.map(p => (
                        <SelectItem key={p.stageId} value={p.stageId}>
                          <div className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.stageColor }} />
                            {p.stageName}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
            {(docChecklistDialog?.items || []).length === 0 && (
              <p className="text-xs text-muted-foreground italic text-center py-2">Nenhum item adicionado</p>
            )}
          </div>

          {/* Add new item */}
          <div className="flex gap-2">
            <Input
              value={newDocItem}
              onChange={e => setNewDocItem(e.target.value)}
              placeholder={
                docChecklistDialog?.checklistType === 'documentos' ? 'Ex: RG, CPF, Comprovante...' :
                docChecklistDialog?.checklistType === 'perguntas' ? 'Ex: Qual a data do acidente?' :
                docChecklistDialog?.checklistType === 'requisitos' ? 'Ex: Nexo causal comprovado' :
                'Ex: Item do checklist...'
              }
              className="flex-1 text-sm"
              onKeyDown={e => {
                if (e.key === 'Enter' && newDocItem.trim()) {
                  setDocChecklistDialog(prev => prev ? {
                    ...prev,
                    items: [...prev.items, { id: crypto.randomUUID(), label: newDocItem.trim(), type: prev.checklistType }],
                  } : null);
                  setNewDocItem('');
                }
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (newDocItem.trim()) {
                  setDocChecklistDialog(prev => prev ? {
                    ...prev,
                    items: [...prev.items, { id: crypto.randomUUID(), label: newDocItem.trim(), type: prev.checklistType }],
                  } : null);
                  setNewDocItem('');
                }
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { setDocChecklistDialog(null); setNewDocItem(''); }}>Cancelar</Button>
            <Button size="sm" onClick={() => {
              if (docChecklistDialog) {
                // Apply the type to all items
                const typedItems = docChecklistDialog.items.map(item => ({ ...item, type: item.type || docChecklistDialog.checklistType }));
                updateStepDocChecklist(docChecklistDialog.phaseIdx, docChecklistDialog.objIdx, docChecklistDialog.stepId, typedItems);
                setDocChecklistDialog(null);
                setNewDocItem('');
                toast.success('Checklist salvo!');
              }
            }}>
              Salvar Checklist
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* AI Generation/Edit Dialog */}
    <Dialog open={showAiDialog} onOpenChange={setShowAiDialog}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {aiMode === 'edit' ? 'Editar Fluxo com IA' : 'Gerar Fluxo com IA'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {aiMode === 'edit'
              ? 'Descreva o que quer alterar no fluxo. A IA vai identificar onde encaixar as mudanças e informar o que foi alterado.'
              : 'Descreva o tipo de fluxo que precisa e a IA criará automaticamente as fases, objetivos, passos, scripts e checklists.'}
          </p>
          <Textarea
            value={aiPrompt}
            onChange={e => setAiPrompt(e.target.value)}
            placeholder={aiMode === 'edit'
              ? 'Ex: Adicione um passo de envio de contrato na fase de Fechamento, com checklist de documentos necessários...'
              : 'Ex: Fluxo para prospecção de clientes de acidente de trabalho, começando pelo contato inicial via WhatsApp...'}
            className="min-h-[120px]"
          />
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowAiDialog(false)} disabled={generating}>
              Cancelar
            </Button>
            <Button onClick={handleGenerateWithAI} disabled={generating || !aiPrompt.trim()}>
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {aiMode === 'edit' ? 'Editando...' : 'Gerando...'}
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  {aiMode === 'edit' ? 'Aplicar Alterações' : 'Gerar Fluxo'}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <ConfirmDeleteDialog />
    </>
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
