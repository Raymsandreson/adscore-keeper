import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

import { externalSupabase } from '@/integrations/supabase/external-client';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { ChevronDown, ChevronUp, X, ClipboardList, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useChecklists, CHECKLIST_TYPES } from '@/hooks/useChecklists';
import { useAuthContext } from '@/contexts/AuthContext';
import { askStepTiming } from '@/components/checklists/askStepTiming';
import { calculateHierarchicalProgress } from './progress/calculateHierarchicalProgress';
import {
  syncInstanceItems,
  stripDisplayFields,
  POP_CHANGE_LABEL,
  type SyncItem,
  type PopChange,
} from '@/lib/syncChecklistInstances';
import {
  normalizeLabel as normalizePopLabel,
  mirrorLabelsOf as mirrorLabels,
} from '@/lib/popAnswerMirror';
import { isStepBlockedBySubItems, pendingSubItems } from '@/lib/stepSubitems';
import { PopCatchUpSheet, type PopCatchUpStep, type PopCatchUpMark } from '@/components/activities/PopCatchUpSheet';
import { useProcessoMarcos, FONTE_LABEL } from '@/hooks/useProcessoMarcos';
import { notifyPopStepsChanged } from '@/lib/popStepsEvent';

interface Stage {
  id: string;
  name: string;
  color: string;
}

/** '2026-05-14' → '14/05/2026'. Data de marco vem do banco como ISO puro. */
const formatBRShort = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
};

/** RPCs do Externo que não estão nos tipos gerados (log_*, etc.). */
type RpcResult = { error?: { message?: string } | null };
const rpcExternal = (fn: string, args: Record<string, unknown>): PromiseLike<RpcResult> =>
  (externalSupabase.rpc as unknown as (f: string, a: Record<string, unknown>) => PromiseLike<RpcResult>)(fn, args);

/** Mesma coisa, quando a RPC RETORNA linhas (leitura) — hoje só `pop_steps_log`. */
type RpcRowsResult<T> = { data?: T[] | null; error?: { message?: string } | null };
const rpcExternalRows = <T,>(fn: string, args: Record<string, unknown>): PromiseLike<RpcRowsResult<T>> =>
  (externalSupabase.rpc as unknown as (f: string, a: Record<string, unknown>) => PromiseLike<RpcRowsResult<T>>)(fn, args);

/** Uma linha de `pop_steps_log`: passo marcado, quando e se foi retroativo. */
interface PopStepLogRow {
  instance_id: string;
  item_label: string;
  retroactive: boolean;
  marked_by: string | null;
  marked_at: string;
}

/**
 * Item de checklist que ESPELHA uma resposta do passo — no POP o gerente
 * costuma cadastrar a mesma coisa nos dois lugares (ex.: resposta
 * "Requerimento Deferido" + item de verificação "Requerimento Deferido").
 * Casamos por rótulo (sem acento/caixa/espaço extra) porque o POP não guarda
 * vínculo entre resposta e item. O espelho não é marcável: quem marca é a
 * resposta escolhida — senão haveria dois lugares para dizer a mesma coisa,
 * e só um deles dispara fase e status.
 */
const normalizeLabel = normalizePopLabel;

const mirrorLabelsOf = (item: { answers?: AnswerOption[] }) =>
  mirrorLabels({ answers: item.answers?.map(a => ({ ...a })) });

/**
 * Consulta a colunas que existem no banco mas ainda não nos tipos gerados —
 * hoje `kanban_boards.settings` (jsonb com os status possíveis do POP).
 */
type LooseQuery = {
  select: (cols: string) => LooseQuery;
  eq: (col: string, val: string) => LooseQuery;
  maybeSingle: () => PromiseLike<{ data: Record<string, unknown> | null }>;
};
const fromExternalLoose = (table: string): LooseQuery =>
  (externalSupabase.from as unknown as (t: string) => LooseQuery)(table);

// Resposta configurável de um passo-pergunta ou de um item de checklist do
// passo. O destino da fase e o status do POP vêm da resposta escolhida.
interface AnswerOption {
  id: string;
  label: string;
  nextStageId?: string;
  setStatusId?: string;
}

interface DocChecklistItem {
  id: string;
  label: string;
  checked?: boolean;
  /** "Não se aplica" a este caso (persiste): destrava o passo sem dizer que foi feito. */
  notApplicable?: boolean;
  type?: string;
  nextStageId?: string;
  setStatusId?: string;
  answers?: AnswerOption[];
  /** Resposta escolhida neste lead (persiste junto do items). */
  selectedAnswerId?: string;
  /** Selo de exibição: documento marcado que saiu do POP. Não persiste. */
  popChange?: PopChange;
}

interface ChecklistItem {
  id: string;
  label: string;
  description?: string;
  checked?: boolean;
  nextStageId?: string;
  setStatusId?: string;
  answers?: AnswerOption[];
  selectedAnswerId?: string;
  docChecklist?: DocChecklistItem[];
  /**
   * Sub-itens que ESTE passo marcou em cascata ao ser concluído (persiste).
   * É o que permite desmarcar o passo e desfazer só o que o clique marcou,
   * sem apagar a conferência feita item a item antes dele.
   */
  autoCheckedDocIds?: string[];
  /** Registro do passo como era antes de o POP mudar (persiste; não é marcável). */
  supersededBy?: string;
  /** Selos de exibição calculados no load contra o template. Não persistem. */
  popChange?: PopChange;
  popNewLabel?: string;
}

interface ChecklistInstance {
  id: string;
  stage_id: string;
  checklist_template_id: string;
  items: ChecklistItem[];
  is_completed: boolean;
  is_readonly: boolean;
  template_name?: string;
}

interface LeadFunnelProgressBarProps {
  leadId: string;
  boardId: string | null;
  /**
   * Atividade de onde a barra está sendo usada. Vai junto no log do passo
   * (log_checklist_step → metadata.activity_id) pra o detalhe do telão dizer
   * EM QUAL atividade o passo foi marcado. Null quando a barra abre fora de
   * uma atividade (ficha do processo, por ex.).
   */
  activityId?: string | null;
  /**
   * Processo de onde a barra está sendo usada (ficha do processo). Mesma ideia
   * do activityId: registra a ORIGEM da marcação. Só é considerado quando não
   * há atividade — dentro da atividade, quem manda é ela.
   */
  processId?: string | null;
  /**
   * De ONDE veio o POP que a barra está medindo. A barra sozinha só conhece o
   * `boardId` que recebeu — quem sabe se ele é o POP próprio da atividade, o do
   * processo ou o funil do lead é quem monta a barra. Sem isso a tela dizia
   * "herdado" sem dizer herdado de quê.
   */
  origemDoPop?: 'atividade' | 'processo' | 'lead' | null;
}

export function LeadFunnelProgressBar({ leadId, boardId, activityId = null, processId = null, origemDoPop = null }: LeadFunnelProgressBarProps) {
  const { user } = useAuthContext();
  const [stages, setStages] = useState<Stage[]>([]);
  const [currentStageId, setCurrentStageId] = useState<string | null>(null);
  const [instances, setInstances] = useState<ChecklistInstance[]>([]);
  // Ordem projetada dos objetivos por fase: `${stage_id}::${template_id}` → display_order.
  // Sem isso a lista sai por created_at (objetivo novo pula pro topo e o funil
  // parece "começar" no último objetivo adicionado).
  const [linkOrder, setLinkOrder] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState(false);
  const [_loading, setLoading] = useState(true);
  const [viewingStageId, setViewingStageId] = useState<string | null>(null);
  const [isLeadClosed, setIsLeadClosed] = useState(false);
  const [boardName, setBoardName] = useState<string>('');
  const [boardType, setBoardType] = useState<string>('');
  // Resultados possíveis do POP (kanban_boards.settings.resultados) — usados no
  // rótulo do status aplicado pela resposta escolhida.
  const [popResultados, setPopResultados] = useState<{ id: string; label: string }[]>([]);
  // Funil do próprio lead: só nele a fase mora em leads.status (no POP de
  // processo a fase vem do lead_stage_history deste board).
  const [leadBoardId, setLeadBoardId] = useState<string | null>(null);
  // Régua "onde você está": passos já marcados neste POP (últimos 45 dias), pra
  // separar o que foi feito HOJE do que veio de outro dia. Vem por RPC porque a
  // sessão do Externo é anônima e a policy de user_activity_log é por auth.uid().
  const [stepLog, setStepLog] = useState<PopStepLogRow[]>([]);
  // Só mostra a régua quando a RPC respondeu de verdade. Sem isso, ambiente sem
  // a função `pop_steps_log` exibiria "nenhum passo hoje" com passos marcados —
  // erro silencioso é pior que régua ausente.
  const [stepLogReady, setStepLogReady] = useState(false);
  const [catchUpOpen, setCatchUpOpen] = useState(false);
  const [leadName, setLeadName] = useState('');
  const { createLeadInstances, fetchLeadInstances } = useChecklists();

  /**
   * Régua de marcos deste processo. Quando ela tem percentual, é ELA que diz o
   * andamento e a fase — não o passo marcado (decisão do usuário, 12/08/2026:
   * "o percentual do processo atualizar só pelos marcos, não depender de marcar
   * os passos, pq isso pode ser falho"). Sem marco nenhum, tudo segue como era.
   */
  const regua = useProcessoMarcos(processId);

  const fetchData = useCallback(async () => {
    if (!leadId || !boardId) {
      setLoading(false);
      return;
    }

    try {
      const [boardRes, historyRes, leadRes, linksRes, settingsRes, procRes] = await Promise.all([
        externalSupabase.from('kanban_boards').select('stages, board_type, name').eq('id', boardId).maybeSingle(),
        externalSupabase.from('lead_stage_history').select('to_stage').eq('lead_id', leadId).order('changed_at', { ascending: false }).limit(1),
        externalSupabase.from('leads').select('status, lead_status, became_client_date, board_id, lead_name').eq('id', leadId).maybeSingle(),
        externalSupabase.from('checklist_stage_links').select('stage_id, checklist_template_id, display_order').eq('board_id', boardId),
        fromExternalLoose('kanban_boards').select('settings').eq('id', boardId).maybeSingle(),
        // Fase do PROCESSO (escrita pela régua de marcos, ou movida na mão na
        // ficha). O histórico de fase é por LEAD e embaralharia leads com mais
        // de um processo — por isso a fase do processo vem daqui.
        processId
          ? externalSupabase.from('lead_processes').select('workflow_stage_id').eq('id', processId).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      setBoardName((boardRes.data as any)?.name || '');
      setBoardType((boardRes.data as any)?.board_type || '');
      const boardSettings = (settingsRes?.data?.settings || {}) as { resultados?: { id: string; label: string }[] };
      setPopResultados(boardSettings.resultados || []);

      // Mapa da ordem projetada de cada objetivo dentro da fase.
      const orderMap: Record<string, number> = {};
      ((linksRes.data as any[]) || []).forEach(l => {
        orderMap[`${l.stage_id}::${l.checklist_template_id}`] = l.display_order ?? 0;
      });
      setLinkOrder(orderMap);

      // Lead is "closed" only when we're showing its sales funnel (not a process workflow)
      const leadData = leadRes.data as any;
      const boardData = boardRes.data as any;
      const isShowingSalesFunnel = boardData?.board_type !== 'workflow' && leadData?.board_id === boardId;
      const isClosed = isShowingSalesFunnel && (leadData?.lead_status === 'closed' || !!leadData?.became_client_date);
      setIsLeadClosed(isClosed);
      setLeadBoardId(leadData?.board_id || null);
      setLeadName(leadData?.lead_name || '');

      let stageId: string | null = null;
      let parsedStages: Stage[] = [];
      if (boardRes.data?.stages) {
        parsedStages = boardRes.data.stages as unknown as Stage[];
        setStages(parsedStages);
      }

      // Fase do processo manda quando existe: é ela que a régua de marcos
      // escreve (aplicar_fase_por_marco) e a que a ficha do processo edita.
      const faseDoProcesso = (procRes?.data as { workflow_stage_id?: string | null } | null)?.workflow_stage_id;
      if (faseDoProcesso && parsedStages.some(s => s.id === faseDoProcesso)) {
        stageId = faseDoProcesso;
      }

      // Try history first, then fall back to lead.status
      if (!stageId && historyRes.data && historyRes.data.length > 0) {
        stageId = historyRes.data[0].to_stage;
      }
      
      // If no history or stageId doesn't match any board stage, use lead.status
      if (!stageId || !parsedStages.some(s => s.id === stageId)) {
        const leadStatus = leadRes.data?.status;
        if (leadStatus && parsedStages.some(s => s.id === leadStatus)) {
          stageId = leadStatus;
        }
      }

      // For process workflows (board different from lead's funnel), the lead.status
      // belongs to another board and won't match. Default to first stage so the user
      // sees the workflow steps.
      const isWorkflowBoard = (boardData?.board_type === 'workflow') || (leadData?.board_id !== boardId);
      if ((!stageId || !parsedStages.some(s => s.id === stageId)) && isWorkflowBoard && parsedStages.length > 0) {
        stageId = parsedStages[0].id;
      }
      
      if (stageId) {
        setCurrentStageId(stageId);
      }

      // Create instances. For workflow boards, create for ALL stages so every
      // objective/step is visible when navigating between phases.
      if (isWorkflowBoard) {
        for (const s of parsedStages) {
          await createLeadInstances(leadId, boardId, s.id);
        }
      } else if (stageId) {
        await createLeadInstances(leadId, boardId, stageId);
      }

      // Fetch all instances and filter by current board (process workflow vs sales funnel)
      const allInstancesRaw = await fetchLeadInstances(leadId);
      const allInstances = allInstancesRaw.filter(i => i.board_id === boardId);

      if (allInstances.length > 0) {
        const templateIds = [...new Set(allInstances.map(i => i.checklist_template_id))];
        const templateNames: Record<string, string> = {};
        const templateItems: Record<string, SyncItem[]> = {};
        if (templateIds.length > 0) {
          const { data: templates } = await externalSupabase
            .from('checklist_templates')
            .select('id, name, items')
            .in('id', templateIds);
          (templates || []).forEach(t => {
            templateNames[t.id] = t.name;
            templateItems[t.id] = ((t as { items?: unknown }).items as SyncItem[]) || [];
          });
        }

        // Reflete a versão ATUAL do POP nos passos que ainda não foram
        // marcados. Passo já marcado não é reescrito — só ganha o selo de
        // "alterado/removido no POP" (ver src/lib/syncChecklistInstances.ts).
        const synced = allInstances.map(i => {
          const template = templateItems[i.checklist_template_id];
          const current = ((i.items as unknown as SyncItem[]) || []);
          if (!template) return { instance: i, items: current, changed: false, isCompleted: i.is_completed };
          const result = syncInstanceItems(template, current);
          if (result.changed) {
            externalSupabase
              .from('lead_checklist_instances')
              .update({
                items: result.itemsToPersist as any,
                is_completed: result.isCompleted,
              })
              .eq('id', i.id)
              .then(({ error }) => {
                if (error) console.warn('[LeadFunnelProgressBar] sync do POP falhou:', error.message);
              });
          }
          return { instance: i, items: result.items, changed: result.changed, isCompleted: result.isCompleted };
        });

        setInstances(synced.map(({ instance, items, isCompleted }) => ({
          ...instance,
          items: items as unknown as ChecklistItem[],
          is_completed: isCompleted,
          template_name: templateNames[instance.checklist_template_id] || 'Passos',
        })));
      }
    } catch (err) {
      console.error('Error loading funnel progress:', err);
    } finally {
      setLoading(false);
    }
  }, [leadId, boardId, processId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /**
   * Avisa o resto da tela que os passos deste lead mudaram.
   *
   * Todo caminho que grava passo (marcar um, marcar o objetivo em lote, item do
   * checklist do passo, colocar o POP em dia) atualiza `instances` depois do
   * update — então este efeito é o ponto único de saída, sem espalhar chamada
   * por cada gravação. A primeira carga não avisa: ninguém mudou nada ainda.
   */
  const jaCarregou = useRef(false);
  useEffect(() => {
    if (!jaCarregou.current) { jaCarregou.current = true; return; }
    if (!leadId) return;
    notifyPopStepsChanged({ leadId, boardId: boardId || null });
  }, [instances, leadId, boardId]);

  // Todo update de items passa por aqui: os selos popChange/popNewLabel são
  // calculados no load contra o template e NÃO podem ir para o banco.
  const statusLabel = (id?: string) => popResultados.find(r => r.id === id)?.label;

  // Aplica o STATUS do POP no lead (pop_result_id + data) e loga a mudança —
  // mesma regra do WorkflowProgressView e do useChecklists.updateInstanceItem.
  // Fire-and-forget: não bloqueia a marcação nem quebra o fluxo se falhar.
  const applyStatusChange = (setStatusId: string) => {
    (async () => {
      try {
        const { data: lead } = await externalSupabase
          .from('leads')
          .select('pop_result_id')
          .eq('id', leadId)
          .maybeSingle();
        const from = (lead as { pop_result_id?: string | null } | null)?.pop_result_id ?? null;
        if (from === setStatusId) return;
        const today = new Date().toISOString().slice(0, 10);
        await externalSupabase.from('leads').update({ pop_result_id: setStatusId, pop_result_date: today } as never).eq('id', leadId);
        const label = statusLabel(setStatusId);
        if (label) toast.success(`Status do POP: ${label}`);
        if (user?.id) {
          rpcExternal('log_pop_result_change', {
            p_user_id: user.id,
            p_lead_id: leadId,
            p_board_id: boardId,
            p_from: from,
            p_to: setStatusId,
            p_date: today,
          }).then((res: { error?: { message?: string } | null }) => {
            if (res?.error) console.warn('[LeadFunnelProgressBar] log status POP falhou:', res.error.message);
          });
        }
      } catch (e) {
        console.warn('[LeadFunnelProgressBar] aplicar status POP falhou:', e);
      }
    })();
  };

  // Move o lead para a fase de destino da resposta. '__finalize__' cai na fase
  // de fechamento (ou na última). No funil do próprio lead a fase mora em
  // leads.status; no POP de processo só o histórico manda — por isso o
  // lead_stage_history é sempre gravado, com o board deste POP.
  const applyStageRouting = async (destStageId: string) => {
    const isFinalize = destStageId === '__finalize__';
    const closedNames = ['closed', 'fechado', 'done', 'concluído', 'concluido', 'finalizado'];
    const target = isFinalize
      ? (stages.find(s => closedNames.includes(s.id.toLowerCase()) || closedNames.includes(s.name.toLowerCase())) || stages[stages.length - 1])
      : stages.find(s => s.id === destStageId);
    if (!target || target.id === currentStageId) return;

    const fromStage = currentStageId;
    try {
      if (leadBoardId === boardId) {
        await externalSupabase.from('leads').update({ status: target.id } as never).eq('id', leadId);
      }
      await externalSupabase.from('lead_stage_history').insert({
        lead_id: leadId,
        from_stage: fromStage,
        to_stage: target.id,
        from_board_id: boardId,
        to_board_id: boardId,
        changed_by: user?.id || null,
      } as never);
      setCurrentStageId(target.id);
      setViewingStageId(null);
      toast.success(isFinalize ? `Finalizado! Movido para: ${target.name}` : `Movido para: ${target.name}`);
    } catch (e) {
      console.warn('[LeadFunnelProgressBar] mover de fase falhou:', e);
      toast.error('Erro ao mover de fase');
    }
  };

  const itemsForDb = (items: ChecklistItem[]) =>
    JSON.parse(JSON.stringify(stripDisplayFields(items as unknown as SyncItem[])));

  // Conclusão olha só os passos do POP de hoje — o registro do passo antigo
  // (supersededBy) é histórico e não segura nem completa o objetivo.
  const allLiveChecked = (items: ChecklistItem[]) => {
    const live = items.filter(i => !i.supersededBy);
    return live.length > 0 && live.every(i => i.checked);
  };

  /**
   * Marca/desmarca o passo. Marcar CONCLUI o checklist do passo junto: os
   * sub-itens ainda em aberto são marcados em cascata (decisão do usuário em
   * 05/08/2026 — antes o clique não fazia nada, só avisava o que faltava).
   *
   * Ficam de fora, de propósito:
   *   - "não se aplica": já está resolvido, e dizer que foi FEITO seria mentira;
   *   - espelho de resposta: quem marca é a resposta escolhida no passo;
   *   - item-pergunta: marcar é escolher uma resposta, e é dela que saem a fase
   *     de destino e o status do POP — isso ninguém decide por cascata. Com
   *     pergunta em aberto o passo continua travado.
   *
   * Os ids marcados assim ficam em `autoCheckedDocIds`: desmarcar o passo
   * desfaz exatamente esses e preserva o que já tinha sido conferido item a
   * item. A cascata NÃO é logada no ranking do telão (só o passo entra, via
   * log_checklist_step): um clique não pode valer como N conferências — é o
   * que a medição de 31/07/2026 protege (ver src/lib/stepSubitems.ts).
   */
  const handleToggleItem = async (instance: ChecklistInstance, itemId: string) => {
    if (instance.is_readonly) return;

    // Passo-pergunta: concluir é escolher uma resposta (é dela que saem a fase
    // de destino e o status do POP). Desmarcar segue livre e limpa a escolha.
    const target = instance.items.find(it => it.id === itemId);
    if (target?.answers?.length && !target.checked) {
      toast.info('Escolha uma das respostas para concluir este passo');
      return;
    }

    const marcando = !target?.checked;

    // Sub-itens que este clique marca junto (mesma conta que travava o passo:
    // fora os resolvidos e os espelhos de resposta).
    let cascata: DocChecklistItem[] = [];
    if (marcando && target) {
      const pendentes = pendingSubItems(target) as DocChecklistItem[];
      const perguntas = pendentes.filter(d => (d.answers?.length || 0) > 0);
      if (perguntas.length > 0) {
        toast.info(perguntas.length === 1
          ? `Escolha a resposta de "${perguntas[0].label}" para concluir este passo`
          : `Escolha a resposta dos ${perguntas.length} itens-pergunta do checklist para concluir este passo`);
        return;
      }
      cascata = pendentes;
    }
    const cascataIds = new Set(cascata.map(d => d.id));
    const desfeitos = marcando ? 0 : (target?.autoCheckedDocIds?.length || 0);

    const updatedItems = instance.items.map(item => {
      if (item.id !== itemId) return item;

      if (!marcando) {
        // Desmarcar desfaz o que a cascata deste passo marcou e, no
        // passo-pergunta, o espelho que a resposta tinha marcado — a escolha
        // deixou de existir. O que foi conferido na mão continua marcado.
        const auto = new Set(item.autoCheckedDocIds || []);
        const mirrors = item.answers?.length ? mirrorLabelsOf(item) : null;
        const { autoCheckedDocIds: _limpo, ...semCascata } = item;
        const desmarcado: ChecklistItem = {
          ...semCascata,
          checked: false,
          selectedAnswerId: undefined,
        };
        if (item.docChecklist) {
          desmarcado.docChecklist = item.docChecklist.map(d =>
            auto.has(d.id) || mirrors?.has(normalizeLabel(d.label))
              ? { ...d, checked: false }
              : d
          );
        }
        return desmarcado;
      }

      const marcado: ChecklistItem = { ...item, checked: true };
      if (cascataIds.size > 0 && item.docChecklist) {
        marcado.docChecklist = item.docChecklist.map(d =>
          cascataIds.has(d.id) ? { ...d, checked: true } : d
        );
        marcado.autoCheckedDocIds = [...cascataIds];
      }
      return marcado;
    });

    // Ao MARCAR, pergunta antes de gravar: "Cancelar" desiste da marcação
    // inteira (nada é salvo). Desmarcar não pergunta.
    const toggledItem = updatedItems.find(it => it.id === itemId);
    let retroactive = false;
    if (toggledItem?.checked && user?.id) {
      const timing = await askStepTiming();
      if (timing === 'cancel') return;
      retroactive = timing === 'before';
    }

    const { error } = await externalSupabase
      .from('lead_checklist_instances')
      .update({
        items: itemsForDb(updatedItems),
        is_completed: allLiveChecked(updatedItems),
        completed_at: allLiveChecked(updatedItems) ? new Date().toISOString() : null,
      })
      .eq('id', instance.id);

    if (error) {
      toast.error('Erro ao atualizar passo');
      return;
    }

    // Deixa visível o que o clique fez além do passo — marcar (ou desfazer) o
    // checklist em silêncio esconderia trabalho que ninguém conferiu.
    if (cascata.length > 0) {
      toast.success(cascata.length === 1
        ? '1 item do checklist marcado junto com o passo'
        : `${cascata.length} itens do checklist marcados junto com o passo`);
    }
    if (desfeitos > 0) {
      toast.info(desfeitos === 1
        ? '1 item que o passo tinha marcado voltou a ficar em aberto'
        : `${desfeitos} itens que o passo tinha marcado voltaram a ficar em aberto`);
    }

    // #8: loga o passo recém-MARCADO por pessoa (user_activity_log via RPC).
    // Fire-and-forget; só quando marca (não no desmarcar). O timing já foi
    // respondido antes do save (retroativo não conta no ranking).
    if (toggledItem?.checked && user?.id) {
      (externalSupabase as any).rpc('log_checklist_step', {
        p_user_id: user.id,
        p_instance_id: instance.id,
        p_item_label: toggledItem.label,
        p_retroactive: retroactive,
        p_activity_id: activityId,
        p_process_id: processId,
      }).then((res: { error?: { message?: string } | null }) => {
        if (res?.error) console.warn('[LeadFunnelProgressBar] log de passo falhou:', res.error.message);
      });
    }

    setInstances(prev => prev.map(i =>
      i.id === instance.id
        ? { ...i, items: updatedItems, is_completed: allLiveChecked(updatedItems) }
        : i
    ));
  };

  // Marca (ou desmarca) TODOS os passos do objetivo de uma vez. Pergunta uma
  // única vez se todos são de agora ou retroativos e loga cada passo recém-marcado
  // (mesmo RPC do toggle individual, pra não distorcer o ranking do telão).
  const handleMarkAllSteps = async (instance: ChecklistInstance, checked: boolean) => {
    if (instance.is_readonly) return;

    // Fora do marcar/desmarcar todos: registro histórico (supersededBy),
    // passo-pergunta ao MARCAR (a resposta tem que ser escolhida uma a uma) e
    // passo com sub-item em aberto (o checklist do passo tem que ser conferido
    // item a item — src/lib/stepSubitems.ts).
    const candidates = instance.items.filter(it =>
      !it.supersededBy && !!it.checked !== checked && !(checked && it.answers?.length)
    );
    const targets = checked ? candidates.filter(it => !isStepBlockedBySubItems(it)) : candidates;
    const travados = candidates.length - targets.length;
    if (travados > 0) {
      toast.info(travados === 1
        ? '1 passo ficou de fora: tem item de checklist em aberto'
        : `${travados} passos ficaram de fora: têm itens de checklist em aberto`);
    }
    if (targets.length === 0) return;

    // Pergunta uma vez pro lote inteiro, antes de gravar: "Cancelar" desiste
    // de tudo (nenhum passo é marcado).
    let retroactive = false;
    if (checked && user?.id) {
      const timing = await askStepTiming(targets.length);
      if (timing === 'cancel') return;
      retroactive = timing === 'before';
    }

    const targetIds = new Set(targets.map(t => t.id));
    const updatedItems = instance.items.map(item =>
      targetIds.has(item.id)
        ? { ...item, checked, selectedAnswerId: checked ? item.selectedAnswerId : undefined }
        : item
    );

    // Conclusão recalculada dos itens (não é mais `checked` direto): com passo
    // travado por sub-item, o objetivo não fecha só porque clicaram em "marcar
    // todos" — senão fase e objetivo contariam o que o passo não contou.
    const objetivoFechado = allLiveChecked(updatedItems);
    const { error } = await externalSupabase
      .from('lead_checklist_instances')
      .update({
        items: itemsForDb(updatedItems),
        is_completed: objetivoFechado,
        completed_at: objetivoFechado ? new Date().toISOString() : null,
      })
      .eq('id', instance.id);

    if (error) {
      toast.error('Erro ao atualizar passos');
      return;
    }

    setInstances(prev => prev.map(i =>
      i.id === instance.id ? { ...i, items: updatedItems, is_completed: objetivoFechado } : i
    ));

    // Só marcação entra no log (desmarcar segue sem log, igual ao toggle individual).
    if (checked && user?.id) {
      for (const it of targets) {
        (externalSupabase as any).rpc('log_checklist_step', {
          p_user_id: user.id,
          p_instance_id: instance.id,
          p_item_label: it.label,
          p_retroactive: retroactive,
          p_activity_id: activityId,
          p_process_id: processId,
        }).then((res: { error?: { message?: string } | null }) => {
          if (res?.error) console.warn('[LeadFunnelProgressBar] log de passo falhou:', res.error.message);
        });
      }
    }
  };

  // Carrega o log dos passos deste POP (régua "hoje x outro dia"). Silencioso
  // por natureza: se a RPC não existir no ambiente, a régua some — nunca quebra
  // a barra de progresso.
  const instanceIdsKey = useMemo(
    () => instances.map(i => i.id).sort().join(','),
    [instances],
  );
  useEffect(() => {
    const ids = instanceIdsKey ? instanceIdsKey.split(',') : [];
    if (ids.length === 0) { setStepLog([]); setStepLogReady(false); return; }
    let cancelled = false;
    (async () => {
      const res = await rpcExternalRows<PopStepLogRow>('pop_steps_log', {
        p_instance_ids: ids,
        p_days: 45,
      });
      if (cancelled) return;
      if (res?.error) {
        console.warn('[LeadFunnelProgressBar] pop_steps_log indisponível:', res.error.message);
        setStepLog([]);
        setStepLogReady(false);
        return;
      }
      setStepLog(res?.data || []);
      setStepLogReady(true);
    })();
    return () => { cancelled = true; };
  }, [instanceIdsKey]);

  // Resumo da régua: quantos passos foram marcados HOJE (sem contar retroativo,
  // que por definição é trabalho de outro dia) e quando foi a última marcação.
  const stepLogResumo = useMemo(() => {
    const hoje = new Date().toISOString().slice(0, 10);
    const doDia = stepLog.filter(l => !l.retroactive && String(l.marked_at).slice(0, 10) === hoje);
    const labelsHoje = Array.from(new Set(doDia.map(l => l.item_label).filter(Boolean)));
    const anteriores = stepLog.filter(l => !doDia.includes(l));
    const ultima = anteriores[0]?.marked_at ? String(anteriores[0].marked_at).slice(0, 10) : null;
    return { hojeCount: doDia.length, labelsHoje, anterioresCount: anteriores.length, ultima };
  }, [stepLog]);

  /**
   * Marca de uma vez os passos que a IA identificou como já concluídos
   * (PopCatchUpSheet). Mesmo caminho de gravação do "marcar todos": update dos
   * items da instância + log por passo. A diferença é o `retroactive`, que aqui
   * vem por passo — só conta no ranking do telão o que tem evidência de hoje.
   */
  const applyCatchUp = async (marks: PopCatchUpMark[]) => {
    const byInstance = new Map<string, PopCatchUpMark[]>();
    for (const m of marks) {
      const list = byInstance.get(m.instanceId) || [];
      list.push(m);
      byInstance.set(m.instanceId, list);
    }

    let aplicados = 0;
    let falhas = 0;
    for (const [instanceId, list] of byInstance) {
      const instance = instances.find(i => i.id === instanceId);
      if (!instance || instance.is_readonly) { falhas += list.length; continue; }

      const alvo = new Set(list.map(m => m.itemId));
      const updatedItems = instance.items.map(it =>
        alvo.has(it.id) && !it.checked ? { ...it, checked: true } : it
      );
      const objetivoFechado = allLiveChecked(updatedItems);

      const { error } = await externalSupabase
        .from('lead_checklist_instances')
        .update({
          items: itemsForDb(updatedItems),
          is_completed: objetivoFechado,
          completed_at: objetivoFechado ? new Date().toISOString() : null,
        })
        .eq('id', instanceId);

      if (error) {
        console.warn('[LeadFunnelProgressBar] marcar em lote falhou:', error.message);
        falhas += list.length;
        continue;
      }

      aplicados += list.length;
      setInstances(prev => prev.map(i =>
        i.id === instanceId ? { ...i, items: updatedItems, is_completed: objetivoFechado } : i
      ));

      if (user?.id) {
        for (const m of list) {
          rpcExternal('log_checklist_step', {
            p_user_id: user.id,
            p_instance_id: instanceId,
            p_item_label: m.label,
            p_retroactive: m.retroactive,
            p_activity_id: activityId,
            p_process_id: processId,
          }).then(res => {
            if (res?.error) console.warn('[LeadFunnelProgressBar] log de passo falhou:', res.error.message);
          });
        }
      }
    }

    if (aplicados > 0) {
      toast.success(aplicados === 1 ? '1 passo marcado' : `${aplicados} passos marcados`);
      // Régua e progresso vêm do banco: recarrega pra refletir o lote inteiro.
      fetchData();
    }
    if (falhas > 0) {
      toast.error(falhas === 1 ? '1 passo não pôde ser marcado' : `${falhas} passos não puderam ser marcados`);
    }
  };

  /**
   * "Não se aplica" no sub-item: destrava o passo sem afirmar que o item foi
   * feito. É o escape da regra de conferência (src/lib/stepSubitems.ts) — sem
   * ele, item que não cabe no caso travaria o passo e o assessor marcaria tudo
   * só pra sair. NÃO entra no ranking: não é trabalho, é uma decisão sobre o
   * caso. Clicar de novo desfaz.
   *
   * Continua sem botão "Marcar todos" no bloco de sub-itens (removido de
   * propósito: um clique fechava 20 itens e ninguém lia nenhum — 67% dos passos
   * com sub-item eram concluídos sem conferir um só, medido em 31/07/2026). O
   * que existe desde 05/08/2026 é a cascata ao concluir o PASSO, que não conta
   * no ranking — ver handleToggleItem.
   */
  const handleToggleDocNotApplicable = async (instance: ChecklistInstance, itemId: string, docId: string) => {
    if (instance.is_readonly) return;

    const updatedItems = instance.items.map(item => {
      if (item.id !== itemId) return item;
      const docs = (item.docChecklist || []).map(d =>
        d.id === docId
          // Marcar como "não se aplica" limpa a marcação de feito: são
          // respostas concorrentes para o mesmo item.
          ? { ...d, notApplicable: !d.notApplicable, checked: d.notApplicable ? d.checked : false }
          : d
      );
      return { ...item, docChecklist: docs };
    });

    const { error } = await externalSupabase
      .from('lead_checklist_instances')
      .update({ items: itemsForDb(updatedItems) })
      .eq('id', instance.id);

    if (error) {
      toast.error('Erro ao atualizar item do checklist');
      return;
    }

    setInstances(prev => prev.map(i =>
      i.id === instance.id ? { ...i, items: updatedItems } : i
    ));
  };

  // Marca/desmarca um item do checklist ASSOCIADO ao passo (docChecklist).
  // É sub-item: persiste só o doc.checked no JSON de items; NÃO altera a
  // conclusão do passo (is_completed) nem entra no ranking (log_checklist_step).
  const handleToggleDocItem = async (instance: ChecklistInstance, itemId: string, docId: string) => {
    if (instance.is_readonly) return;

    // Estado anterior do sub-item, pra saber se é marcação ou desmarcação e
    // logar por pessoa (entra no ranking do telão como 2º critério).
    const targetDoc = instance.items.find(it => it.id === itemId)?.docChecklist?.find(d => d.id === docId);
    const willBeChecked = !targetDoc?.checked;
    const docLabel = targetDoc?.label || 'Item de checklist';

    // Pergunta: marcar exige escolher a resposta (handleAnswerDocItem).
    if (willBeChecked && targetDoc?.answers?.length) {
      toast.info('Escolha uma das respostas abaixo');
      return;
    }

    // Ao marcar, pergunta antes de gravar; "Cancelar" desiste da marcação.
    let retroactive = false;
    if (willBeChecked && user?.id) {
      const timing = await askStepTiming();
      if (timing === 'cancel') return;
      retroactive = timing === 'before';
    }

    const updatedItems = instance.items.map(item => {
      if (item.id !== itemId) return item;
      const docs = (item.docChecklist || []).map(d =>
        d.id === docId
          ? { ...d, checked: !d.checked, selectedAnswerId: d.checked ? undefined : d.selectedAnswerId }
          : d
      );
      return { ...item, docChecklist: docs };
    });

    const { error } = await externalSupabase
      .from('lead_checklist_instances')
      .update({ items: itemsForDb(updatedItems) })
      .eq('id', instance.id);

    if (error) {
      toast.error('Erro ao atualizar checklist do passo');
      return;
    }

    // #telão: loga a marcação/desmarcação do sub-item por pessoa (RPC grava em
    // user_activity_log no Externo). Fire-and-forget. O timing do MARCAR já foi
    // respondido antes do save; DESMARCAR é sempre "agora" — o ranking conta
    // líquido (marcações - desmarcações).
    if (user?.id) {
      (externalSupabase as any).rpc('log_checklist_doc_item', {
        p_user_id: user.id,
        p_instance_id: instance.id,
        p_doc_label: docLabel,
        p_checked: willBeChecked,
        p_retroactive: retroactive,
      }).then((res: { error?: { message?: string } | null }) => {
        if (res?.error) console.warn('[LeadFunnelProgressBar] log de sub-item falhou:', res.error.message);
      });
    }

    setInstances(prev => prev.map(i =>
      i.id === instance.id ? { ...i, items: updatedItems } : i
    ));
  };

  /**
   * Responde uma PERGUNTA do checklist do passo (doc.answers). Escolher a
   * resposta é o que marca o item — daí sai o destino da fase e o status do
   * POP (a resposta manda; o do item só vale como reserva). Desmarcar limpa a
   * resposta e não desfaz fase/status já aplicados.
   */
  const handleAnswerDocItem = async (
    instance: ChecklistInstance,
    itemId: string,
    doc: DocChecklistItem,
    answer: AnswerOption,
  ) => {
    if (instance.is_readonly) return;

    let retroactive = false;
    if (user?.id) {
      const timing = await askStepTiming();
      if (timing === 'cancel') return;
      retroactive = timing === 'before';
    }

    const updatedItems = instance.items.map(item => {
      if (item.id !== itemId) return item;
      const docs = (item.docChecklist || []).map(d =>
        d.id === doc.id ? { ...d, checked: true, selectedAnswerId: answer.id } : d
      );
      return { ...item, docChecklist: docs };
    });

    const { error } = await externalSupabase
      .from('lead_checklist_instances')
      .update({ items: itemsForDb(updatedItems) })
      .eq('id', instance.id);

    if (error) {
      toast.error('Erro ao registrar a resposta');
      return;
    }

    setInstances(prev => prev.map(i =>
      i.id === instance.id ? { ...i, items: updatedItems } : i
    ));

    if (user?.id) {
      rpcExternal('log_checklist_doc_item', {
        p_user_id: user.id,
        p_instance_id: instance.id,
        p_doc_label: `${doc.label} — ${answer.label}`,
        p_checked: true,
        p_retroactive: retroactive,
      }).then(res => {
        if (res?.error) console.warn('[LeadFunnelProgressBar] log de resposta falhou:', res.error.message);
      });
    }

    const statusToApply = answer.setStatusId || doc.setStatusId;
    if (statusToApply) applyStatusChange(statusToApply);
    const destStage = answer.nextStageId || doc.nextStageId;
    if (destStage) await applyStageRouting(destStage);
  };

  /** Mesma mecânica, quando a pergunta é o PRÓPRIO passo (item.answers). */
  const handleAnswerStep = async (
    instance: ChecklistInstance,
    item: ChecklistItem,
    answer: AnswerOption,
  ) => {
    if (instance.is_readonly) return;

    let retroactive = false;
    if (user?.id) {
      const timing = await askStepTiming();
      if (timing === 'cancel') return;
      retroactive = timing === 'before';
    }

    // A resposta escolhida marca sozinha o item de checklist que a espelha
    // (mesmo rótulo) e desmarca o das outras respostas — é uma escolha só.
    const mirrors = mirrorLabelsOf(item);
    const chosen = normalizeLabel(answer.label);
    const updatedItems = instance.items.map(it => {
      if (it.id !== item.id) return it;
      const docs = (it.docChecklist || []).map(d =>
        mirrors.has(normalizeLabel(d.label)) ? { ...d, checked: normalizeLabel(d.label) === chosen } : d
      );
      return { ...it, checked: true, selectedAnswerId: answer.id, docChecklist: docs };
    });

    const { error } = await externalSupabase
      .from('lead_checklist_instances')
      .update({
        items: itemsForDb(updatedItems),
        is_completed: allLiveChecked(updatedItems),
        completed_at: allLiveChecked(updatedItems) ? new Date().toISOString() : null,
      })
      .eq('id', instance.id);

    if (error) {
      toast.error('Erro ao registrar a resposta');
      return;
    }

    setInstances(prev => prev.map(i =>
      i.id === instance.id
        ? { ...i, items: updatedItems, is_completed: allLiveChecked(updatedItems) }
        : i
    ));

    if (user?.id) {
      rpcExternal('log_checklist_step', {
        p_user_id: user.id,
        p_instance_id: instance.id,
        p_item_label: `${item.label} — ${answer.label}`,
        p_retroactive: retroactive,
        p_activity_id: activityId,
        p_process_id: processId,
      }).then(res => {
        if (res?.error) console.warn('[LeadFunnelProgressBar] log de passo falhou:', res.error.message);
      });
    }

    const statusToApply = answer.setStatusId || item.setStatusId;
    if (statusToApply) applyStatusChange(statusToApply);
    const destStage = answer.nextStageId || item.nextStageId;
    if (destStage) await applyStageRouting(destStage);
  };

  // Objetivos que AINDA existem no POP.
  // Quando um objetivo é removido/recriado no POP (template novo, mesmo nome), a
  // instância antiga do lead continua no banco — e a fase mostrava o objetivo duas
  // vezes (a velha com os passos marcados + a nova zerada). Só entra na tela quem
  // tem link vivo em checklist_stage_links. Guarda: se o mapa de links vier vazio
  // (erro de rede/RLS), não filtra nada — melhor mostrar demais que sumir com tudo.
  const liveInstances = useMemo(() => {
    const hasLinks = Object.keys(linkOrder).length > 0;
    const base = hasLinks
      ? instances.filter(i => linkOrder[`${i.stage_id}::${i.checklist_template_id}`] !== undefined)
      : instances;

    // Dedup defensivo: mesma fase + mesmo template gravado 2x (corrida na criação
    // das instâncias). Fica a que tem mais passos marcados.
    const doneCount = (i: ChecklistInstance) => i.items.filter(it => it.checked).length;
    const byKey = new Map<string, ChecklistInstance>();
    for (const inst of base) {
      const key = `${inst.stage_id}::${inst.checklist_template_id}`;
      const prev = byKey.get(key);
      if (!prev || doneCount(inst) > doneCount(prev)) byKey.set(key, inst);
    }
    return Array.from(byKey.values());
  }, [instances, linkOrder]);

  // Hierarchical progress calculation — if lead is closed, always 100%
  const hierarchicalProgress = useMemo(() => {
    if (isLeadClosed) {
      // Return 100% for all stages when lead is closed
      const stageIds = stages.map(s => s.id);
      const phaseWeight = stageIds.length > 0 ? 100 / stageIds.length : 0;
      return {
        globalPercent: 100,
        stageDetails: stageIds.map(stageId => {
          const stageInstances = liveInstances.filter(i => i.stage_id === stageId);
          return {
            stageId,
            stagePercent: phaseWeight,
            completedPercent: phaseWeight,
            objectives: stageInstances.map(inst => ({
              instanceId: inst.id,
              objectiveWeight: stageInstances.length > 0 ? phaseWeight / stageInstances.length : 0,
              totalSteps: inst.items.length,
              completedSteps: inst.items.length,
              completedPercent: stageInstances.length > 0 ? phaseWeight / stageInstances.length : 0,
            })),
          };
        }),
      };
    }
    const stageIds = stages.map(s => s.id);
    return calculateHierarchicalProgress(stageIds, liveInstances);
  }, [stages, liveInstances, isLeadClosed]);

  const globalPercent = hierarchicalProgress.globalPercent;

  /**
   * ANDAMENTO x TRABALHO — duas medidas, dois donos.
   *
   * Régua de marcos (esta): onde o processo está, lida das movimentações e dos
   * documentos. É a que a barra mostra sempre que existir.
   * Passos marcados (globalPercent): o que a equipe já executou. Continua vivo
   * no percentual de cada objetivo, mais abaixo, e nas metas por time.
   *
   * Sem marco nenhum (POP administrativo, processo sem CNJ, processo novo) a
   * barra volta a ser a de passos — mostrar 0% ali seria dizer que o processo
   * não andou quando o que falta é dado.
   */
  const porMarco = regua.percentual != null;
  const percentExibido = porMarco ? (regua.percentual as number) : globalPercent;

  // Preenchimento de cada fase quando quem manda é a régua: fase anterior à do
  // marco atual fica cheia (o processo passou por ela), a atual mostra a
  // proporção dos marcos dela já atingidos, as seguintes ficam vazias.
  const fillPorMarco = useMemo(() => {
    if (!porMarco) return null;
    const idxAtual = stages.findIndex(s => s.id === (regua.atual?.stage_id ?? null));
    if (idxAtual < 0) return null;
    const mapa: Record<string, number> = {};
    stages.forEach((s, i) => {
      if (i < idxAtual) { mapa[s.id] = 100; return; }
      if (i > idxAtual) { mapa[s.id] = 0; return; }
      const previstos = regua.marcos.filter(m => m.stage_id === s.id && (!m.eventual || m.estado === 'atingido'));
      const cumpridos = previstos.filter(m => m.estado !== 'pendente');
      mapa[s.id] = previstos.length > 0
        ? Math.round((cumpridos.length / previstos.length) * 100)
        : 0;
    });
    return mapa;
  }, [porMarco, regua.marcos, regua.atual, stages]);

  // Marcos PREVISTOS na ordem da régua (obrigatório sempre; eventual só quando
  // aconteceu; estado que atravessa fora) — os segmentos da barra por marco.
  const marcosPrevistos = useMemo(
    () => regua.marcos.filter(m => !m.atravessa_fases && (!m.eventual || m.estado !== 'pendente')),
    [regua.marcos],
  );

  // Determine current stage index
  const currentIdx = stages.findIndex(s => s.id === currentStageId);

  const activeViewStageId = viewingStageId || currentStageId;

  /**
   * Rola até o PASSO ATUAL (1º não-marcado da fase em vista) ao expandir.
   * Depois da unificação do BPC a fase judicial tem 13+ objetivos num painel
   * só — sem a rolagem, achar o passo era caçada (pedido do usuário, 30/08).
   */
  const passoAtualRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!expanded) return;
    const t = setTimeout(() => {
      passoAtualRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    return () => clearTimeout(t);
  }, [expanded, activeViewStageId, instances.length]);

  // Get instances for the viewed stage, na ordem projetada do fluxo (display_order),
  // não na ordem de criação. Órfãos (template sem link na fase) vão pro fim.
  const currentStageInstances = useMemo(() => {
    const orderOf = (i: ChecklistInstance) =>
      linkOrder[`${i.stage_id}::${i.checklist_template_id}`] ?? Number.MAX_SAFE_INTEGER;
    return liveInstances
      .filter(i => i.stage_id === activeViewStageId)
      .slice()
      .sort((a, b) => {
        const diff = orderOf(a) - orderOf(b);
        if (diff !== 0) return diff;
        return ((a as any).created_at || '').localeCompare((b as any).created_at || '');
      });
  }, [liveInstances, activeViewStageId, linkOrder]);

  // 1º passo vivo não-marcado da fase em vista — o alvo da rolagem.
  const primeiroPendenteId = useMemo(() => {
    for (const inst of currentStageInstances) {
      const it = inst.items.find(i => !i.supersededBy && !i.checked);
      if (it) return `${inst.id}|${it.id}`;
    }
    return null;
  }, [currentStageInstances]);

  // Cardápio do "Atualizar passos com IA": TODOS os passos do POP (todas as
  // fases), com fase e objetivo pra IA se localizar. Passo-pergunta e passo com
  // checklist em aberto vão marcados como bloqueados — concluir depende de
  // escolher a resposta ou de conferir item a item, e isso ninguém faz pelo
  // assessor (src/lib/stepSubitems.ts).
  const catchUpSteps = useMemo<PopCatchUpStep[]>(() => {
    const stageName = new Map(stages.map(s => [s.id, s.name]));
    return liveInstances.flatMap(inst =>
      inst.items
        .filter(it => !it.supersededBy)
        .map(it => ({
          instanceId: inst.id,
          itemId: it.id,
          label: it.label,
          description: it.description,
          phase: stageName.get(inst.stage_id) || '—',
          objective: inst.template_name || 'Passos',
          checked: !!it.checked,
          blockedReason: it.answers?.length
            ? 'passo-pergunta'
            : isStepBlockedBySubItems(it)
              ? 'checklist em aberto'
              : undefined,
        }))
    );
  }, [liveInstances, stages]);

  if (!boardId || stages.length === 0) return null;

  return (
    <>
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      {/* Stepper bar — always visible, segments clickable to switch stage view, click toggles expand */}
      <div className="w-full mt-2">
        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1 flex-1 min-w-0"
          >
            {porMarco ? marcosPrevistos.map((m) => {
              // Segmentos por MARCO quando a régua manda (pedido do usuário,
              // 30/08): com o BPC unificado a fase judicial virou UM segmento
              // e escondia a caminhada — os marcos são a medida fina, e são
              // eles que preenchem o percentual. Clique navega para a fase do
              // marco no painel de passos.
              const cheio = m.estado !== 'pendente';
              const ehAtual = !!m.atual;
              return (
                <button
                  key={m.marco_chave}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!expanded) setExpanded(true);
                    if (m.stage_id && stages.some(st => st.id === m.stage_id)) {
                      setViewingStageId(m.stage_id === currentStageId ? null : m.stage_id);
                    }
                  }}
                  className="flex items-center flex-1 relative group/seg"
                  title={`${m.rotulo}${m.data_detectada ? ` · ${formatBRShort(m.data_detectada)}` : ''}${m.estado === 'presumido' ? ' · presumido' : ''}`}
                >
                  <div className={cn(
                    "h-2 w-full rounded-full transition-all",
                    cheio ? (ehAtual ? "bg-primary" : "bg-emerald-500") : "bg-muted-foreground/20",
                    "group-hover/seg:opacity-80"
                  )} />
                  {ehAtual && (
                    <div className="absolute inset-0 rounded-full pointer-events-none ring-2 ring-primary/40" />
                  )}
                </button>
              );
            }) : stages.map((stage, idx) => {
              const stageDetail = hierarchicalProgress.stageDetails.find(d => d.stageId === stage.id);
              const stageWeight = stageDetail?.stagePercent || 0;
              const stageCompleted = stageDetail?.completedPercent || 0;
              const fillPorPasso = stageWeight > 0 ? (stageCompleted / stageWeight) * 100 : 0;
              const fillPercent = fillPorMarco ? (fillPorMarco[stage.id] ?? 0) : fillPorPasso;
              const isStageComplete = fillPercent >= 100;
              const hasPartialProgress = fillPercent > 0 && !isStageComplete;
              const isCurrent = idx === currentIdx;
              const isViewing = stage.id === activeViewStageId;

              const stageObjectives = liveInstances
                .filter(i => i.stage_id === stage.id)
                .map(i => i.template_name)
                .filter(Boolean) as string[];
              const prefix = boardName
                ? `${boardType === 'workflow' ? 'POP' : 'Funil'}: ${boardName}\n`
                : '';
              const objLine = stageObjectives.length > 0
                ? `\n• ${stageObjectives.join('\n• ')}`
                : '';
              const medida = porMarco
                ? `\n(andamento por marco · passos: ${Math.round(fillPorPasso)}%)`
                : '';
              const tooltip = `${prefix}${stage.name} — ${Math.round(fillPercent)}%${medida}${objLine}`;

              return (
                <button
                  key={stage.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!expanded) setExpanded(true);
                    setViewingStageId(stage.id === currentStageId ? null : stage.id);
                  }}
                  className="flex items-center flex-1 relative group/seg"
                  title={tooltip}
                >
                  <div
                    className={cn(
                      "h-2 w-full rounded-full transition-all overflow-hidden",
                      isStageComplete ? "bg-emerald-500" : "bg-muted-foreground/20",
                      "group-hover/seg:opacity-80"
                    )}
                  >
                    {hasPartialProgress && (
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-300"
                        style={{ width: `${fillPercent}%` }}
                      />
                    )}
                  </div>
                  {(isCurrent || isViewing) && !isStageComplete && (
                    <div className={cn(
                      "absolute inset-0 rounded-full pointer-events-none",
                      isViewing ? "ring-2 ring-primary" : "ring-2 ring-primary/40"
                    )} />
                  )}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1.5 text-xs shrink-0 hover:opacity-80 transition-opacity"
            title={porMarco
              ? `Andamento do processo: ${regua.cumpridos} de ${regua.previstos} marcos.\n`
                + `Vem das movimentações e documentos — não depende de marcar passo.\n`
                + `Passos executados neste POP: ${Math.round(globalPercent)}%.`
              : 'Percentual por passos marcados no POP'}
          >
            <span className={cn(
              "font-bold tabular-nums min-w-[34px] text-right",
              percentExibido >= 100 ? "text-emerald-600" : "text-foreground"
            )}>
              {Math.round(percentExibido)}%
            </span>
            {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
        </div>

        {/* Linha de rótulo: POP + fase + marco atual. SEMPRE visível — recolhida
            ou expandida — para o nome do marco nunca sumir (pedido de 30/08).
            O nome do POP entrou em 01/09: a barra mostrava a fase sem dizer de
            qual POP ela é, e o formulário dizia só "herdado", sem dizer de quê. */}
        {(currentStageId || boardName) && (
          <div className="mt-1.5 text-[11px] text-muted-foreground truncate">
            {boardName && (
              <span
                className="mr-1.5"
                title={origemDoPop === 'processo'
                  ? 'POP do processo vinculado a esta atividade'
                  : origemDoPop === 'lead'
                    ? 'A atividade não tem POP próprio: segue o POP/funil do lead'
                    : origemDoPop === 'atividade'
                      ? 'POP escolhido nesta atividade'
                      : undefined}
              >
                {boardType === 'workflow' ? 'POP' : 'Funil'}: <span className="font-medium text-foreground">{boardName}</span>
                {origemDoPop === 'processo' && ' (do processo)'}
                {origemDoPop === 'lead' && ' (herdado do lead)'}
              </span>
            )}
            {currentStageId && (
              <>
                {boardName && <span className="mr-1.5">·</span>}
                <span className="font-medium text-foreground">
                  {stages.find(s => s.id === currentStageId)?.name}
                </span>
                <span className="ml-1.5">· fase {currentIdx + 1} de {stages.length}</span>
              </>
            )}
            {regua.atual && (
              <span className="ml-1.5">
                · {regua.atual.rotulo}
                {regua.atual.data_detectada && ` em ${formatBRShort(regua.atual.data_detectada)}`}
              </span>
            )}
          </div>
        )}
      </div>

      <CollapsibleContent>
        <div className="mt-3 space-y-2 max-h-[320px] overflow-y-auto">
          {/* Stage navigator: prev | current name + position | next */}
          {(() => {
            const viewIdx = stages.findIndex(s => s.id === activeViewStageId);
            const viewStage = stages[viewIdx];
            const goPrev = () => viewIdx > 0 && setViewingStageId(stages[viewIdx - 1].id === currentStageId ? null : stages[viewIdx - 1].id);
            const goNext = () => viewIdx < stages.length - 1 && setViewingStageId(stages[viewIdx + 1].id === currentStageId ? null : stages[viewIdx + 1].id);
            const isViewingCurrent = activeViewStageId === currentStageId;
            return (
              <div className="flex items-center justify-between gap-2 px-1 py-1.5 rounded-md bg-muted/40">
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={viewIdx <= 0}
                  className="p-1 rounded hover:bg-background disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label="Fase anterior"
                >
                  <ChevronUp className="h-4 w-4 -rotate-90" />
                </button>
                <div className="flex-1 min-w-0 text-center">
                  <div className="text-xs font-semibold truncate">{viewStage?.name || '—'}</div>
                  <div className="text-[10px] text-muted-foreground">
                    Fase {viewIdx + 1} de {stages.length}
                    {!isViewingCurrent && <span className="ml-1.5 text-primary">· visualizando</span>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={viewIdx >= stages.length - 1}
                  className="p-1 rounded hover:bg-background disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label="Próxima fase"
                >
                  <ChevronDown className="h-4 w-4 -rotate-90" />
                </button>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="p-1 rounded hover:bg-background text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Minimizar detalhes do fluxo"
                  title="Minimizar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          })()}

          {/* Onde o PROCESSO está, pela régua de marcos — leitura automática das
              movimentações e documentos. Aparece acima dos passos de propósito:
              é o fato do processo; o passo é o trabalho da equipe sobre ele. */}
          {regua.atual && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50/60 px-2 py-1.5 dark:border-emerald-900 dark:bg-emerald-950/30">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] min-w-0 flex-1">
                  <span className="font-semibold text-emerald-800 dark:text-emerald-300">
                    {regua.atual.rotulo}
                  </span>
                  {regua.atual.data_detectada && (
                    <span className="text-emerald-700/80 dark:text-emerald-400/80">
                      {' '}· {formatBRShort(regua.atual.data_detectada)}
                    </span>
                  )}
                  {regua.atual.fonte && (
                    <span className="text-emerald-700/60 dark:text-emerald-400/60">
                      {' '}· {FONTE_LABEL[regua.atual.fonte] || regua.atual.fonte}
                    </span>
                  )}
                </p>
                <span className="shrink-0 text-[10px] text-emerald-700/70 dark:text-emerald-400/70 tabular-nums">
                  {regua.cumpridos}/{regua.previstos} marcos
                </span>
              </div>
              {regua.marcos.some(m => m.estado === 'presumido') && (
                <p className="mt-0.5 text-[9.5px] leading-snug text-emerald-700/60 dark:text-emerald-400/60">
                  Marcos anteriores contam como cumpridos — a movimentação antiga já saiu da janela do Escavador.
                </p>
              )}
            </div>
          )}

          {/* Régua "onde você está": o que foi marcado hoje x em outro dia, e o
              atalho pra conciliar o POP com as movimentações do processo. */}
          <div className="flex items-start justify-between gap-2 px-1">
            <p className="text-[10px] leading-snug text-muted-foreground min-w-0 flex-1">
              {!stepLogReady ? null : stepLogResumo.hojeCount > 0 ? (
                <>
                  <span className="font-medium text-foreground">
                    Hoje: {stepLogResumo.hojeCount} passo{stepLogResumo.hojeCount > 1 ? 's' : ''}
                  </span>
                  {stepLogResumo.labelsHoje.length > 0 && (
                    <span> — {stepLogResumo.labelsHoje.slice(0, 3).join(', ')}
                      {stepLogResumo.labelsHoje.length > 3 && ` +${stepLogResumo.labelsHoje.length - 3}`}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">Nenhum passo marcado hoje</span>
                  {stepLogResumo.anterioresCount > 0 && stepLogResumo.ultima && (
                    <span> — os {stepLogResumo.anterioresCount} últimos são de outro dia (último em{' '}
                      {stepLogResumo.ultima.split('-').reverse().join('/')})
                    </span>
                  )}
                </>
              )}
            </p>
            <button
              type="button"
              onClick={() => setCatchUpOpen(true)}
              className="shrink-0 inline-flex items-center gap-1 rounded border border-violet-200 px-1.5 py-0.5 text-[10px] text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-400 dark:hover:bg-violet-900/20 transition-colors"
              title="A IA lê as movimentações do processo e sugere os passos que já podem ser marcados"
            >
              <Sparkles className="h-3 w-3" /> Atualizar passos
            </button>
          </div>

          {/* Current stage checklists with objective percentages */}
          {currentStageInstances.length > 0 ? (
            currentStageInstances.map(instance => {
              const objDetail = hierarchicalProgress.stageDetails
                .find(d => d.stageId === activeViewStageId)
                ?.objectives.find(o => o.instanceId === instance.id);
              const objPercent = objDetail && objDetail.objectiveWeight > 0
                ? Math.round((objDetail.completedPercent / objDetail.objectiveWeight) * 100)
                : 0;

              // Passos do POP de hoje. O registro do passo antigo aparece na
              // lista, mas não entra na contagem nem no "marcar todos".
              const liveItems = instance.items.filter(i => !i.supersededBy);

              return (
                <div key={instance.id} className="bg-muted/30 rounded-lg p-2 border border-border/50">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-xs font-medium min-w-0 truncate">{instance.template_name}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!instance.is_readonly && liveItems.length > 1 && (() => {
                        const allStepsChecked = liveItems.every(i => i.checked);
                        return (
                          <button
                            type="button"
                            className="text-[10px] text-primary hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMarkAllSteps(instance, !allStepsChecked);
                            }}
                          >
                            {allStepsChecked ? 'Desmarcar todos' : 'Marcar todos'}
                          </button>
                        );
                      })()}
                      <span className="text-[10px] text-muted-foreground">
                        {liveItems.filter(i => i.checked).length}/{liveItems.length}
                      </span>
                      <span className={cn(
                        "text-[10px] font-semibold",
                        objPercent >= 100 ? "text-emerald-600" : "text-primary"
                      )}>
                        {objPercent}%
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {instance.items.map(item => {
                      // Calculate individual step weight
                      const stepWeight = objDetail && objDetail.totalSteps > 0
                        ? (objDetail.objectiveWeight / objDetail.totalSteps)
                        : 0;

                      // Registro do que foi feito antes de o POP mudar: fica
                      // visível como histórico, mas não é marcável nem conta.
                      const isHistory = !!item.supersededBy;

                      return (
                        <div
                          key={item.id}
                          className="space-y-0.5"
                          ref={`${instance.id}|${item.id}` === primeiroPendenteId ? passoAtualRef : undefined}
                        >
                          <label
                            className={cn(
                              "flex items-start gap-2 py-0.5 text-xs rounded px-1 -mx-1",
                              instance.is_readonly || isHistory ? "cursor-default" : "cursor-pointer hover:bg-accent/50",
                              isHistory && "opacity-70",
                            )}
                          >
                            <Checkbox
                              checked={item.checked || false}
                              onCheckedChange={() => handleToggleItem(instance, item.id)}
                              disabled={instance.is_readonly || isHistory}
                              className="mt-0.5"
                            />
                            <div className="flex-1 min-w-0">
                              <span className={cn(item.checked && "line-through text-muted-foreground")}>
                                {item.label}
                              </span>
                              {/* Passo já marcado NÃO é reescrito quando o POP muda —
                                  fica registrado como foi feito, só avisa o que mudou. */}
                              {item.popChange && (
                                <span
                                  className={cn(
                                    "ml-1.5 inline-block align-middle px-1 py-px rounded text-[9px] font-semibold uppercase tracking-wide whitespace-nowrap",
                                    item.popChange === 'alterado'
                                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400"
                                      : "bg-muted text-muted-foreground",
                                  )}
                                  title={
                                    item.popChange === 'removido'
                                      ? 'Este passo não existe mais no POP. Ficou aqui porque já tinha sido marcado.'
                                      : isHistory
                                        ? `Registro do que foi feito antes de o POP mudar. O passo atual${item.popNewLabel ? ` (${item.popNewLabel})` : ''} está logo abaixo, para ser executado.`
                                        : 'O conteúdo deste passo mudou no POP depois que ele foi marcado.'
                                  }
                                >
                                  {POP_CHANGE_LABEL[item.popChange]}
                                </span>
                              )}
                              {item.description && (
                                <p className="text-[10px] text-muted-foreground mt-0.5">{item.description}</p>
                              )}
                              {item.popChange === 'alterado' && item.popNewLabel && (
                                <p className="text-[10px] text-amber-700 dark:text-amber-500 mt-0.5 break-words">
                                  Agora no POP: {item.popNewLabel}
                                </p>
                              )}
                            </div>
                            {stepWeight > 0 && !isHistory && (
                              <span className="text-[9px] text-muted-foreground shrink-0 mt-0.5">
                                {stepWeight.toFixed(1)}%
                              </span>
                            )}
                          </label>

                          {/* Passo-pergunta: concluir = escolher a resposta. */}
                          {(item.answers?.length || 0) > 0 && !item.checked && !isHistory && !instance.is_readonly && (
                            <div className="ml-6 mb-1 flex flex-col gap-1">
                              {item.answers!.map(ans => (
                                <AnswerButton
                                  key={ans.id}
                                  answer={ans}
                                  stages={stages}
                                  statusLabel={statusLabel}
                                  onClick={() => handleAnswerStep(instance, item, ans)}
                                />
                              ))}
                            </div>
                          )}
                          {(item.answers?.length || 0) > 0 && item.checked && (
                            <p className="ml-6 text-[10px] text-purple-600 dark:text-purple-400 break-words">
                              Resposta:{' '}
                              <span className="font-medium">
                                {item.answers!.find(a => a.id === item.selectedAnswerId)?.label || '—'}
                              </span>
                            </p>
                          )}

                          {/* Checklist associado ao passo (documentos/requisitos/etc.):
                              antes nem aparecia aqui — agora é visível e marcável. */}
                          {item.docChecklist && item.docChecklist.length > 0 && (() => {
                            const checklistType = item.docChecklist[0]?.type || 'documentos';
                            const typeInfo = CHECKLIST_TYPES.find(t => t.value === checklistType) || CHECKLIST_TYPES[0];
                            const docDone = item.docChecklist.filter(d => d.checked || d.notApplicable).length;
                            // Itens que repetem as respostas do passo: a escolha da
                            // resposta é que marca (e desmarca) esses.
                            const stepMirrors = mirrorLabelsOf(item);
                            // Só item-pergunta ainda segura o passo: o resto é
                            // marcado em cascata ao concluir (handleToggleItem).
                            const pendentesDoPasso = pendingSubItems(item) as DocChecklistItem[];
                            const travadoPorPergunta = pendentesDoPasso.some(d => (d.answers?.length || 0) > 0);
                            return (
                              <div className="ml-6 p-1.5 rounded bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800/40">
                                <div className="flex items-center justify-between gap-2 mb-0.5">
                                  <div className="flex items-center gap-1 min-w-0">
                                    <ClipboardList className="h-2.5 w-2.5 shrink-0 text-orange-600 dark:text-orange-400" />
                                    <span className="text-[9px] font-semibold text-orange-700 dark:text-orange-400 uppercase tracking-wide truncate">
                                      {typeInfo.icon} {typeInfo.label} · {docDone}/{item.docChecklist.length}
                                    </span>
                                  </div>
                                  {/* Concluir o passo marca o que sobrou aqui (menos
                                      "não se aplica", espelho de resposta e pergunta).
                                      Aviso pra ninguém fechar o passo achando que o
                                      checklist ficou intocado. */}
                                  {!instance.is_readonly && !isHistory && docDone < item.docChecklist.length && (
                                    <span className="text-[9px] shrink-0 text-orange-700/80 dark:text-orange-400/80 whitespace-nowrap">
                                      {travadoPorPergunta ? 'trava o passo' : 'marcados ao concluir o passo'}
                                    </span>
                                  )}
                                </div>
                                <div className="space-y-0.5">
                                  {item.docChecklist.map(doc => {
                                    // Item-pergunta: marcar é escolher uma das respostas —
                                    // é dela que saem a fase de destino e o status do POP.
                                    const docAnswers = doc.answers || [];
                                    const chosenDocAnswer = docAnswers.find(a => a.id === doc.selectedAnswerId);
                                    // Espelho de uma resposta do passo: quem marca é a
                                    // resposta escolhida, não o clique aqui.
                                    const isMirror = stepMirrors.has(normalizeLabel(doc.label));
                                    return (
                                    <div key={doc.id}>
                                    <label
                                      className={cn(
                                        "flex items-center gap-1.5 text-[11px] py-0.5",
                                        instance.is_readonly || isMirror ? "cursor-default" : "cursor-pointer",
                                        isMirror && !doc.checked && "opacity-60",
                                        doc.notApplicable && "opacity-70",
                                      )}
                                      title={isMirror ? 'Marcado pela resposta escolhida no passo' : undefined}
                                    >
                                      <Checkbox
                                        checked={doc.checked || false}
                                        onCheckedChange={() => handleToggleDocItem(instance, item.id, doc.id)}
                                        disabled={instance.is_readonly || isHistory || isMirror || doc.notApplicable}
                                        className="h-3 w-3"
                                      />
                                      <span className={cn((doc.checked || doc.notApplicable) && "line-through text-muted-foreground")}>
                                        {doc.label}
                                      </span>
                                      {doc.notApplicable && (
                                        <span className="px-1 py-px rounded bg-muted text-muted-foreground text-[9px] font-semibold uppercase tracking-wide whitespace-nowrap">
                                          não se aplica
                                        </span>
                                      )}
                                      {doc.popChange === 'removido' && (
                                        <span
                                          className="px-1 py-px rounded bg-muted text-muted-foreground text-[9px] font-semibold uppercase tracking-wide whitespace-nowrap"
                                          title="Este item não existe mais no POP. Ficou aqui porque já tinha sido marcado."
                                        >
                                          {POP_CHANGE_LABEL.removido}
                                        </span>
                                      )}
                                      {/* Escape do item que não cabe neste caso: destrava o passo
                                          sem dizer que foi feito. Não conta como trabalho. */}
                                      {!instance.is_readonly && !isHistory && !isMirror && !doc.checked && (
                                        <button
                                          type="button"
                                          className="ml-auto shrink-0 text-[9px] text-muted-foreground hover:text-foreground hover:underline"
                                          onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleToggleDocNotApplicable(instance, item.id, doc.id);
                                          }}
                                        >
                                          {doc.notApplicable ? 'aplica-se' : 'não se aplica'}
                                        </button>
                                      )}
                                    </label>

                                    {docAnswers.length > 0 && !doc.checked && !doc.notApplicable && !isHistory && !instance.is_readonly && (
                                      <div className="ml-4.5 mt-0.5 mb-1 flex flex-col gap-1">
                                        {docAnswers.map(ans => (
                                          <AnswerButton
                                            key={ans.id}
                                            answer={ans}
                                            stages={stages}
                                            statusLabel={statusLabel}
                                            onClick={() => handleAnswerDocItem(instance, item.id, doc, ans)}
                                          />
                                        ))}
                                      </div>
                                    )}

                                    {docAnswers.length > 0 && doc.checked && (
                                      <p className="ml-5 text-[10px] text-purple-600 dark:text-purple-400 break-words">
                                        Resposta: <span className="font-medium">{chosenDocAnswer?.label || '—'}</span>
                                      </p>
                                    )}
                                    </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">
              Nenhum passo configurado para esta fase
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>

    <PopCatchUpSheet
      open={catchUpOpen}
      onOpenChange={setCatchUpOpen}
      leadId={leadId}
      processId={processId}
      steps={catchUpSteps}
      context={{
        leadName,
        workflowName: boardName,
        currentPhase: stages.find(s => s.id === currentStageId)?.name,
      }}
      onApply={applyCatchUp}
    />
    </>
  );
}

/**
 * Botão de resposta de uma pergunta do POP (passo-pergunta ou item de
 * checklist do passo). Mostra, junto do texto, para onde a resposta leva o
 * processo: a fase de destino e o status do POP que ela aplica — os mesmos
 * selos da visão de fluxo, para o assessor decidir sabendo o efeito.
 */
function AnswerButton({
  answer,
  stages,
  statusLabel,
  onClick,
}: {
  answer: AnswerOption;
  stages: Stage[];
  statusLabel: (id?: string) => string | undefined;
  onClick: () => void;
}) {
  const destName = answer.nextStageId === '__finalize__'
    ? 'Finalizar'
    : stages.find(s => s.id === answer.nextStageId)?.name;
  const status = statusLabel(answer.setStatusId);

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); onClick(); }}
      className="w-full flex items-start justify-between gap-2 rounded border border-border bg-background px-2 py-1 text-left text-[11px] hover:bg-accent/60 transition-colors"
    >
      <span className="min-w-0 break-words">{answer.label}</span>
      <span className="flex items-center gap-1 shrink-0">
        {destName && (
          <span className="px-1 py-px rounded bg-muted text-muted-foreground text-[9px] whitespace-nowrap">
            → {destName}
          </span>
        )}
        {status && (
          <span className="px-1 py-px rounded bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 text-[9px] whitespace-nowrap">
            {status}
          </span>
        )}
      </span>
    </button>
  );
}
