import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, X, Loader2, ExternalLink, HelpCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useKanbanBoards, type KanbanBoard } from '@/hooks/useKanbanBoards';
import { useChecklists, type ChecklistItem } from '@/hooks/useChecklists';
import { FINALIZE_ID, type WorkflowGraph, type WorkflowNodeRef } from '@/hooks/useWorkflowGraph';

/**
 * Painel de edição rápida de um nó selecionado no mapa. Cobre as operações
 * seguras que reaproveitam funções de save já existentes (updateStage /
 * updateTemplate). Configuração profunda (itens de checklist, respostas,
 * modelos de mensagem) permanece no editor completo (botão "Abrir editor").
 */

interface Props {
  board: KanbanBoard;
  graph: WorkflowGraph;
  selected: WorkflowNodeRef;
  onClose: () => void;
  onOpenFullEditor: () => void;
}

export function WorkflowNodeEditor({ board, graph, selected, onClose, onOpenFullEditor }: Props) {
  const queryClient = useQueryClient();
  const { updateBoard } = useKanbanBoards();
  const { updateTemplate } = useChecklists();
  const [saving, setSaving] = useState(false);

  const stage = graph.stages.find(s => s.id === selected.stageId);
  const objective = selected.templateId ? stage?.objectives.find(o => o.templateId === selected.templateId) : undefined;
  const step = selected.stepId ? objective?.steps.find(s => s.id === selected.stepId) : undefined;

  // Estado local dos campos, ressincronizado quando muda a seleção.
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [mandatory, setMandatory] = useState(false);
  const [routeTo, setRouteTo] = useState('__none__');

  useEffect(() => {
    if (selected.kind === 'stage' && stage) {
      setName(stage.name);
      setColor(stage.color);
    } else if (selected.kind === 'objective' && objective) {
      setName(objective.name);
      setDescription(objective.description || '');
      setMandatory(objective.isMandatory);
    } else if (selected.kind === 'step' && step) {
      setName(step.label);
      setDescription(step.description || '');
      setRouteTo(step.nextStageId || '__none__');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.kind, selected.stageId, selected.templateId, selected.stepId]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['workflow-graph', board.id] });

  // Reconstrói os itens do template a partir dos passos brutos (preserva campos).
  const rawItems = (): ChecklistItem[] => (objective?.steps || []).map(s => s.raw);

  const saveStage = async () => {
    if (!stage) return;
    setSaving(true);
    try {
      // Usa board.stages (prop) — independe do cache interno do hook.
      const stages = board.stages.map(s =>
        s.id === stage.id ? { ...s, name: name.trim() || stage.name, color } : s
      );
      await updateBoard(board.id, { stages }); // updateBoard já emite o toast
      await refresh();
    } catch { /* updateBoard já reporta o erro */ }
    finally { setSaving(false); }
  };

  const removeStage = async () => {
    if (!stage) return;
    if (!confirm(`Excluir a fase "${stage.name}"? Os leads nela serão desvinculados da fase.`)) return;
    setSaving(true);
    try {
      const stages = board.stages.filter(s => s.id !== stage.id);
      await updateBoard(board.id, { stages }); // updateBoard já emite o toast
      await refresh();
      onClose();
    } catch { /* updateBoard já reporta o erro */ }
    finally { setSaving(false); }
  };

  const saveObjective = async () => {
    if (!objective) return;
    setSaving(true);
    try {
      await updateTemplate(objective.templateId, {
        name: name.trim() || objective.name,
        description: description.trim() || null,
        is_mandatory: mandatory,
      }, { silent: true });
      await refresh();
      toast.success('Objetivo atualizado');
    } catch { toast.error('Erro ao salvar objetivo'); }
    finally { setSaving(false); }
  };

  const addStep = async () => {
    if (!objective) return;
    setSaving(true);
    try {
      const items = [...rawItems(), { id: crypto.randomUUID(), label: 'Novo passo' } as ChecklistItem];
      await updateTemplate(objective.templateId, { items }, { silent: true });
      await refresh();
      toast.success('Passo adicionado');
    } catch { toast.error('Erro ao adicionar passo'); }
    finally { setSaving(false); }
  };

  const saveStep = async () => {
    if (!objective || !step) return;
    setSaving(true);
    try {
      const items = rawItems().map(it =>
        it.id === step.id
          ? {
              ...it,
              label: name.trim() || it.label,
              description: description.trim() || undefined,
              // Se o passo tem respostas, o destino vem delas — não sobrescreve.
              nextStageId: step.answers?.length ? it.nextStageId : (routeTo === '__none__' ? undefined : routeTo),
            }
          : it
      );
      await updateTemplate(objective.templateId, { items }, { silent: true });
      await refresh();
      toast.success('Passo atualizado');
    } catch { toast.error('Erro ao salvar passo'); }
    finally { setSaving(false); }
  };

  const removeStep = async () => {
    if (!objective || !step) return;
    if (!confirm(`Excluir o passo "${step.label}"?`)) return;
    setSaving(true);
    try {
      const items = rawItems().filter(it => it.id !== step.id);
      await updateTemplate(objective.templateId, { items }, { silent: true });
      await refresh();
      toast.success('Passo excluído');
      onClose();
    } catch { toast.error('Erro ao excluir passo'); }
    finally { setSaving(false); }
  };

  // Opções de "mover para": outras fases + finalizar.
  const otherStages = graph.stages.filter(s => s.id !== selected.stageId);

  const invalidSelection = !stage || (selected.kind !== 'stage' && !objective) || (selected.kind === 'step' && !step);

  return (
    <div className="w-[320px] flex-shrink-0 border-l bg-background flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <span className="text-sm font-semibold">
          {selected.kind === 'stage' ? 'Editar fase' : selected.kind === 'objective' ? 'Editar objetivo' : 'Editar passo'}
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {invalidSelection ? (
          <p className="text-xs text-muted-foreground">Selecione um nó no mapa para editar.</p>
        ) : selected.kind === 'stage' ? (
          <>
            <div>
              <Label className="text-xs">Nome da fase</Label>
              <Input value={name} onChange={e => setName(e.target.value)} className="mt-1 h-8" />
            </div>
            <div>
              <Label className="text-xs">Cor</Label>
              <input type="color" value={color} onChange={e => setColor(e.target.value)} className="mt-1 h-8 w-16 rounded border bg-transparent cursor-pointer" />
            </div>
            <Button size="sm" className="w-full" onClick={saveStage} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null} Salvar fase
            </Button>
            <Button size="sm" variant="ghost" className="w-full text-destructive hover:text-destructive" onClick={removeStage} disabled={saving}>
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Excluir fase
            </Button>
          </>
        ) : selected.kind === 'objective' ? (
          <>
            <div>
              <Label className="text-xs">Nome do objetivo</Label>
              <Input value={name} onChange={e => setName(e.target.value)} className="mt-1 h-8" />
            </div>
            <div>
              <Label className="text-xs">Descrição</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} className="mt-1 min-h-[60px] text-xs" />
            </div>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox checked={mandatory} onCheckedChange={v => setMandatory(!!v)} />
              Objetivo obrigatório
            </label>
            <Button size="sm" className="w-full" onClick={saveObjective} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null} Salvar objetivo
            </Button>
            <Button size="sm" variant="outline" className="w-full" onClick={addStep} disabled={saving}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Adicionar passo
            </Button>
          </>
        ) : (
          <>
            <div>
              <Label className="text-xs">Nome do passo</Label>
              <Input value={name} onChange={e => setName(e.target.value)} className="mt-1 h-8" />
            </div>
            <div>
              <Label className="text-xs">Descrição</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} className="mt-1 min-h-[52px] text-xs" />
            </div>
            <div>
              <Label className="text-xs">Ao concluir, mover para</Label>
              {step?.answers?.length ? (
                <p className="mt-1 text-[11px] text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                  <HelpCircle className="h-3 w-3" />
                  Definido pelas respostas ({step.answers.length}) — edite no editor completo.
                </p>
              ) : (
                <Select value={routeTo} onValueChange={setRouteTo}>
                  <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Não mover</SelectItem>
                    <SelectItem value={FINALIZE_ID}>✅ Finalizar</SelectItem>
                    {otherStages.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <Button size="sm" className="w-full" onClick={saveStep} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null} Salvar passo
            </Button>
            <Button size="sm" variant="ghost" className="w-full text-destructive hover:text-destructive" onClick={removeStep} disabled={saving}>
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Excluir passo
            </Button>
          </>
        )}
      </div>

      <div className="px-4 py-3 border-t">
        <Button variant="outline" size="sm" className="w-full text-xs" onClick={onOpenFullEditor}>
          <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
          Abrir editor completo
        </Button>
        <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
          Checklists e respostas são editados lá.
        </p>
      </div>
    </div>
  );
}
