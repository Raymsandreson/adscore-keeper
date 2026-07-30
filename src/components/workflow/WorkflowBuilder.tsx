import { useState, useEffect, useRef, useMemo, type KeyboardEvent, type CSSProperties, type ReactNode } from 'react';
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
  PenLine,
  ChevronUp,
  HelpCircle,
  Search,
  FolderInput,
  MessagesSquare,
  History,
} from 'lucide-react';
import {
  buildWorkflowSnapshot,
  diffSnapshots,
  formatDiffLines,
  formatNotificationSummary,
  fetchLatestWorkflowRevision,
  createWorkflowRevision,
  notifyWorkflowRevision,
  REVISION_CATEGORY_LABEL,
  type RevisionCategory,
  type WorkflowSnapshot,
  type DiffEntry,
  type WorkflowRevisionRow,
} from '@/lib/workflowRevisions';
import { WorkflowHistorySheet } from '@/components/workflow/WorkflowHistorySheet';
import { PROCESS_NAME_TOKENS, renderProcessTitle, PROCESS_NAME_PREVIEW_CONTEXT } from '@/lib/processNameTemplate';
import { TeamChatSheet } from '@/components/chat/TeamChatSheet';
import { useKanbanBoards, KanbanBoard, KanbanStage } from '@/hooks/useKanbanBoards';
import { useChecklists, ChecklistItem, DocChecklistItem, CHECKLIST_TYPES, ChecklistType, ACTIVITY_MESSAGE_FIELDS, TemplateVariation, StepAnswerOption, normalizeMessageTemplates, serializeMessageTemplates } from '@/hooks/useChecklists';
import { TEMPLATE_VARIABLES } from '@/hooks/useActivityMessageTemplates';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useActivityTypes } from '@/hooks/useActivityTypes';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Wrapper de drag-and-drop sortable com suporte a mouse E toque (celular).
// Usa render-prop para não reestruturar o JSX aninhado existente: injeta
// `setNodeRef`/`style` na raiz do item e `attributes`/`listeners` na alça (GripVertical).
function Sortable({
  id,
  data,
  children,
}: {
  id: string;
  data?: Record<string, unknown>;
  children: (args: {
    setNodeRef: (el: HTMLElement | null) => void;
    style: CSSProperties;
    attributes: any;
    listeners: any;
    isDragging: boolean;
  }) => ReactNode;
}) {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({ id, data });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    position: isDragging ? 'relative' : undefined,
  };
  return <>{children({ setNodeRef, style, attributes, listeners, isDragging })}</>;
}

// Área "solta" de um objetivo: torna o objetivo inteiro um alvo de drop de
// passos, inclusive quando está vazio ou ao soltar no espaço em branco da lista.
function StepZone({ phaseIdx, objIdx, className, children }: {
  phaseIdx: number;
  objIdx: number;
  className?: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `stepzone-${phaseIdx}-${objIdx}`,
    data: { type: 'step', phaseIdx, objIdx, container: true },
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(className, isOver && 'rounded-md ring-1 ring-green-400/70 bg-green-50/40 dark:bg-green-950/20')}
    >
      {children}
    </div>
  );
}

// Detecção de colisão que só considera alvos do MESMO tipo do item arrastado
// (fase↔fase, objetivo↔objetivo, passo↔passo/zona-de-passo). Permite que os
// três níveis convivam num único DndContext sem um interferir no outro.
function typeAwareCollision(args: Parameters<typeof closestCenter>[0]) {
  const activeType = (args.active?.data?.current as { type?: string } | undefined)?.type;
  if (!activeType) return closestCenter(args);
  const containers = args.droppableContainers.filter(
    c => (c.data?.current as { type?: string } | undefined)?.type === activeType
  );
  return closestCenter({ ...args, droppableContainers: containers });
}

interface WorkflowBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onWorkflowSaved?: () => void;
  initialEditBoardId?: string | null;
  initialCreateNew?: boolean;
  boardType?: 'workflow' | 'funnel';
  // Deep-link de menção do chat de passo: ao abrir editando um board, rola até
  // este passo, destaca-o e (se pedido) abre o chat da equipe já no passo.
  initialOpenStepId?: string | null;
  initialOpenStepChat?: boolean;
  initialHighlightMsgId?: string | null;
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

export function WorkflowBuilder({ open, onOpenChange, onWorkflowSaved, initialEditBoardId, initialCreateNew, boardType = 'workflow', initialOpenStepId, initialOpenStepChat, initialHighlightMsgId }: WorkflowBuilderProps) {
  const { boards: allBoards, fetchBoards, createBoard, updateBoard, deleteBoard } = useKanbanBoards();
  const boards = allBoards.filter(b => b.board_type === boardType);
  const isFunnel = boardType === 'funnel';
  const typeLabel = isFunnel ? 'Funil de Vendas' : 'POP';
  const typeLabelLower = isFunnel ? 'funil' : 'POP';
  const { confirmDelete, ConfirmDeleteDialog } = useConfirmDelete();
  const {
    templates,
    fetchTemplates,
    createTemplate,
    updateTemplate,
    fetchStageLinks,
    linkChecklistToStage,
    unlinkChecklistFromStage,
    updateStageLinkOrder,
  } = useChecklists();
  const { types: activityTypes } = useActivityTypes();

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [editingBoardId, setEditingBoardId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [phases, setPhases] = useState<PhaseConfig[]>([]);
  // Resultados possíveis do POP (cadastráveis, tipo status — NÃO são as fases) +
  // qual é o ESPERADO (= sucesso / objetivo final). Guardado em
  // kanban_boards.settings.{resultados, resultado_esperado_id}.
  const [formResultados, setFormResultados] = useState<{ id: string; label: string; marco?: string | null }[]>([]);
  // Status esperado(s) do POP — podem ser MAIS DE UM (ex.: "Acordo" ou "Procedência"
  // ambos contam como sucesso). Guardado em settings.resultado_esperado_ids (array);
  // settings.resultado_esperado_id segue gravado (= primeiro) por compat do ranking.
  const [formResultadoEsperadoIds, setFormResultadoEsperadoIds] = useState<string[]>([]);
  const [newResultadoLabel, setNewResultadoLabel] = useState<string>('');
  // Template do nome do PROCESSO — só POP (não funil). Guardado em
  // kanban_boards.settings.process_name_template. Ver src/lib/processNameTemplate.ts.
  const [formProcessNameTemplate, setFormProcessNameTemplate] = useState<string>('');
  const processTemplateRef = useRef<HTMLTextAreaElement>(null);
  const [newPhaseName, setNewPhaseName] = useState('');
  const [saving, setSaving] = useState(false);
  const [scriptDialog, setScriptDialog] = useState<{ phaseIdx: number; objIdx: number; stepId: string; script: string } | null>(null);
  const [descDialog, setDescDialog] = useState<{ phaseIdx: number; objIdx: number; stepId: string; description: string } | null>(null);
  const [docChecklistDialog, setDocChecklistDialog] = useState<{ phaseIdx: number; objIdx: number; stepId: string; items: DocChecklistItem[]; checklistType: ChecklistType } | null>(null);
  const [msgTemplatesDialog, setMsgTemplatesDialog] = useState<{ phaseIdx: number; objIdx: number; stepId: string; templates: Record<string, TemplateVariation[]>; activeTab: string } | null>(null);
  const [answersDialog, setAnswersDialog] = useState<{ phaseIdx: number; objIdx: number; stepId: string; answers: StepAnswerOption[] } | null>(null);
  // Chat interno da equipe sobre um passo específico do POP. Reusa o mesmo
  // motor de chat das entidades (team_chat_messages no Externo), escopado por
  // entity_type='pop_step' + entity_id=step.id (id estável entre saves).
  const [stepChat, setStepChat] = useState<{ stepId: string; label: string; highlightMsgId?: string | null } | null>(null);
  // Guarda o passo-alvo do deep-link até as fases carregarem (evita rolar
  // antes do board estar montado). Consumido uma única vez.
  const pendingDeepLinkRef = useRef<{ stepId: string; openChat: boolean; msgId?: string | null } | null>(null);
  const [newAnswerLabel, setNewAnswerLabel] = useState('');
  const [newDocItem, setNewDocItem] = useState('');
  // Sensores de drag-and-drop: MouseSensor p/ desktop (só arrasta após mover 6px,
  // pra não conflitar com clique nos botões da alça) e TouchSensor p/ celular
  // (segurar ~200ms na alça inicia o arraste; toque curto continua rolando a lista).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [aiPrompt, setAiPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [showAiDialog, setShowAiDialog] = useState(false);
  const [aiMode, setAiMode] = useState<'create' | 'edit'>('create');
  const [aiChangelog, setAiChangelog] = useState<Array<{ action: string; location: string; detail: string }> | null>(null);
  // ─── Revisões (histórico estilo "lei consolidada") ───
  // baseline = última revisão registrada; o diff do save é sempre contra ela.
  const baselineRevisionRef = useRef<{ number: number; snapshot: WorkflowSnapshot } | null>(null);
  // Motivo pendente vindo da edição por IA (o prompt digitado) ou de restauração.
  const pendingAiReasonRef = useRef<string | null>(null);
  const pendingOriginRef = useRef<'ia' | 'restore' | null>(null);
  // Snapshot rico do último persist (com os templateIds já atribuídos no save).
  const lastRichSnapshotRef = useRef<WorkflowSnapshot | null>(null);
  const [motivoDialog, setMotivoDialog] = useState<{ entries: DiffEntry[]; motivo: string; categoria: RevisionCategory | null } | null>(null);
  const [suggestingMotivo, setSuggestingMotivo] = useState(false);
  const [savingRevision, setSavingRevision] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // Busca por texto dentro do POP em edição (fases, objetivos, passos, scripts, checklists).
  const [searchQuery, setSearchQuery] = useState('');

  const stopSpacePropagation = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === ' ' || e.code === 'Space') e.stopPropagation();
  };

  // Reset viewMode when sheet opens based on props
  useEffect(() => {
    if (!open) {
      // Registra revisão pendente antes de descartar o estado (o autosave já
      // persistiu as mudanças no banco; aqui garantimos o rastro no histórico).
      captureRevisionOnClose();
      // Reset on close
      resetForm();
      pendingDeepLinkRef.current = null;
      return;
    }

    // Deep-link de menção: arma o alvo pra ser consumido quando as fases
    // do board carregarem (ver effect abaixo).
    if (initialOpenStepId) {
      pendingDeepLinkRef.current = {
        stepId: initialOpenStepId,
        openChat: !!initialOpenStepChat,
        msgId: initialHighlightMsgId,
      };
    }

    fetchBoards();
    fetchTemplates();
  }, [open, initialOpenStepId, initialOpenStepChat, initialHighlightMsgId]);

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
    setFormProcessNameTemplate('');
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
          // Status do POP (moram em settings, fora de phases). Sem isso a IA não
          // enxerga os resultados e acaba criando "checklist de status" num passo.
          resultados: formResultados,
          resultado_esperado_ids: formResultadoEsperadoIds,
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
                setStatusId: s.setStatusId,
                answers: s.answers,
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

        // A IA pode devolver os passos sem campos que ela não conhece —
        // guarda os passos atuais por id pra não perder as respostas configuradas.
        const prevStepsById = new Map<string, ChecklistItem>(
          phases.flatMap(p => p.objectives.flatMap(o => o.items)).map(s => [s.id, s])
        );

        // templateId só é confiável se já existia antes da edição — a IA às
        // vezes trunca/inventa ids, e um id inválido quebra o save (uuid
        // malformado no update ou FK violada ao vincular na fase). Id
        // desconhecido vira undefined → o save cria um template novo.
        const validTemplateIds = new Set(
          phases.flatMap(p => p.objectives.map(o => o.templateId)).filter(Boolean)
        );

        const editedPhases: PhaseConfig[] = (data.phases || []).map((phase: any) => ({
          stageId: phase.stageId,
          stageName: phase.stageName,
          stageColor: phase.stageColor || '#3b82f6',
          objectives: (phase.objectives || []).map((obj: any) => ({
            templateId: validTemplateIds.has(obj.templateId) ? obj.templateId : undefined,
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
              setStatusId: step.setStatusId ?? prevStepsById.get(step.id)?.setStatusId,
              answers: step.answers?.length
                ? step.answers.map((a: Partial<StepAnswerOption>) => {
                    const prevAns = prevStepsById.get(step.id)?.answers?.find(pa => pa.id === a.id);
                    return { id: a.id || crypto.randomUUID(), label: a.label || '', nextStageId: a.nextStageId ?? prevAns?.nextStageId, setStatusId: a.setStatusId ?? prevAns?.setStatusId };
                  })
                : prevStepsById.get(step.id)?.answers,
              docChecklist: step.docChecklist?.length
                ? step.docChecklist.map((d: any) => {
                    // Mesma proteção das answers de passo: se a IA devolver o item
                    // sem os campos que não conhece, restaura do estado anterior.
                    const prevDoc = prevStepsById.get(step.id)?.docChecklist?.find(pd => pd.id === d.id);
                    return {
                      id: d.id || crypto.randomUUID(),
                      label: d.label,
                      type: d.type || 'documentos',
                      nextStageId: d.nextStageId ?? prevDoc?.nextStageId,
                      setStatusId: d.setStatusId ?? prevDoc?.setStatusId,
                      answers: d.answers?.length
                        ? d.answers.map((a: Partial<StepAnswerOption>) => {
                            const prevAns = prevDoc?.answers?.find(pa => pa.id === a.id);
                            return { id: a.id || crypto.randomUUID(), label: a.label || '', nextStageId: a.nextStageId ?? prevAns?.nextStageId, setStatusId: a.setStatusId ?? prevAns?.setStatusId };
                          })
                        : prevDoc?.answers,
                    };
                  })
                : undefined,
            })),
            isExpanded: true,
          })),
          isExpanded: true,
        }));

        setPhases(editedPhases);

        // Status do POP — a IA devolve a lista completa. Só aplica se vier array
        // (evita zerar os resultados existentes se a IA omitir o campo).
        if (Array.isArray(data.resultados)) {
          setFormResultados(
            data.resultados
              .filter((r: any) => r && r.label)
              .map((r: any) => ({
                id: r.id || crypto.randomUUID(),
                label: String(r.label),
                marco: r.marco || null,
              })),
          );
        }
        if (Array.isArray(data.resultado_esperado_ids)) {
          setFormResultadoEsperadoIds(data.resultado_esperado_ids.filter((id: any) => typeof id === 'string'));
        }

        setAiChangelog(data.changelog || []);
        // O prompt da IA vira o motivo pré-preenchido da próxima revisão —
        // é exatamente o contexto que explicaria a alteração no histórico.
        pendingAiReasonRef.current = aiPrompt.trim();
        pendingOriginRef.current = 'ia';
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
    const cfg = (board as { settings?: { resultados?: { id: string; label: string; marco?: string | null }[]; resultado_esperado_id?: string; resultado_esperado_ids?: string[]; process_name_template?: string } }).settings;
    const cfgResultados = cfg?.resultados || [];
    const cfgEspIds = Array.isArray(cfg?.resultado_esperado_ids)
      ? cfg!.resultado_esperado_ids!
      : (cfg?.resultado_esperado_id ? [cfg.resultado_esperado_id] : []);
    setFormResultados(cfgResultados);
    setFormResultadoEsperadoIds(cfgEspIds);
    setFormProcessNameTemplate(cfg?.process_name_template || '');

    // Sempre busca templates frescos junto com os links pra evitar race
    // (sem isso, se o usuário abrir Editar antes do fetchTemplates inicial
    // resolver, os objetivos vêm sem `items` e a lista de passos fica vazia).
    const [links, freshTemplates] = await Promise.all([
      fetchStageLinks(board.id),
      fetchTemplates(),
    ]);
    const tmplList = freshTemplates.length > 0 ? freshTemplates : templates;
    const phaseConfigs: PhaseConfig[] = board.stages.map(stage => {
      const stageLinks = links.filter(l => l.stage_id === stage.id);
      const objectives: PhaseObjective[] = stageLinks.map(link => {
        const tmpl = tmplList.find(t => t.id === link.checklist_template_id);
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

    // Prepara o histórico: carrega a última revisão como baseline do diff.
    // Se o board nunca teve revisão, registra a foto atual como "versão inicial"
    // (sem isso não haveria base de comparação para a primeira alteração).
    baselineRevisionRef.current = null;
    pendingAiReasonRef.current = null;
    pendingOriginRef.current = null;
    void (async () => {
      try {
        const latest = await fetchLatestWorkflowRevision(board.id);
        if (latest) {
          baselineRevisionRef.current = { number: latest.revision_number, snapshot: latest.snapshot };
        } else {
          const author = await getRevisionAuthor();
          const snap = buildWorkflowSnapshot(board.name, board.description || '', cfgResultados, cfgEspIds, phaseConfigs);
          const rev = await createWorkflowRevision({
            boardId: board.id,
            snapshot: snap,
            origin: 'baseline',
            reason: 'Versão inicial registrada automaticamente',
            changedBy: author.id,
            changedByName: author.name,
          });
          baselineRevisionRef.current = { number: rev.revision_number, snapshot: rev.snapshot };
        }
      } catch (e) {
        console.error('Erro ao preparar histórico de revisões:', e);
      }
    })();
  };

  /** Autor da revisão: usuário logado no Cloud (auth) + nome do perfil. */
  const getRevisionAuthor = async (): Promise<{ id: string | null; name: string | null }> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { id: null, name: null };
      const meta = (user.user_metadata || {}) as { full_name?: string; name?: string };
      return { id: user.id, name: meta.full_name || meta.name || user.email || null };
    } catch {
      return { id: null, name: null };
    }
  };

  /**
   * Registra revisão silenciosa ao fechar/cancelar com mudanças não registradas.
   * O autosave já gravou essas mudanças no banco — sem esta captura, elas
   * escapariam do histórico e da notificação do time.
   */
  const captureRevisionOnClose = () => {
    if (!editingBoardId || !baselineRevisionRef.current) return;
    const snap = buildWorkflowSnapshot(formName, formDescription, formResultados, formResultadoEsperadoIds, phases);
    const entries = diffSnapshots(baselineRevisionRef.current.snapshot, snap);
    if (entries.length === 0) return;

    const boardId = editingBoardId;
    const title = `Atualização no ${typeLabel}: ${snap.name}`;
    const reason = pendingAiReasonRef.current;
    const origin = pendingOriginRef.current || 'manual';
    // Atualização otimista do baseline evita captura dupla (Cancelar + close do sheet)
    baselineRevisionRef.current = { number: baselineRevisionRef.current.number + 1, snapshot: snap };
    pendingAiReasonRef.current = null;
    pendingOriginRef.current = null;

    void (async () => {
      try {
        const author = await getRevisionAuthor();
        await createWorkflowRevision({
          boardId, snapshot: snap, reason: reason || '(fechado sem motivo informado)',
          summary: entries, origin, changedBy: author.id, changedByName: author.name,
        });
        await notifyWorkflowRevision({
          boardId, title, summary: formatNotificationSummary(entries),
          reason, changedBy: author.id, changedByName: author.name,
        });
      } catch (e) {
        console.error('Erro ao registrar revisão no fechamento:', e);
      }
    })();
  };

  /** Carrega uma revisão antiga no editor (o save seguinte registra a restauração). */
  const handleRestoreRevision = (rev: WorkflowRevisionRow) => {
    const snap = rev.snapshot;
    // templateId só sobrevive se o template ainda existir — id órfão quebraria o save
    const validIds = new Set(templates.map(t => t.id));
    setFormName(snap.name);
    setFormDescription(snap.description);
    setFormResultados(snap.resultados || []);
    setFormResultadoEsperadoIds(snap.resultadoEsperadoIds || []);
    setPhases(snap.phases.map(p => ({
      stageId: p.stageId,
      stageName: p.stageName,
      stageColor: p.stageColor,
      stagnationDays: p.stagnationDays,
      isExpanded: true,
      objectives: p.objectives.map(o => ({
        templateId: o.templateId && validIds.has(o.templateId) ? o.templateId : undefined,
        name: o.name,
        description: o.description,
        is_mandatory: o.is_mandatory,
        items: o.items,
        isExpanded: false,
      })),
    })));
    pendingAiReasonRef.current = `Restaurada a partir da revisão #${rev.revision_number}`;
    pendingOriginRef.current = 'restore';
    setShowHistory(false);
    toast.success(`Revisão #${rev.revision_number} carregada no editor — salve para registrar a restauração`);
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

  const movePhase = (idx: number, dir: -1 | 1) => {
    setPhases(prev => {
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

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
    setPhases(prev => prev.map((p, pi) =>
      pi === phaseIdx
        ? { ...p, objectives: p.objectives.map((o, oi) =>
            oi === objIdx
              ? { ...o, items: [...o.items, { id: crypto.randomUUID(), label: label.trim() }] }
              : o
          ) }
        : p
    ));
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

  // Ao concluir o passo, define o STATUS do POP do lead (id em settings.resultados).
  const updateStepSetStatus = (phaseIdx: number, objIdx: number, stepId: string, setStatusId: string) => {
    updateObjective(phaseIdx, objIdx, {
      items: phases[phaseIdx].objectives[objIdx].items.map(s => s.id === stepId ? { ...s, setStatusId: setStatusId || undefined } : s),
    });
  };

  const updateStepAnswers = (phaseIdx: number, objIdx: number, stepId: string, answers: StepAnswerOption[]) => {
    updateObjective(phaseIdx, objIdx, {
      items: phases[phaseIdx].objectives[objIdx].items.map(s =>
        s.id === stepId
          // Com respostas configuradas o destino vem da resposta escolhida,
          // então o nextStageId do próprio passo é limpo pra não rotear em dobro.
          ? { ...s, answers: answers.length > 0 ? answers : undefined, nextStageId: answers.length > 0 ? undefined : s.nextStageId }
          : s
      ),
    });
  };

  const updateStepDocChecklist = (phaseIdx: number, objIdx: number, stepId: string, docChecklist: DocChecklistItem[]) => {
    updateObjective(phaseIdx, objIdx, {
      items: phases[phaseIdx].objectives[objIdx].items.map(s => s.id === stepId ? { ...s, docChecklist: docChecklist.length > 0 ? docChecklist : undefined } : s),
    });
  };

  const updateStepMessageTemplates = (phaseIdx: number, objIdx: number, stepId: string, variations: Record<string, TemplateVariation[]>) => {
    const serialized = serializeMessageTemplates(variations);
    updateObjective(phaseIdx, objIdx, {
      items: phases[phaseIdx].objectives[objIdx].items.map(s =>
        s.id === stepId ? { ...s, messageTemplates: Object.keys(serialized).length > 0 ? serialized : undefined } : s
      ),
    });
  };
  // ─────────── Drag-and-drop unificado (um único DndContext p/ os 3 níveis) ───────────
  // O tipo do item arrastado vem de active.data.current.type; a colisão é
  // filtrada por tipo (typeAwareCollision), então passo só cai em passo/zona,
  // objetivo só em objetivo, fase só em fase.

  // Move/reordena um passo — mesmo objetivo (reordena) ou objetivo/fase
  // diferente (remove da origem e insere na posição do alvo).
  const handleStepDrag = (active: DragEndEvent['active'], over: NonNullable<DragEndEvent['over']>) => {
    const a = active.data.current as { phaseIdx?: number; objIdx?: number } | undefined;
    const o = over.data.current as { type?: string; phaseIdx?: number; objIdx?: number; container?: boolean } | undefined;
    if (!a || a.phaseIdx == null || a.objIdx == null) return;
    if (!o || o.type !== 'step' || o.phaseIdx == null || o.objIdx == null) return;
    const stepId = String(active.id);
    const fromP = a.phaseIdx, fromO = a.objIdx;
    const toP = o.phaseIdx, toO = o.objIdx;
    const overStepId = o.container ? null : String(over.id);

    setPhases(prev => {
      const step = prev[fromP]?.objectives[fromO]?.items.find(s => s.id === stepId);
      if (!step) return prev;

      // Mesmo objetivo → reordena
      if (fromP === toP && fromO === toO) {
        if (!overStepId || overStepId === stepId) return prev;
        return prev.map((p, pi) => pi !== toP ? p : {
          ...p,
          objectives: p.objectives.map((ob, oi) => {
            if (oi !== toO) return ob;
            const oldIdx = ob.items.findIndex(s => s.id === stepId);
            const newIdx = ob.items.findIndex(s => s.id === overStepId);
            if (oldIdx < 0 || newIdx < 0) return ob;
            return { ...ob, items: arrayMove(ob.items, oldIdx, newIdx) };
          }),
        });
      }

      // Objetivo/fase diferente → remove da origem, insere no destino
      return prev.map((p, pi) => {
        let objectives = p.objectives;
        if (pi === fromP) {
          objectives = objectives.map((ob, oi) => oi === fromO ? { ...ob, items: ob.items.filter(s => s.id !== stepId) } : ob);
        }
        if (pi === toP) {
          objectives = objectives.map((ob, oi) => {
            if (oi !== toO) return ob;
            const items = [...ob.items];
            const at = overStepId ? items.findIndex(s => s.id === overStepId) : -1;
            items.splice(at < 0 ? items.length : at, 0, step);
            return { ...ob, items };
          });
        }
        return objectives === p.objectives ? p : { ...p, objectives };
      });
    });
  };

  const handleWorkflowDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const aType = (active.data.current as { type?: string } | undefined)?.type;

    if (aType === 'phase') {
      if (active.id === over.id) return;
      setPhases(prev => {
        const oldIndex = prev.findIndex(p => p.stageId === active.id);
        const newIndex = prev.findIndex(p => p.stageId === over.id);
        if (oldIndex < 0 || newIndex < 0) return prev;
        return arrayMove(prev, oldIndex, newIndex);
      });
      return;
    }

    if (aType === 'objective') {
      const a = active.data.current as { phaseIdx?: number; objIdx?: number } | undefined;
      const o = over.data.current as { type?: string; phaseIdx?: number; objIdx?: number } | undefined;
      if (!a || a.phaseIdx == null || a.objIdx == null) return;
      if (!o || o.type !== 'objective' || o.phaseIdx !== a.phaseIdx || o.objIdx == null) return; // só reordena na mesma fase
      if (a.objIdx === o.objIdx) return;
      setPhases(prev => prev.map((p, pi) => pi === a.phaseIdx ? { ...p, objectives: arrayMove(p.objectives, a.objIdx!, o.objIdx!) } : p));
      return;
    }

    if (aType === 'step') {
      handleStepDrag(active, over);
    }
  };

  // Mover um passo para OUTRO objetivo (mesma fase ou fase diferente).
  // Remove da origem e adiciona ao fim do objetivo de destino, preservando
  // todas as configs do passo (respostas, checklist, templates etc.).
  const moveStepToObjective = (
    fromPhaseIdx: number, fromObjIdx: number, stepId: string,
    toPhaseIdx: number, toObjIdx: number,
  ) => {
    if (fromPhaseIdx === toPhaseIdx && fromObjIdx === toObjIdx) return;
    setPhases(prev => {
      const step = prev[fromPhaseIdx]?.objectives[fromObjIdx]?.items.find(s => s.id === stepId);
      if (!step) return prev;
      return prev.map((p, pi) => {
        let objectives = p.objectives;
        // Remove da origem
        if (pi === fromPhaseIdx) {
          objectives = objectives.map((o, oi) =>
            oi === fromObjIdx ? { ...o, items: o.items.filter(s => s.id !== stepId) } : o
          );
        }
        // Adiciona ao destino (roda depois do filtro quando é a mesma fase)
        if (pi === toPhaseIdx) {
          objectives = objectives.map((o, oi) =>
            oi === toObjIdx ? { ...o, items: [...o.items, step] } : o
          );
        }
        return objectives === p.objectives ? p : { ...p, objectives };
      });
    });
    toast.success('Passo movido');
  };

  // ─────────── Autosave (debounce) ───────────
  // Sincroniza mudanças de objetivo/passo automaticamente enquanto o
  // usuário digita, para que ao clicar em "Salvar" (ou fechar o sheet)
  // nada se perca.  Só roda em modo edição de board JÁ existente — em
  // criação seria perigoso (criaria registro antes do usuário decidir).
  const autosaveTimerRef = useRef<number | null>(null);
  const lastSyncedSnapshotRef = useRef<string>('');
  const isPersistingRef = useRef(false);
  const [autosaveStatus, setAutosaveStatus] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle');
  const [autosaveError, setAutosaveError] = useState<string>('');

  const buildSnapshot = (name: string, desc: string, ph: PhaseConfig[]) =>
    JSON.stringify({
      n: name.trim(),
      d: desc.trim(),
      // Template do nome do processo entra no snapshot pra que editá-lo dispare o
      // autosave (o snapshot é a chave de comparação do effect de autosave).
      pnt: formProcessNameTemplate.trim(),
      p: ph.map(x => ({
        id: x.stageId, n: x.stageName, c: x.stageColor, sd: x.stagnationDays,
        o: x.objectives.map(o => ({
          tid: o.templateId, n: o.name, d: o.description, m: o.is_mandatory,
          i: o.items,
        })),
      })),
    });

  /**
   * Persiste o workflow no backend.  Lê o estado MAIS RECENTE via
   * callback do setter (cobre o caso do onBlur do StepAdder que
   * commita o passo no mesmo ciclo do clique em Salvar).
   *
   * - silent: não exibe toast nem fecha o form (usado pelo autosave).
   */
  const persistWorkflow = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (isPersistingRef.current) return null;
    if (!formName.trim() || phases.length === 0) return null;

    isPersistingRef.current = true;
    if (!silent) setSaving(true);
    if (silent) setAutosaveStatus('saving');

    try {
      // Flush pending setState e lê versão mais recente
      await new Promise(r => setTimeout(r, 0));
      const latestPhases: PhaseConfig[] = await new Promise(resolve => {
        setPhases(p => { resolve(p); return p; });
      });
      const latestName: string = await new Promise(resolve => {
        setFormName(n => { resolve(n); return n; });
      });
      const latestDesc: string = await new Promise(resolve => {
        setFormDescription(d => { resolve(d); return d; });
      });

      const stages: KanbanStage[] = latestPhases.map(p => ({
        id: p.stageId,
        name: p.stageName,
        color: p.stageColor,
        stagnationDays: p.stagnationDays,
      }));

      let boardId: string;
      if (editingBoardId) {
        const existingSettings = (boards.find(b => b.id === editingBoardId) as { settings?: Record<string, unknown> } | undefined)?.settings || {};
        const cleanResultados = formResultados.map(r => ({ id: r.id, label: r.label.trim(), marco: r.marco || null })).filter(r => r.label);
        const espIds = formResultadoEsperadoIds.filter(id => cleanResultados.some(r => r.id === id));
        await updateBoard(editingBoardId, {
          name: latestName.trim(),
          description: latestDesc.trim() || null,
          color: '#3b82f6',
          stages,
          // resultado_esperado_ids = fonte da verdade (múltiplos); resultado_esperado_id
          // = primeiro, mantido por compat com o ranking atual e o LeadEditDialog.
          settings: { ...existingSettings, resultados: cleanResultados, resultado_esperado_ids: espIds, resultado_esperado_id: espIds[0] || null, process_name_template: formProcessNameTemplate.trim() || null },
        } as Partial<KanbanBoard>);
        boardId = editingBoardId;
      } else {
        const created = await createBoard({
          name: latestName.trim(),
          description: latestDesc.trim() || null,
          color: '#3b82f6',
          stages,
          board_type: boardType,
        } as any);
        boardId = created.id;
      }

      const existingLinks = await fetchStageLinks(boardId);

      // Cópia rasa: os templateIds criados durante o save são atribuídos aqui
      // (sem mutar o estado), pro snapshot da revisão sair com os ids finais.
      const phasesForPersist = latestPhases.map(p => ({ ...p, objectives: p.objectives.map(o => ({ ...o })) }));

      for (const phase of phasesForPersist) {
        const phaseLinks = existingLinks.filter(l => l.stage_id === phase.stageId);
        const wantedTemplateIds = new Set<string>();

        for (let objIdx = 0; objIdx < phase.objectives.length; objIdx++) {
          const obj = phase.objectives[objIdx];
          let templateId = obj.templateId;
          const templateData = {
            name: obj.name,
            description: obj.description || null,
            is_mandatory: obj.is_mandatory,
            items: obj.items,
          };

          if (templateId) {
            await updateTemplate(templateId, templateData, { silent: true });
          } else {
            const created = await createTemplate(templateData, { silent: true });
            templateId = created?.id;
          }

          if (templateId) {
            obj.templateId = templateId;
            wantedTemplateIds.add(templateId);
            const existingLink = phaseLinks.find(l => l.checklist_template_id === templateId);
            if (!existingLink) {
              await linkChecklistToStage(templateId, boardId, phase.stageId, { silent: true, displayOrder: objIdx });
            } else if (existingLink.display_order !== objIdx) {
              await updateStageLinkOrder(existingLink.id, objIdx);
            }
          }
        }

        for (const link of phaseLinks) {
          if (!wantedTemplateIds.has(link.checklist_template_id)) {
            await unlinkChecklistFromStage(link.id, { silent: true });
          }
        }
      }

      // Snapshot rico pro histórico de revisões (a notificação do time agora
      // sai junto com a revisão — confirmRevisionSave/captureRevisionOnClose.
      // A antiga notify_workflow_change era chamada no client Cloud e gravava
      // no banco errado; substituída por notify_workflow_revision no Externo).
      lastRichSnapshotRef.current = buildWorkflowSnapshot(
        latestName, latestDesc, formResultados, formResultadoEsperadoIds, phasesForPersist,
      );

      lastSyncedSnapshotRef.current = buildSnapshot(latestName, latestDesc, latestPhases);

      if (!silent) {
        toast.success(editingBoardId ? 'Fluxo atualizado!' : 'Fluxo criado!');
        resetForm();
        fetchBoards();
        fetchTemplates();
        onWorkflowSaved?.();
      } else {
        setAutosaveStatus('saved');
        setAutosaveError('');
        // Refresh leve do cache — sem refazer a tela
        fetchTemplates();
      }

      return boardId;
    } catch (error) {
      console.error('Error saving workflow:', error);
      const msg = (error as { message?: string })?.message || '';
      if (silent) {
        setAutosaveStatus('error');
        setAutosaveError(msg);
      } else {
        toast.error(`Erro ao salvar fluxo${msg ? `: ${msg}` : ''}`);
      }
      return null;
    } finally {
      isPersistingRef.current = false;
      if (!silent) setSaving(false);
    }
  };

  // Save manual: cancela qualquer debounce pendente para evitar corrida.
  // Se houver mudanças desde a última revisão, abre o dialog de motivo antes
  // de persistir (o save real acontece em confirmRevisionSave).
  const handleSave = async () => {
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    if (editingBoardId && baselineRevisionRef.current) {
      // Mesmo flush do persistWorkflow: lê o estado MAIS RECENTE (cobre o
      // onBlur do StepAdder no mesmo ciclo do clique em Salvar).
      await new Promise(r => setTimeout(r, 0));
      const latestPhases: PhaseConfig[] = await new Promise(resolve => {
        setPhases(p => { resolve(p); return p; });
      });
      const latestName: string = await new Promise(resolve => {
        setFormName(n => { resolve(n); return n; });
      });
      const latestDesc: string = await new Promise(resolve => {
        setFormDescription(d => { resolve(d); return d; });
      });
      const snap = buildWorkflowSnapshot(latestName, latestDesc, formResultados, formResultadoEsperadoIds, latestPhases);
      const entries = diffSnapshots(baselineRevisionRef.current.snapshot, snap);
      if (entries.length > 0) {
        setMotivoDialog({ entries, motivo: pendingAiReasonRef.current || '', categoria: null });
        // IA sugere motivo+categoria em background enquanto o dialog abre;
        // só preenche o que o gerente ainda não digitou/escolheu.
        void suggestRevisionMotivo(entries, pendingAiReasonRef.current || '');
        return;
      }
    }

    await persistWorkflow({ silent: false });
  };

  /** IA lê o diff e sugere motivo + categoria (automação/eliminação/otimização). */
  const suggestRevisionMotivo = async (entries: DiffEntry[], draft: string, force = false) => {
    setSuggestingMotivo(true);
    try {
      const { data, error } = await cloudFunctions.invoke('suggest-revision-reason', {
        body: {
          typeLabel,
          boardName: formName.trim(),
          diffLines: formatDiffLines(entries),
          draft: draft.trim() || undefined,
        },
      });
      if (error || !data || (data as any).error || !(data as any).reason) return;
      const suggested = data as { category: RevisionCategory; reason: string };
      setMotivoDialog(prev => {
        if (!prev) return prev;
        const keepTyped = !force && prev.motivo.trim() && prev.motivo.trim() !== draft.trim();
        return {
          ...prev,
          motivo: keepTyped ? prev.motivo : suggested.reason,
          categoria: !force && prev.categoria ? prev.categoria : suggested.category,
        };
      });
    } catch (e) {
      console.error('Sugestão de motivo por IA falhou:', e);
    } finally {
      setSuggestingMotivo(false);
    }
  };

  /** Confirma o save com registro de revisão + notificação do time. */
  const confirmRevisionSave = async () => {
    if (!motivoDialog) return;
    const motivo = motivoDialog.motivo.trim();
    const categoria = motivoDialog.categoria;
    const origin = pendingOriginRef.current || 'manual';
    const boardNameNow = formName.trim();
    setMotivoDialog(null);
    setSavingRevision(true);
    try {
      const savedBoardId = await persistWorkflow({ silent: false });
      if (!savedBoardId || !lastRichSnapshotRef.current || !baselineRevisionRef.current) return;

      // Diff final contra o baseline usando o snapshot pós-save (templateIds definitivos)
      const snap = lastRichSnapshotRef.current;
      const entries = diffSnapshots(baselineRevisionRef.current.snapshot, snap);
      const author = await getRevisionAuthor();
      const rev = await createWorkflowRevision({
        boardId: savedBoardId,
        snapshot: snap,
        reason: motivo || null,
        category: categoria,
        summary: entries,
        origin,
        changedBy: author.id,
        changedByName: author.name,
      });
      baselineRevisionRef.current = { number: rev.revision_number, snapshot: rev.snapshot };
      pendingAiReasonRef.current = null;
      pendingOriginRef.current = null;

      if (entries.length > 0) {
        const count = await notifyWorkflowRevision({
          boardId: savedBoardId,
          title: `Atualização no ${typeLabel}: ${boardNameNow}`,
          summary: formatNotificationSummary(entries),
          reason: motivo
            ? (categoria ? `[${REVISION_CATEGORY_LABEL[categoria]}] ${motivo}` : motivo)
            : null,
          changedBy: author.id,
          changedByName: author.name,
        });
        toast.success(`Revisão #${rev.revision_number} registrada — ${count} pessoa(s) notificada(s)`);
      }
    } catch (e) {
      console.error('Erro ao registrar revisão:', e);
      toast.error('Fluxo salvo, mas falhou ao registrar a revisão no histórico');
    } finally {
      setSavingRevision(false);
    }
  };

  // Effect de autosave: dispara 1.5s após a última mudança
  useEffect(() => {
    // Só autosalva quando estamos editando um board já existente
    if (viewMode !== 'edit') return;
    if (!editingBoardId) return;
    if (!formName.trim() || phases.length === 0) return;
    if (saving) return;

    const snapshot = buildSnapshot(formName, formDescription, phases);
    // Inicializa baseline na entrada do edit mode (snapshot vazio)
    if (!lastSyncedSnapshotRef.current) {
      lastSyncedSnapshotRef.current = snapshot;
      return;
    }
    if (snapshot === lastSyncedSnapshotRef.current) return;

    setAutosaveStatus('pending');
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void persistWorkflow({ silent: true });
    }, 1500);

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [phases, formName, formDescription, formProcessNameTemplate, viewMode, editingBoardId, saving]);

  // Reset baseline ao trocar de board / sair de edit
  useEffect(() => {
    if (viewMode !== 'edit' || !editingBoardId) {
      lastSyncedSnapshotRef.current = '';
      setAutosaveStatus('idle');
      setAutosaveError('');
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    }
  }, [viewMode, editingBoardId]);



  // ─────────── Busca por texto ───────────
  // Varre toda a árvore do POP (fase → objetivo → passo → script/resposta/checklist)
  // e devolve os resultados com o caminho e o campo onde a palavra apareceu.
  // objIdx = -1 marca resultado no nível da própria fase.
  type SearchHit = { phaseIdx: number; objIdx: number; stepId?: string; path: string; field: string; snippet: string };
  const searchResults = useMemo<SearchHit[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const hit = (text?: string | null) => !!text && text.toLowerCase().includes(q);
    const out: SearchHit[] = [];
    phases.forEach((phase, phaseIdx) => {
      const fasePath = `Fase ${phaseIdx + 1}`;
      if (hit(phase.stageName)) out.push({ phaseIdx, objIdx: -1, path: fasePath, field: 'Fase', snippet: phase.stageName });
      phase.objectives.forEach((obj, objIdx) => {
        const objPath = `${fasePath} › Obj ${objIdx + 1}`;
        if (hit(obj.name)) out.push({ phaseIdx, objIdx, path: objPath, field: 'Objetivo', snippet: obj.name });
        if (hit(obj.description)) out.push({ phaseIdx, objIdx, path: objPath, field: 'Descrição do objetivo', snippet: obj.description });
        obj.items.forEach((step, stepIdx) => {
          const stepPath = `${objPath} › Passo ${stepIdx + 1}`;
          if (hit(step.label)) out.push({ phaseIdx, objIdx, stepId: step.id, path: stepPath, field: 'Passo', snippet: step.label });
          if (hit(step.description)) out.push({ phaseIdx, objIdx, stepId: step.id, path: stepPath, field: 'Descrição do passo', snippet: step.description! });
          if (hit(step.script)) out.push({ phaseIdx, objIdx, stepId: step.id, path: stepPath, field: 'Script', snippet: step.script! });
          step.answers?.forEach(a => { if (hit(a.label)) out.push({ phaseIdx, objIdx, stepId: step.id, path: stepPath, field: 'Resposta', snippet: a.label }); });
          step.docChecklist?.forEach(d => { if (hit(d.label)) out.push({ phaseIdx, objIdx, stepId: step.id, path: stepPath, field: 'Checklist', snippet: d.label }); });
        });
      });
    });
    return out;
  }, [searchQuery, phases]);

  // Expande o caminho do resultado (fase + objetivo) e rola até o passo com destaque.
  // isExpanded não entra no snapshot do autosave, então isto não dispara save.
  const goToSearchHit = (r: SearchHit) => {
    setPhases(prev => prev.map((p, pi) =>
      pi === r.phaseIdx
        ? { ...p, isExpanded: true, objectives: p.objectives.map((o, oi) => oi === r.objIdx ? { ...o, isExpanded: true } : o) }
        : p
    ));
    const anchorId = r.stepId ? `wf-step-${r.stepId}` : `wf-phase-${r.phaseIdx}`;
    window.setTimeout(() => {
      const el = document.getElementById(anchorId);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-primary', 'ring-offset-2');
      window.setTimeout(() => el.classList.remove('ring-2', 'ring-primary', 'ring-offset-2'), 2000);
    }, 160);
  };

  // Consome o deep-link de menção assim que as fases do board carregam:
  // localiza o passo, expande fase+objetivo, rola/destaca e (se pedido) abre
  // o chat da equipe já posicionado no passo com a mensagem destacada.
  useEffect(() => {
    const target = pendingDeepLinkRef.current;
    if (!target || viewMode !== 'edit' || phases.length === 0) return;

    let found: { phaseIdx: number; objIdx: number; label: string } | null = null;
    phases.forEach((p, pi) => p.objectives.forEach((o, oi) => {
      const step = o.items.find(s => s.id === target.stepId);
      if (step) found = { phaseIdx: pi, objIdx: oi, label: step.label || 'Passo' };
    }));
    if (!found) return;

    // Alvo encontrado — consome (não repetir em re-renders).
    pendingDeepLinkRef.current = null;
    const { phaseIdx, objIdx, label } = found;

    setPhases(prev => prev.map((p, pi) =>
      pi === phaseIdx
        ? { ...p, isExpanded: true, objectives: p.objectives.map((o, oi) => oi === objIdx ? { ...o, isExpanded: true } : o) }
        : p
    ));

    window.setTimeout(() => {
      const el = document.getElementById(`wf-step-${target.stepId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-primary', 'ring-offset-2');
        window.setTimeout(() => el.classList.remove('ring-2', 'ring-primary', 'ring-offset-2'), 2000);
      }
      if (target.openChat) {
        setStepChat({ stepId: target.stepId, label, highlightMsgId: target.msgId });
      }
    }, 250);
  }, [phases, viewMode]);

  // Destaca a ocorrência da busca dentro de um trecho de texto.
  const highlightMatch = (text: string): ReactNode => {
    const q = searchQuery.trim();
    if (!q) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-yellow-200 dark:bg-yellow-500/40 text-foreground rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>
        {text.slice(idx + q.length)}
      </>
    );
  };

  // Insere `{token}` na posição do cursor do editor de template do nome do processo.
  const insertProcessToken = (key: string) => {
    const token = `{${key}}`;
    const ta = processTemplateRef.current;
    const cur = formProcessNameTemplate;
    if (!ta) {
      setFormProcessNameTemplate(cur + token);
      return;
    }
    const start = ta.selectionStart ?? cur.length;
    const end = ta.selectionEnd ?? cur.length;
    const next = cur.slice(0, start) + token + cur.slice(end);
    setFormProcessNameTemplate(next);
    setTimeout(() => {
      ta.focus();
      const pos = start + token.length;
      ta.selectionStart = ta.selectionEnd = pos;
    }, 0);
  };

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-screen sm:max-w-none flex flex-col p-0">
        <SheetHeader className="px-6 py-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Workflow className="h-5 w-5" />
            {viewMode === 'list' ? (isFunnel ? 'Funis de Vendas' : 'POPs') : (editingBoardId ? `Editar ${typeLabelLower}` : `Novo ${typeLabelLower}`)}
          </SheetTitle>
        </SheetHeader>

        {viewMode === 'list' && (initialEditBoardId || initialCreateNew) ? (
          /* Transição: props indicam edição/criação; evita flash da lista */
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Carregando…</div>
        ) : viewMode === 'list' ? (
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

              {/* AI Generate/Edit + Histórico */}
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 border-dashed" onClick={() => {
                  setAiMode(editingBoardId ? 'edit' : 'create');
                  setAiChangelog(null);
                  setShowAiDialog(true);
                }}>
                  <Sparkles className="h-4 w-4 mr-2" />
                  {editingBoardId ? 'Editar com IA' : 'Preencher com IA a partir de uma descrição'}
                </Button>
                {editingBoardId && (
                  <Button variant="outline" onClick={() => setShowHistory(true)}>
                    <History className="h-4 w-4 mr-2" />
                    Histórico
                  </Button>
                )}
              </div>

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

              {/* Busca por texto em todo o POP */}
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Buscar palavra em fases, objetivos, passos, scripts e checklists..."
                    className="pl-8 pr-8"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      title="Limpar busca"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {searchQuery.trim() && (
                  <div className="rounded-md border bg-muted/20 max-h-72 overflow-y-auto divide-y">
                    {searchResults.length === 0 ? (
                      <p className="text-xs text-muted-foreground px-3 py-2.5">Nenhuma ocorrência de "{searchQuery.trim()}"</p>
                    ) : (
                      <>
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide px-3 py-1.5 bg-muted/40 sticky top-0">
                          {searchResults.length} ocorrência(s)
                        </p>
                        {searchResults.map((r, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => goToSearchHit(r)}
                            className="w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors block"
                          >
                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                              <span className="font-semibold text-foreground whitespace-nowrap">{r.field}</span>
                              <span>·</span>
                              <span className="truncate">{r.path}</span>
                            </div>
                            <p className="text-xs text-foreground line-clamp-1 mt-0.5">{highlightMatch(r.snippet)}</p>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Phases → Objectives → Steps */}
              <div className="space-y-3">
                <DndContext sensors={sensors} collisionDetection={typeAwareCollision} onDragEnd={handleWorkflowDragEnd}>
                <SortableContext items={phases.map(p => p.stageId)} strategy={verticalListSortingStrategy}>
                {phases.map((phase, phaseIdx) => (
                   <Sortable key={phase.stageId} id={phase.stageId} data={{ type: 'phase' }}>
                   {({ setNodeRef, style, attributes, listeners, isDragging }) => (
                   <div
                     ref={setNodeRef}
                     style={style}
                     id={`wf-phase-${phaseIdx}`}
                     className={cn(
                       "border rounded-lg overflow-hidden transition-all scroll-mt-4",
                       isDragging && "opacity-50 shadow-lg",
                     )}
                   >
                     {/* Phase header */}
                     <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-l-4 border-muted-foreground/30">
                       <GripVertical {...attributes} {...listeners} className="h-4 w-4 text-muted-foreground/50 flex-shrink-0 cursor-grab active:cursor-grabbing touch-none" />
                        <Collapsible open={phase.isExpanded} onOpenChange={() => togglePhase(phaseIdx)} className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 w-full min-w-0">
                            <CollapsibleTrigger asChild>
                              <button type="button" className={cn("flex items-center gap-2 text-left min-w-0", !phase.isExpanded && "flex-1")}>
                                {phase.isExpanded ? <ChevronDown className="h-4 w-4 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 flex-shrink-0" />}
                                <span className="flex-shrink-0 h-5 w-5 rounded-full bg-muted-foreground/20 text-muted-foreground text-[10px] font-bold flex items-center justify-center">
                                  {phaseIdx + 1}
                                </span>
                                {!phase.isExpanded && (
                                  <span className="font-semibold text-sm text-foreground truncate">{phase.stageName}</span>
                                )}
                              </button>
                            </CollapsibleTrigger>
                            {phase.isExpanded ? (
                              <Input
                                value={phase.stageName}
                                onChange={e => updatePhaseName(phaseIdx, e.target.value)}
                                onKeyDown={stopSpacePropagation}
                                onKeyUp={stopSpacePropagation}
                                placeholder="Nome da fase..."
                                className="h-7 text-sm font-semibold text-foreground flex-1"
                              />
                            ) : null}
                          </div>
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

                        <SortableContext items={phase.objectives.map((_, i) => `obj-${phaseIdx}-${i}`)} strategy={verticalListSortingStrategy}>
                        {phase.objectives.map((obj, objIdx) => (
                           <Sortable key={objIdx} id={`obj-${phaseIdx}-${objIdx}`} data={{ type: 'objective', phaseIdx, objIdx }}>
                           {({ setNodeRef, style, attributes, listeners, isDragging }) => (
                           <div
                             ref={setNodeRef}
                             style={style}
                             className={cn(
                               "border-t first:border-t-0 transition-all",
                               isDragging && "opacity-50 shadow-lg",
                             )}
                           >
                             {/* Objective header */}
                             <div className="flex items-center gap-2 px-4 py-2 ml-4 border-l-2 border-blue-400/40">
                                <GripVertical {...attributes} {...listeners} className="h-3.5 w-3.5 text-muted-foreground/40 cursor-grab flex-shrink-0 touch-none" />
                                 <Collapsible open={obj.isExpanded} onOpenChange={() => toggleObjective(phaseIdx, objIdx)} className="flex-1 min-w-0">
                                   <div className="flex items-center gap-2 w-full min-w-0">
                                     <CollapsibleTrigger asChild>
                                       <button type="button" className={cn("flex items-center gap-2 text-left min-w-0", !obj.isExpanded && "flex-1")}>
                                         {obj.isExpanded ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />}
                                         <span className="flex-shrink-0 h-5 w-5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-[10px] font-bold flex items-center justify-center">
                                           {objIdx + 1}
                                         </span>
                                         {!obj.isExpanded && (
                                           <span className="font-medium text-sm truncate">{obj.name}</span>
                                         )}
                                       </button>
                                     </CollapsibleTrigger>
                                     {obj.isExpanded ? (
                                       <Input
                                         value={obj.name}
                                         onChange={e => updateObjective(phaseIdx, objIdx, { name: e.target.value })}
                                         onKeyDown={stopSpacePropagation}
                                         onKeyUp={stopSpacePropagation}
                                         placeholder="Nome do objetivo..."
                                         className="h-7 text-sm font-medium flex-1"
                                       />
                                     ) : null}
                                   </div>
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
                                 {/* Objective description field — oculto por padrão */}
                                 <details className="group">
                                   <summary className="flex items-center gap-1.5 cursor-pointer list-none text-[10px] font-medium text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors select-none">
                                     <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                                     Descrição do objetivo
                                     {obj.description && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />}
                                   </summary>
                                   <Textarea
                                     value={obj.description}
                                     onChange={e => updateObjective(phaseIdx, objIdx, { description: e.target.value })}
                                     onKeyDown={stopSpacePropagation}
                                     onKeyUp={stopSpacePropagation}
                                     placeholder="Descreva o objetivo desta fase do funil..."
                                     className="mt-1.5 min-h-[52px] text-xs resize-none"
                                   />
                                 </details>

                                 {/* Steps — recuados pra dentro do objetivo */}
                                 <div className="ml-4 pl-3 border-l-2 border-green-400/30">
                                   <Label className="text-[10px] font-medium text-green-700 dark:text-green-400 uppercase tracking-wide flex items-center gap-1.5">
                                     <ClipboardList className="h-3 w-3" />
                                     Passos
                                   </Label>
                                   <StepZone phaseIdx={phaseIdx} objIdx={objIdx} className="mt-1.5 space-y-2">
                                    {obj.items.length === 0 ? (
                                      <p className="text-[11px] text-muted-foreground italic py-1">Nenhum passo adicionado (arraste um passo pra cá)</p>
                                    ) : (
                                      <SortableContext items={obj.items.map(s => s.id)} strategy={verticalListSortingStrategy}>
                                      {obj.items.map((step, stepIdx) => (
                                        <Sortable key={step.id} id={step.id} data={{ type: 'step', phaseIdx, objIdx }}>
                                        {({ setNodeRef, style, attributes, listeners, isDragging }) => (
                                        <div
                                          ref={setNodeRef}
                                          style={style}
                                          id={`wf-step-${step.id}`}
                                          className={cn(
                                            "border border-green-200 dark:border-green-900/40 rounded-md bg-green-50/30 dark:bg-green-950/10 p-2.5 space-y-2 transition-all scroll-mt-4",
                                            isDragging && "opacity-50 shadow-lg",
                                          )}
                                        >
                                          {/* Step header: number + delete */}
                                          <div className="flex items-center gap-2">
                                            <GripVertical {...attributes} {...listeners} className="h-3.5 w-3.5 text-muted-foreground/40 cursor-grab flex-shrink-0 touch-none" />
                                            <span className="flex-shrink-0 h-5 w-5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-[10px] font-bold flex items-center justify-center">
                                              {stepIdx + 1}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                              <Input
                                                value={step.label}
                                                onChange={e => updateStepLabel(phaseIdx, objIdx, step.id, e.target.value)}
                                                 onKeyDown={stopSpacePropagation}
                                                 onKeyUp={stopSpacePropagation}
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
                                              className={cn("h-6 w-6 flex-shrink-0", step.answers?.length ? "text-purple-500" : "text-muted-foreground")}
                                              title={step.answers?.length ? `Pergunta com ${step.answers.length} resposta(s)` : "Transformar em pergunta com respostas"}
                                              onClick={() => setAnswersDialog({ phaseIdx, objIdx, stepId: step.id, answers: step.answers ? step.answers.map(a => ({ ...a })) : [] })}
                                            >
                                              <HelpCircle className="h-3.5 w-3.5" />
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
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className={cn("h-6 w-6 flex-shrink-0", step.messageTemplates && Object.keys(step.messageTemplates).length > 0 ? "text-blue-500" : "text-muted-foreground")}
                                              title={step.messageTemplates && Object.keys(step.messageTemplates).length > 0 ? `Modelos de mensagem (${Object.keys(step.messageTemplates).length})` : 'Adicionar modelos de mensagem da atividade'}
                                              onClick={() => setMsgTemplatesDialog({
                                                phaseIdx,
                                                objIdx,
                                                stepId: step.id,
                                                templates: normalizeMessageTemplates(step.messageTemplates),
                                                activeTab: ACTIVITY_MESSAGE_FIELDS[0].key,
                                              })}
                                            >
                                              <PenLine className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-primary"
                                              title="Chat da equipe sobre este passo"
                                              onClick={() => setStepChat({ stepId: step.id, label: step.label || `Passo ${stepIdx + 1}` })}
                                            >
                                              <MessagesSquare className="h-3.5 w-3.5" />
                                            </Button>
                                            {phases.reduce((n, p) => n + p.objectives.length, 0) > 1 && (
                                              <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                  <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 text-muted-foreground hover:text-foreground flex-shrink-0"
                                                    title="Mover passo para outro objetivo / fase"
                                                  >
                                                    <FolderInput className="h-3.5 w-3.5" />
                                                  </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
                                                  {phases.map((p, pi) => (
                                                    <div key={p.stageId}>
                                                      <DropdownMenuLabel className="flex items-center gap-1.5 text-[11px]">
                                                        <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.stageColor }} />
                                                        {p.stageName || `Fase ${pi + 1}`}
                                                      </DropdownMenuLabel>
                                                      {p.objectives.length === 0 ? (
                                                        <DropdownMenuItem disabled className="text-[11px] italic opacity-60 pl-5">Sem objetivos</DropdownMenuItem>
                                                      ) : p.objectives.map((o, oi) => {
                                                        const isCurrent = pi === phaseIdx && oi === objIdx;
                                                        return (
                                                          <DropdownMenuItem
                                                            key={`${p.stageId}-${oi}`}
                                                            disabled={isCurrent}
                                                            onSelect={() => moveStepToObjective(phaseIdx, objIdx, step.id, pi, oi)}
                                                            className="text-xs pl-5"
                                                          >
                                                            {o.name || `Objetivo ${oi + 1}`}{isCurrent ? ' (atual)' : ''}
                                                          </DropdownMenuItem>
                                                        );
                                                      })}
                                                      {pi < phases.length - 1 && <DropdownMenuSeparator />}
                                                    </div>
                                                  ))}
                                                </DropdownMenuContent>
                                              </DropdownMenu>
                                            )}
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
                                            {step.answers?.length ? (
                                              <button
                                                type="button"
                                                className="flex-1 text-left text-[11px] text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1"
                                                title="O destino é definido pela resposta escolhida. Clique para editar as respostas."
                                                onClick={() => setAnswersDialog({ phaseIdx, objIdx, stepId: step.id, answers: step.answers!.map(a => ({ ...a })) })}
                                              >
                                                <HelpCircle className="h-3 w-3 flex-shrink-0" />
                                                Definido pelas respostas da pergunta ({step.answers.length})
                                              </button>
                                            ) : (
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
                                            )}
                                          </div>

                                          {/* Definir status do POP ao concluir o passo (separado da fase). */}
                                          {formResultados.length > 0 && (
                                            <div className="flex items-center gap-2">
                                              <Label className="text-[10px] text-muted-foreground whitespace-nowrap w-20 flex-shrink-0">Definir status:</Label>
                                              <Select
                                                value={step.setStatusId || '__none__'}
                                                onValueChange={v => updateStepSetStatus(phaseIdx, objIdx, step.id, v === '__none__' ? '' : v)}
                                              >
                                                <SelectTrigger className="h-7 text-xs flex-1">
                                                  <SelectValue placeholder="Não alterar" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  <SelectItem value="__none__">
                                                    <span className="text-muted-foreground">Não alterar</span>
                                                  </SelectItem>
                                                  {formResultados.map(r => (
                                                    <SelectItem key={r.id} value={r.id}>
                                                      <div className="flex items-center gap-1.5">
                                                        <span className="h-2.5 w-2.5 rounded-full flex-shrink-0 bg-yellow-400" />
                                                        {r.label}{formResultadoEsperadoIds.includes(r.id) ? ' ✅' : ''}
                                                      </div>
                                                    </SelectItem>
                                                  ))}
                                                </SelectContent>
                                              </Select>
                                            </div>
                                          )}
                                        </div>
                                        )}
                                        </Sortable>
                                      ))}
                                      </SortableContext>
                                    )}
                                  </StepZone>
                                </div>

                                {/* Add step */}
                                <StepAdder onAdd={(label) => addStep(phaseIdx, objIdx, label)} />
                              </div>
                            )}
                          </div>
                             )}
                           </Sortable>
                        ))}
                        </SortableContext>
                      </div>
                    )}
                  </div>
                   )}
                   </Sortable>
                ))}
                </SortableContext>
                </DndContext>

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

                {/* Resultados possíveis do POP (tipo status) + qual é o ESPERADO (sucesso). */}
                <div className="mt-4 rounded-lg border p-3 space-y-3">
                  <div className="text-sm font-semibold">🎯 Status possíveis do POP</div>
                  <p className="text-xs text-muted-foreground">
                    Cadastre os status que um lead deste funil/POP pode ter (ex.: <em>Em andamento</em>,
                    <em> Fechado</em>, <em>Recusado</em>). Marque o(s) <b>esperado(s)</b> — pode ser
                    <b> mais de um</b> (ex.: <em>Acordo</em> ou <em>Procedência</em> ambos contam como
                    sucesso). É o "sucesso"/objetivo final e vira o 1º critério do ranking do telão.
                  </p>

                  <div className="space-y-2">
                    {formResultados.map((r, i) => (
                      <div key={r.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="shrink-0"
                          checked={formResultadoEsperadoIds.includes(r.id)}
                          onChange={() => setFormResultadoEsperadoIds(prev =>
                            prev.includes(r.id) ? prev.filter(id => id !== r.id) : [...prev, r.id],
                          )}
                          title="Marcar como status esperado (sucesso) — pode marcar vários"
                        />
                        <Input
                          value={r.label}
                          onChange={e => setFormResultados(prev => prev.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                          placeholder="Nome do resultado"
                          className="flex-1"
                        />
                        <Select
                          value={r.marco || '__none__'}
                          onValueChange={(val) => setFormResultados(prev => prev.map((x, j) => j === i ? { ...x, marco: val === '__none__' ? null : val } : x))}
                        >
                          <SelectTrigger className="w-[190px] shrink-0 h-9 text-xs" title="Marco do Escavador que dispara este resultado automaticamente">
                            <SelectValue placeholder="Marco gatilho (opcional)" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Sem marco gatilho</SelectItem>
                            <SelectItem value="sentenca_1grau">Sentença (1º grau)</SelectItem>
                            <SelectItem value="acordo">Acordo homologado</SelectItem>
                            <SelectItem value="acordao_2grau">Acórdão (2º grau)</SelectItem>
                            <SelectItem value="acordao_superior">Acórdão (Superior)</SelectItem>
                            <SelectItem value="transito_julgado">Trânsito em julgado</SelectItem>
                            <SelectItem value="pagamento">Pagamento</SelectItem>
                          </SelectContent>
                        </Select>
                        {formResultadoEsperadoIds.includes(r.id) && (
                          <span className="shrink-0 text-[10px] font-black uppercase tracking-wider text-emerald-500">esperado</span>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="shrink-0"
                          onClick={() => {
                            setFormResultados(prev => prev.filter((_, j) => j !== i));
                            setFormResultadoEsperadoIds(prev => prev.filter(id => id !== r.id));
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <Input
                      value={newResultadoLabel}
                      onChange={e => setNewResultadoLabel(e.target.value)}
                      placeholder="Novo status (ex.: Em andamento, Fechado)"
                      className="flex-1"
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newResultadoLabel.trim()) {
                          setFormResultados(prev => [...prev, { id: crypto.randomUUID(), label: newResultadoLabel.trim() }]);
                          setNewResultadoLabel('');
                        }
                      }}
                    />
                    <Button
                      variant="outline"
                      disabled={!newResultadoLabel.trim()}
                      onClick={() => {
                        setFormResultados(prev => [...prev, { id: crypto.randomUUID(), label: newResultadoLabel.trim() }]);
                        setNewResultadoLabel('');
                      }}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Padrão de Nome do Processo — disponível nos dois tipos: funil
                    (comercial) e POP (processual) têm as mesmas funcionalidades,
                    o board_type só diz de qual time o quadro é. */}
                {(
                  <div className="mt-4 rounded-lg border p-3 space-y-3">
                    <div className="text-sm font-semibold">🏷️ Padrão de Nome do Processo</div>
                    <p className="text-xs text-muted-foreground">
                      Define como o título dos processos criados sob este POP é montado. Escreva o
                      texto e clique nos campos para inserir variáveis. Campo vazio é omitido
                      automaticamente. Ao cadastrar o processo, o título já vem preenchido — e pode
                      ser editado. Deixe em branco para não aplicar padrão.
                    </p>

                    <div className="flex flex-wrap gap-1.5">
                      {PROCESS_NAME_TOKENS.map(tok => (
                        <button
                          key={tok.key}
                          type="button"
                          onClick={() => insertProcessToken(tok.key)}
                          title={tok.hint || tok.label}
                          className="text-[10px] px-2 py-1 rounded-full border bg-background text-muted-foreground border-border hover:border-primary/50 transition-colors"
                        >
                          + {tok.label}
                        </button>
                      ))}
                    </div>

                    <Textarea
                      ref={processTemplateRef}
                      value={formProcessNameTemplate}
                      onChange={e => setFormProcessNameTemplate(e.target.value)}
                      placeholder="Ex: {client_name} — {classe} ({tribunal})"
                      className="min-h-[60px] text-xs font-mono"
                    />

                    <div className="flex items-center gap-2 p-2 rounded bg-muted/50 border">
                      <span className="text-[10px] text-muted-foreground shrink-0">Prévia:</span>
                      <span className="text-[11px] font-medium truncate">
                        {formProcessNameTemplate.trim()
                          ? (renderProcessTitle(formProcessNameTemplate, PROCESS_NAME_PREVIEW_CONTEXT) || <em className="text-muted-foreground">(vazio)</em>)
                          : <em className="text-muted-foreground">(sem padrão — título digitado manualmente)</em>}
                      </span>
                    </div>
                  </div>
                )}
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
                {editingBoardId && autosaveStatus !== 'idle' && (
                  <span
                    className={cn(
                      'text-xs mr-auto self-center',
                      autosaveStatus === 'error' ? 'text-destructive' : 'text-muted-foreground',
                    )}
                    aria-live="polite"
                  >
                    {autosaveStatus === 'error' && (
                      <span title={autosaveError || undefined}>
                        ⚠ falha ao sincronizar{autosaveError ? `: ${autosaveError.slice(0, 120)}` : ''}
                      </span>
                    )}
                  </span>
                )}
                <Button variant="outline" onClick={() => {
                  // Mudanças autosalvas que escapariam do histórico são registradas aqui
                  captureRevisionOnClose();
                  if (initialEditBoardId || initialCreateNew) {
                    onOpenChange(false);
                  } else {
                    resetForm();
                  }
                }}>Cancelar</Button>
                <Button onClick={handleSave} disabled={!formName.trim() || phases.length === 0 || saving || savingRevision}>
                  {saving || savingRevision ? 'Salvando...' : 'Salvar'}
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
                  <Input
                    value={item.label}
                    onChange={e => setDocChecklistDialog(prev => prev ? {
                      ...prev,
                      items: prev.items.map(i => i.id === item.id ? { ...i, label: e.target.value } : i),
                    } : null)}
                    className="h-7 text-sm flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive/80 hover:text-destructive flex-shrink-0"
                    onClick={() => setDocChecklistDialog(prev => prev ? { ...prev, items: prev.items.filter(i => i.id !== item.id) } : null)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {/* Mover para fase — só quando o item não tem respostas configuradas */}
                {!item.answers?.length && (
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
                )}

                {/* Alterar status do POP — só quando o item não tem respostas configuradas */}
                {!item.answers?.length && formResultados.length > 0 && (
                <div className="flex items-center gap-2 ml-7">
                  <Label className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">Status para:</Label>
                  <Select
                    value={item.setStatusId || '__none__'}
                    onValueChange={v => setDocChecklistDialog(prev => prev ? {
                      ...prev,
                      items: prev.items.map(i => i.id === item.id ? { ...i, setStatusId: v === '__none__' ? undefined : v } : i),
                    } : null)}
                  >
                    <SelectTrigger className="h-6 text-[10px] flex-1">
                      <SelectValue placeholder="Não alterar" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        <span className="text-muted-foreground">Não alterar</span>
                      </SelectItem>
                      {formResultados.map(r => (
                        <SelectItem key={r.id} value={r.id}>
                          <div className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full flex-shrink-0 bg-yellow-400" />
                            {r.label}{formResultadoEsperadoIds.includes(r.id) ? ' ✅' : ''}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                )}

                {/* Respostas da pergunta — cada resposta com seu destino */}
                <div className="ml-7 space-y-1">
                  {(item.answers || []).map(answer => (
                    <div key={answer.id} className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-purple-500 flex-shrink-0" title="Resposta">↳</span>
                        <Input
                          value={answer.label}
                          onChange={e => setDocChecklistDialog(prev => prev ? {
                            ...prev,
                            items: prev.items.map(i => i.id === item.id
                              ? { ...i, answers: (i.answers || []).map(a => a.id === answer.id ? { ...a, label: e.target.value } : a) }
                              : i),
                          } : null)}
                          placeholder="Texto da resposta..."
                          className="h-6 text-xs flex-1"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-destructive/70 hover:text-destructive flex-shrink-0"
                          onClick={() => setDocChecklistDialog(prev => prev ? {
                            ...prev,
                            items: prev.items.map(i => i.id === item.id
                              ? { ...i, answers: (i.answers || []).filter(a => a.id !== answer.id) }
                              : i),
                          } : null)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-1.5 pl-4">
                        <Select
                          value={answer.nextStageId || '__none__'}
                          onValueChange={v => setDocChecklistDialog(prev => prev ? {
                            ...prev,
                            items: prev.items.map(i => i.id === item.id
                              ? { ...i, answers: (i.answers || []).map(a => a.id === answer.id ? { ...a, nextStageId: v === '__none__' ? undefined : v } : a) }
                              : i),
                          } : null)}
                        >
                          <SelectTrigger className="h-6 text-[10px] flex-1" title="Mover o lead para outra fase quando esta resposta for escolhida">
                            <SelectValue placeholder="Não mover" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">
                              <span className="text-muted-foreground">Não mover</span>
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
                        {formResultados.length > 0 && (
                          <Select
                            value={answer.setStatusId || '__none__'}
                            onValueChange={v => setDocChecklistDialog(prev => prev ? {
                              ...prev,
                              items: prev.items.map(i => i.id === item.id
                                ? { ...i, answers: (i.answers || []).map(a => a.id === answer.id ? { ...a, setStatusId: v === '__none__' ? undefined : v } : a) }
                                : i),
                            } : null)}
                          >
                            <SelectTrigger className="h-6 text-[10px] flex-1" title="Alterar o status do POP quando esta resposta for escolhida">
                              <SelectValue placeholder="Não alterar status" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">
                                <span className="text-muted-foreground">Não alterar status</span>
                              </SelectItem>
                              {formResultados.map(r => (
                                <SelectItem key={r.id} value={r.id}>
                                  <div className="flex items-center gap-1.5">
                                    <span className="h-2 w-2 rounded-full flex-shrink-0 bg-yellow-400" />
                                    {r.label}{formResultadoEsperadoIds.includes(r.id) ? ' ✅' : ''}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="flex items-center gap-1 text-[10px] text-purple-600 dark:text-purple-400 hover:underline"
                    onClick={() => setDocChecklistDialog(prev => prev ? {
                      ...prev,
                      items: prev.items.map(i => i.id === item.id
                        ? { ...i, answers: [...(i.answers || []), { id: crypto.randomUUID(), label: '' }] }
                        : i),
                    } : null)}
                  >
                    <Plus className="h-3 w-3" />
                    Adicionar resposta {!item.answers?.length && '(pergunta com desdobramento)'}
                  </button>
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
                // Apply the type to all items; descarta respostas vazias e,
                // quando há respostas, o destino do item passa a ser delas.
                const typedItems = docChecklistDialog.items.map(item => {
                  const answers = (item.answers || []).filter(a => a.label.trim());
                  return {
                    ...item,
                    type: item.type || docChecklistDialog.checklistType,
                    answers: answers.length > 0 ? answers : undefined,
                    nextStageId: answers.length > 0 ? undefined : item.nextStageId,
                    setStatusId: answers.length > 0 ? undefined : item.setStatusId,
                  };
                });
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

    {/* Pergunta com respostas configuráveis */}
    <Dialog open={!!answersDialog} onOpenChange={(open) => { if (!open) { setAnswersDialog(null); setNewAnswerLabel(''); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-purple-500" />
            Pergunta com Respostas
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            O passo vira uma pergunta: para concluí-lo, o usuário escolhe uma das respostas abaixo. Cada resposta pode finalizar o lead, movê-lo para outra fase e/ou alterar o status do POP — decidido pela resposta.
          </p>

          {/* Respostas existentes */}
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
            {(answersDialog?.answers || []).map((answer, idx) => (
              <div key={answer.id} className="p-2 rounded-md border bg-muted/20 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="flex-shrink-0 h-5 w-5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 text-[10px] font-bold flex items-center justify-center">
                    {idx + 1}
                  </span>
                  <Input
                    value={answer.label}
                    onChange={e => setAnswersDialog(prev => prev ? {
                      ...prev,
                      answers: prev.answers.map(a => a.id === answer.id ? { ...a, label: e.target.value } : a),
                    } : null)}
                    placeholder="Texto da resposta..."
                    className="h-7 text-sm flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive/80 hover:text-destructive flex-shrink-0"
                    onClick={() => setAnswersDialog(prev => prev ? { ...prev, answers: prev.answers.filter(a => a.id !== answer.id) } : null)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-2 ml-7">
                  <Label className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">Se escolhida:</Label>
                  <Select
                    value={answer.nextStageId || '__none__'}
                    onValueChange={v => setAnswersDialog(prev => prev ? {
                      ...prev,
                      answers: prev.answers.map(a => a.id === answer.id ? { ...a, nextStageId: v === '__none__' ? undefined : v } : a),
                    } : null)}
                  >
                    <SelectTrigger className="h-6 text-[10px] flex-1" title="Mover o lead para outra fase quando esta resposta for escolhida">
                      <SelectValue placeholder="Não mover" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        <span className="text-muted-foreground">Não mover</span>
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
                  {formResultados.length > 0 && (
                    <Select
                      value={answer.setStatusId || '__none__'}
                      onValueChange={v => setAnswersDialog(prev => prev ? {
                        ...prev,
                        answers: prev.answers.map(a => a.id === answer.id ? { ...a, setStatusId: v === '__none__' ? undefined : v } : a),
                      } : null)}
                    >
                      <SelectTrigger className="h-6 text-[10px] flex-1" title="Alterar o status do POP quando esta resposta for escolhida">
                        <SelectValue placeholder="Não alterar status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">
                          <span className="text-muted-foreground">Não alterar status</span>
                        </SelectItem>
                        {formResultados.map(r => (
                          <SelectItem key={r.id} value={r.id}>
                            <div className="flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full flex-shrink-0 bg-yellow-400" />
                              {r.label}{formResultadoEsperadoIds.includes(r.id) ? ' ✅' : ''}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            ))}
            {(answersDialog?.answers || []).length === 0 && (
              <p className="text-xs text-muted-foreground italic text-center py-2">Nenhuma resposta adicionada — sem respostas, o passo volta a ser um checkbox normal</p>
            )}
          </div>

          {/* Adicionar resposta */}
          <div className="flex gap-2">
            <Input
              value={newAnswerLabel}
              onChange={e => setNewAnswerLabel(e.target.value)}
              placeholder="Ex: Sim, tem interesse / Não tem interesse..."
              className="flex-1 text-sm"
              onKeyDown={e => {
                if (e.key === 'Enter' && newAnswerLabel.trim()) {
                  setAnswersDialog(prev => prev ? {
                    ...prev,
                    answers: [...prev.answers, { id: crypto.randomUUID(), label: newAnswerLabel.trim() }],
                  } : null);
                  setNewAnswerLabel('');
                }
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (newAnswerLabel.trim()) {
                  setAnswersDialog(prev => prev ? {
                    ...prev,
                    answers: [...prev.answers, { id: crypto.randomUUID(), label: newAnswerLabel.trim() }],
                  } : null);
                  setNewAnswerLabel('');
                }
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { setAnswersDialog(null); setNewAnswerLabel(''); }}>Cancelar</Button>
            <Button size="sm" onClick={() => {
              if (answersDialog) {
                const validAnswers = answersDialog.answers.filter(a => a.label.trim());
                updateStepAnswers(answersDialog.phaseIdx, answersDialog.objIdx, answersDialog.stepId, validAnswers);
                setAnswersDialog(null);
                setNewAnswerLabel('');
                toast.success(validAnswers.length > 0 ? 'Pergunta salva!' : 'Pergunta removida — passo voltou a ser checkbox');
              }
            }}>
              Salvar Pergunta
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Modelos de mensagem por campo da atividade */}
    <Dialog open={!!msgTemplatesDialog} onOpenChange={(open) => !open && setMsgTemplatesDialog(null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PenLine className="h-5 w-5 text-blue-500" />
            Modelos de mensagem da atividade
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Defina o texto que vai pré-preencher cada caixa de texto da atividade quando ela for criada a partir deste passo. Use as variáveis abaixo para deixar dinâmico (ex: <code className="bg-muted px-1 rounded">{'{{lead_name}}'}</code>, <code className="bg-muted px-1 rounded">{'{{saudacao}}'}</code>).
          </p>

          {msgTemplatesDialog && (
            <Tabs
              value={msgTemplatesDialog.activeTab}
              onValueChange={(v) => setMsgTemplatesDialog(prev => prev ? { ...prev, activeTab: v } : null)}
            >
              <TabsList className="grid grid-cols-4 w-full h-auto">
                {ACTIVITY_MESSAGE_FIELDS.map(f => {
                  const count = (msgTemplatesDialog.templates[f.key] || []).filter(v => v.content?.trim()).length;
                  return (
                    <TabsTrigger key={f.key} value={f.key} className="text-xs py-1.5 relative">
                      {f.label}
                      {count > 0 && (
                        <span className="ml-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-blue-500 text-white text-[9px] font-medium">
                          {count}
                        </span>
                      )}
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              {ACTIVITY_MESSAGE_FIELDS.map(f => {
                const variations = msgTemplatesDialog.templates[f.key] || [];
                const updateVariation = (idx: number, patch: Partial<TemplateVariation>) => {
                  setMsgTemplatesDialog(prev => {
                    if (!prev) return null;
                    const list = [...(prev.templates[f.key] || [])];
                    list[idx] = { ...list[idx], ...patch };
                    return { ...prev, templates: { ...prev.templates, [f.key]: list } };
                  });
                };
                const addVariation = () => {
                  setMsgTemplatesDialog(prev => {
                    if (!prev) return null;
                    const list = [...(prev.templates[f.key] || [])];
                    const idx = list.length + 1;
                    list.push({ id: crypto.randomUUID(), name: list.length === 0 ? 'Padrão' : `Variação ${idx}`, content: '' });
                    return { ...prev, templates: { ...prev.templates, [f.key]: list } };
                  });
                };
                const removeVariation = (idx: number) => {
                  setMsgTemplatesDialog(prev => {
                    if (!prev) return null;
                    const list = [...(prev.templates[f.key] || [])];
                    list.splice(idx, 1);
                    return { ...prev, templates: { ...prev.templates, [f.key]: list } };
                  });
                };
                const insertVar = (idx: number, varText: string) => {
                  const current = variations[idx]?.content || '';
                  updateVariation(idx, { content: current + (current && !current.endsWith(' ') ? ' ' : '') + varText });
                };

                return (
                  <TabsContent key={f.key} value={f.key} className="mt-3 space-y-3">
                    <p className="text-[11px] text-muted-foreground">
                      Modelos para o campo <strong>"{f.label}"</strong>. Crie múltiplas variações (ex: Formal, Curta) — o usuário escolhe na atividade.
                    </p>

                    {variations.length === 0 && (
                      <div className="border border-dashed rounded-md p-4 text-center">
                        <p className="text-xs text-muted-foreground mb-2">Nenhum modelo configurado</p>
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addVariation}>
                          <Plus className="h-3 w-3 mr-1" /> Criar primeiro modelo
                        </Button>
                      </div>
                    )}

                    {variations.map((variation, idx) => (
                      <div key={variation.id || idx} className="border rounded-md p-2.5 space-y-2 bg-muted/30">
                        <div className="flex items-center gap-2">
                          <Input
                            value={variation.name}
                            onChange={e => updateVariation(idx, { name: e.target.value })}
                            placeholder={`Nome (ex: Formal, Curta)`}
                            className="h-7 text-xs flex-1"
                          />
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" size="sm" className="h-7 text-xs">
                                <Plus className="h-3 w-3 mr-1" /> Variável
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="max-h-72 overflow-y-auto w-72">
                              {TEMPLATE_VARIABLES.map(v => (
                                <DropdownMenuItem
                                  key={v.var}
                                  onClick={() => insertVar(idx, v.var)}
                                  className="text-xs flex flex-col items-start gap-0.5 py-1.5"
                                >
                                  <code className="text-[10px] bg-muted px-1 rounded">{v.var}</code>
                                  <span className="text-[10px] text-muted-foreground">{v.label}</span>
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive/70 hover:text-destructive" onClick={() => removeVariation(idx)}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <Textarea
                          value={variation.content}
                          onChange={e => updateVariation(idx, { content: e.target.value })}
                          placeholder={f.placeholder}
                          className="min-h-[110px] text-sm"
                        />
                      </div>
                    ))}

                    {variations.length > 0 && (
                      <Button variant="outline" size="sm" className="h-7 text-xs w-full" onClick={addVariation}>
                        <Plus className="h-3 w-3 mr-1" /> Adicionar variação
                      </Button>
                    )}
                  </TabsContent>
                );
              })}
            </Tabs>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" size="sm" onClick={() => setMsgTemplatesDialog(null)}>Cancelar</Button>
            <Button size="sm" onClick={() => {
              if (msgTemplatesDialog) {
                updateStepMessageTemplates(
                  msgTemplatesDialog.phaseIdx,
                  msgTemplatesDialog.objIdx,
                  msgTemplatesDialog.stepId,
                  msgTemplatesDialog.templates,
                );
                setMsgTemplatesDialog(null);
                toast.success('Modelos de mensagem salvos!');
              }
            }}>
              Salvar modelos
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>


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
    {/* Motivo da alteração — abre no Salvar quando há diff desde a última revisão */}
    <Dialog open={!!motivoDialog} onOpenChange={o => { if (!o) setMotivoDialog(null); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            Registrar alteração no {typeLabel}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded border bg-muted/30 p-2 max-h-48 overflow-y-auto space-y-1">
            {(motivoDialog?.entries || []).length > 0 && formatDiffLines(motivoDialog!.entries).map((line, i) => (
              <p key={i} className="text-xs leading-relaxed">• {line}</p>
            ))}
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Categoria da alteração:</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {(Object.keys(REVISION_CATEGORY_LABEL) as RevisionCategory[]).map(cat => (
                <Button
                  key={cat}
                  type="button"
                  size="sm"
                  variant={motivoDialog?.categoria === cat ? 'default' : 'outline'}
                  onClick={() => setMotivoDialog(prev => prev ? { ...prev, categoria: prev.categoria === cat ? null : cat } : prev)}
                >
                  {REVISION_CATEGORY_LABEL[cat]}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Motivo da alteração (fica no histórico e vai na notificação do time):
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs shrink-0"
                disabled={suggestingMotivo || !motivoDialog?.entries.length}
                onClick={() => motivoDialog && suggestRevisionMotivo(motivoDialog.entries, motivoDialog.motivo, true)}
              >
                {suggestingMotivo ? (
                  <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Analisando...</>
                ) : (
                  <><Sparkles className="h-3 w-3 mr-1" />Sugerir com IA</>
                )}
              </Button>
            </div>
            <Textarea
              value={motivoDialog?.motivo || ''}
              onChange={e => setMotivoDialog(prev => prev ? { ...prev, motivo: e.target.value } : prev)}
              placeholder={suggestingMotivo
                ? 'IA analisando as alterações para sugerir o motivo...'
                : 'Ex: A agência de Teresina passou a exigir presença com OAB às 7h para senhas ilimitadas...'}
              className="mt-1 min-h-[80px]"
              autoFocus
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setMotivoDialog(null)} disabled={savingRevision}>
              Voltar
            </Button>
            <Button onClick={confirmRevisionSave} disabled={savingRevision}>
              {savingRevision ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Salvando...</>
              ) : (
                'Salvar e notificar o time'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Histórico de revisões (linha do tempo + versão anotada estilo lei) */}
    <WorkflowHistorySheet
      open={showHistory}
      onOpenChange={setShowHistory}
      boardId={editingBoardId}
      boardName={formName}
      typeLabel={typeLabel}
      onRestore={handleRestoreRevision}
    />

    <ConfirmDeleteDialog />

    {/* Chat interno da equipe sobre um passo específico do POP */}
    <TeamChatSheet
      open={!!stepChat}
      onOpenChange={(o) => !o && setStepChat(null)}
      entityType="pop_step"
      entityId={stepChat?.stepId || ''}
      entityName={stepChat?.label}
      highlightMessageId={stepChat?.highlightMsgId}
    />
    </>
  );
}

/** Small inline component for adding a step */
function StepAdder({ onAdd }: { onAdd: (label: string) => void }) {
  const [label, setLabel] = useState('');
  const commit = () => {
    if (label.trim()) {
      onAdd(label);
      setLabel('');
    }
  };
  return (
    <div className="flex gap-1.5">
      <Input
        value={label}
        onChange={e => setLabel(e.target.value)}
        placeholder="Novo passo..."
        className="flex-1 h-7 text-xs"
        onKeyDown={e => {
          if (e.key === ' ' || e.code === 'Space') e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        onKeyUp={e => {
          if (e.key === ' ' || e.code === 'Space') e.stopPropagation();
        }}
        // Auto-commit ao perder foco (ex: usuário digita e clica direto em "Salvar"
        // sem apertar + ou Enter — antes o texto era descartado).
        onBlur={commit}
      />
      <Button variant="outline" size="sm" className="h-7 px-2" onMouseDown={e => e.preventDefault()} onClick={commit}>
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );
}
