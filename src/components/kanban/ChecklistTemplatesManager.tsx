import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
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
  Layers,
  ChevronRight,
  ChevronDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { useChecklists, ChecklistTemplate, ChecklistItem, ChecklistStageLink } from '@/hooks/useChecklists';
import { useKanbanBoards, KanbanBoard } from '@/hooks/useKanbanBoards';
import { supabase } from '@/integrations/supabase/client';

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
    fetchStageLinks,
    linkChecklistToStage,
    unlinkChecklistFromStage,
  } = useChecklists();

  const { boards, fetchBoards } = useKanbanBoards();

  const [editingTemplate, setEditingTemplate] = useState<ChecklistTemplate | null>(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formMandatory, setFormMandatory] = useState(false);
  const [formItems, setFormItems] = useState<ChecklistItem[]>([]);
  const [newItemLabel, setNewItemLabel] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [linkedStages, setLinkedStages] = useState<Set<string>>(new Set());
  const [existingLinks, setExistingLinks] = useState<ChecklistStageLink[]>([]);
  // Track all links across all boards to show linked checklists per stage
  const [allBoardLinks, setAllBoardLinks] = useState<ChecklistStageLink[]>([]);
  // Collapsible state for boards
  const [expandedBoards, setExpandedBoards] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      fetchTemplates();
      fetchBoards();
    }
  }, [open, fetchTemplates]);

  // Load all links across all boards when entering the form
  useEffect(() => {
    if (showForm && boards.length > 0) {
      loadAllBoardLinks();
    }
  }, [showForm, boards]);

  const loadAllBoardLinks = async () => {
    const allLinks: ChecklistStageLink[] = [];
    for (const board of boards) {
      const boardLinks = await fetchStageLinks(board.id);
      allLinks.push(...boardLinks);
    }
    setAllBoardLinks(allLinks);
  };

  const resetForm = () => {
    setFormName('');
    setFormDescription('');
    setFormMandatory(false);
    setFormItems([]);
    setNewItemLabel('');
    setEditingTemplate(null);
    setShowForm(false);
    setLinkedStages(new Set());
    setExistingLinks([]);
    setExpandedBoards(new Set());
  };

  const loadLinksForTemplate = async (templateId: string) => {
    const allLinks: ChecklistStageLink[] = [];
    for (const board of boards) {
      const boardLinks = await fetchStageLinks(board.id);
      const filtered = boardLinks.filter(l => l.checklist_template_id === templateId);
      allLinks.push(...filtered);
    }
    setExistingLinks(allLinks);
    setLinkedStages(new Set(allLinks.map(l => `${l.board_id}::${l.stage_id}`)));
    // Auto-expand boards that have links
    const boardsWithLinks = new Set(allLinks.map(l => l.board_id));
    setExpandedBoards(boardsWithLinks);
  };

  const handleEdit = async (template: ChecklistTemplate) => {
    setEditingTemplate(template);
    setFormName(template.name);
    setFormDescription(template.description || '');
    setFormMandatory(template.is_mandatory);
    setFormItems([...template.items]);
    setShowForm(true);
    await loadLinksForTemplate(template.id);
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

  const handleMoveItem = (idx: number, direction: 'up' | 'down') => {
    const newItems = [...formItems];
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= newItems.length) return;
    [newItems[idx], newItems[targetIdx]] = [newItems[targetIdx], newItems[idx]];
    setFormItems(newItems);
  };

  const toggleStageLink = (boardId: string, stageId: string) => {
    const key = `${boardId}::${stageId}`;
    setLinkedStages(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleBoard = (boardId: string) => {
    setExpandedBoards(prev => {
      const next = new Set(prev);
      if (next.has(boardId)) next.delete(boardId);
      else next.add(boardId);
      return next;
    });
  };

  const handleSave = async () => {
    if (!formName.trim() || formItems.length === 0) return;

    const data = {
      name: formName.trim(),
      description: formDescription.trim() || null,
      is_mandatory: formMandatory,
      items: formItems,
    };

    let templateId: string;
    if (editingTemplate) {
      await updateTemplate(editingTemplate.id, data);
      templateId = editingTemplate.id;
    } else {
      const created = await createTemplate(data);
      templateId = created?.id;
      if (!templateId) { resetForm(); return; }
    }

    // Sync stage links
    const currentKeys = new Set(existingLinks.map(l => `${l.board_id}::${l.stage_id}`));

    for (const link of existingLinks) {
      const key = `${link.board_id}::${link.stage_id}`;
      if (!linkedStages.has(key)) {
        await unlinkChecklistFromStage(link.id);
      }
    }

    for (const key of linkedStages) {
      if (!currentKeys.has(key)) {
        const [boardId, stageId] = key.split('::');
        await linkChecklistToStage(templateId, boardId, stageId);
      }
    }

    resetForm();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remover este checklist? Instâncias em leads serão mantidas.')) return;
    await deleteTemplate(id);
  };

  // Get checklists linked to a specific stage (excluding the current template being edited)
  const getLinkedChecklistsForStage = (boardId: string, stageId: string): string[] => {
    return allBoardLinks
      .filter(l => l.board_id === boardId && l.stage_id === stageId && l.checklist_template_id !== editingTemplate?.id)
      .map(l => {
        const tmpl = templates.find(t => t.id === l.checklist_template_id);
        return tmpl?.name || 'Checklist';
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5" />
            Gerenciar Checklists
          </DialogTitle>
        </DialogHeader>

        {showForm ? (
          <div className="flex flex-col min-h-0 flex-1">
            <div className="overflow-y-auto flex-1 space-y-4 pr-1" style={{ maxHeight: 'calc(90vh - 140px)' }}>
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
                <div className="border rounded-md p-2 mt-1 space-y-1">
                  {formItems.map((item, idx) => (
                    <div key={item.id} className="flex items-center gap-1 py-1 border-b border-border/50 last:border-0">
                      <div className="flex flex-col">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-4 w-4 p-0"
                          onClick={() => handleMoveItem(idx, 'up')}
                          disabled={idx === 0}
                        >
                          <ArrowUp className="h-2.5 w-2.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-4 w-4 p-0"
                          onClick={() => handleMoveItem(idx, 'down')}
                          disabled={idx === formItems.length - 1}
                        >
                          <ArrowDown className="h-2.5 w-2.5" />
                        </Button>
                      </div>
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
                </div>

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

              {/* Stage linking section with collapsible boards */}
              {boards.length > 0 && (
                <div>
                  <Label className="flex items-center gap-2 mb-1">
                    <Layers className="h-4 w-4" />
                    Vincular às etapas do funil
                  </Label>
                  <div className="border rounded-md overflow-hidden">
                    {boards.map(board => {
                      const isExpanded = expandedBoards.has(board.id);
                      const linkedCount = board.stages.filter(s => linkedStages.has(`${board.id}::${s.id}`)).length;

                      return (
                        <Collapsible key={board.id} open={isExpanded} onOpenChange={() => toggleBoard(board.id)}>
                          <CollapsibleTrigger asChild>
                            <button className="w-full flex items-center justify-between px-3 py-2 hover:bg-accent/50 transition-colors border-b border-border/50 last:border-0">
                              <div className="flex items-center gap-2">
                                {isExpanded ? (
                                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                )}
                                <span className="text-sm font-medium">{board.name}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">{board.stages.length} etapas</span>
                                {linkedCount > 0 && (
                                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                                    {linkedCount} vinc.
                                  </Badge>
                                )}
                              </div>
                            </button>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="px-3 py-1.5 bg-muted/30 space-y-0.5">
                              {board.stages.map(stage => {
                                const key = `${board.id}::${stage.id}`;
                                const isLinked = linkedStages.has(key);
                                const otherChecklists = getLinkedChecklistsForStage(board.id, stage.id);

                                return (
                                  <div key={stage.id} className="py-1">
                                    <label className="flex items-center gap-2 cursor-pointer hover:bg-accent/50 rounded px-1.5 py-1">
                                      <Checkbox
                                        checked={isLinked}
                                        onCheckedChange={() => toggleStageLink(board.id, stage.id)}
                                      />
                                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: stage.color }} />
                                      <span className="text-sm">{stage.name}</span>
                                    </label>
                                    {otherChecklists.length > 0 && (
                                      <div className="ml-8 mt-0.5 flex flex-wrap gap-1">
                                        {otherChecklists.map((name, i) => (
                                          <Badge key={i} variant="outline" className="text-[9px] h-4 px-1.5 text-muted-foreground">
                                            <ListChecks className="h-2.5 w-2.5 mr-0.5" />
                                            {name}
                                          </Badge>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="pt-3 border-t mt-3">
              <Button variant="outline" onClick={resetForm}>Cancelar</Button>
              <Button onClick={handleSave} disabled={!formName.trim() || formItems.length === 0}>
                {editingTemplate ? 'Salvar' : 'Criar'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(90vh - 200px)' }}>
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
            </div>

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
