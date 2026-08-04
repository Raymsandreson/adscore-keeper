import { useState, useEffect, useCallback, useMemo } from 'react';

import { externalSupabase } from '@/integrations/supabase/external-client';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { ChevronDown, ChevronUp, X, ClipboardList } from 'lucide-react';
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
import { isStepBlockedBySubItems, pendingSubItemsMessage } from '@/lib/stepSubitems';

interface Stage {
  id: string;
  name: string;
  color: string;
}

/** RPCs do Externo que não estão nos tipos gerados (log_*, etc.). */
type RpcResult = { error?: { message?: string } | null };
const rpcExternal = (fn: string, args: Record<string, unknown>): PromiseLike<RpcResult> =>
  (externalSupabase.rpc as unknown as (f: string, a: Record<string, unknown>) => PromiseLike<RpcResult>)(fn, args);

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
}

export function LeadFunnelProgressBar({ leadId, boardId, activityId = null }: LeadFunnelProgressBarProps) {
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
  // Status possíveis do POP (kanban_boards.settings.resultados) — usados no
  // rótulo do status aplicado pela resposta escolhida.
  const [popResultados, setPopResultados] = useState<{ id: string; label: string }[]>([]);
  // Funil do próprio lead: só nele a fase mora em leads.status (no POP de
  // processo a fase vem do lead_stage_history deste board).
  const [leadBoardId, setLeadBoardId] = useState<string | null>(null);
  const { createLeadInstances, fetchLeadInstances } = useChecklists();

  const fetchData = useCallback(async () => {
    if (!leadId || !boardId) {
      setLoading(false);
      return;
    }

    try {
      const [boardRes, historyRes, leadRes, linksRes, settingsRes] = await Promise.all([
        externalSupabase.from('kanban_boards').select('stages, board_type, name').eq('id', boardId).maybeSingle(),
        externalSupabase.from('lead_stage_history').select('to_stage').eq('lead_id', leadId).order('changed_at', { ascending: false }).limit(1),
        externalSupabase.from('leads').select('status, lead_status, became_client_date, board_id').eq('id', leadId).maybeSingle(),
        externalSupabase.from('checklist_stage_links').select('stage_id, checklist_template_id, display_order').eq('board_id', boardId),
        fromExternalLoose('kanban_boards').select('settings').eq('id', boardId).maybeSingle(),
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

      let stageId: string | null = null;
      let parsedStages: Stage[] = [];
      if (boardRes.data?.stages) {
        parsedStages = boardRes.data.stages as unknown as Stage[];
        setStages(parsedStages);
      }

      // Try history first, then fall back to lead.status
      if (historyRes.data && historyRes.data.length > 0) {
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
  }, [leadId, boardId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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

  const handleToggleItem = async (instance: ChecklistInstance, itemId: string) => {
    if (instance.is_readonly) return;

    // Passo-pergunta: concluir é escolher uma resposta (é dela que saem a fase
    // de destino e o status do POP). Desmarcar segue livre e limpa a escolha.
    const target = instance.items.find(it => it.id === itemId);
    if (target?.answers?.length && !target.checked) {
      toast.info('Escolha uma das respostas para concluir este passo');
      return;
    }

    // Sub-item em aberto trava o passo (src/lib/stepSubitems.ts). Item que não
    // cabe no caso sai do caminho pelo "não se aplica", não pela marcação falsa.
    if (!target?.checked && isStepBlockedBySubItems(target)) {
      toast.info(pendingSubItemsMessage(target));
      return;
    }

    // Desmarcar a pergunta desfaz também o item de checklist que a resposta
    // tinha marcado — a escolha deixou de existir.
    const updatedItems = instance.items.map(item => {
      if (item.id !== itemId) return item;
      const undoing = !!item.checked && !!item.answers?.length;
      const mirrors = undoing ? mirrorLabelsOf(item) : null;
      return {
        ...item,
        checked: !item.checked,
        selectedAnswerId: item.checked ? undefined : item.selectedAnswerId,
        docChecklist: mirrors
          ? (item.docChecklist || []).map(d =>
              mirrors.has(normalizeLabel(d.label)) ? { ...d, checked: false } : d
            )
          : item.docChecklist,
      };
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
        }).then((res: { error?: { message?: string } | null }) => {
          if (res?.error) console.warn('[LeadFunnelProgressBar] log de passo falhou:', res.error.message);
        });
      }
    }
  };

  /**
   * "Não se aplica" no sub-item: destrava o passo sem afirmar que o item foi
   * feito. É o escape da regra de conferência (src/lib/stepSubitems.ts) — sem
   * ele, item que não cabe no caso travaria o passo e o assessor marcaria tudo
   * só pra sair. NÃO entra no ranking: não é trabalho, é uma decisão sobre o
   * caso. Clicar de novo desfaz.
   *
   * Substituiu o "Marcar todos" dos sub-itens (removido de propósito): enquanto
   * um clique fechava os 20 itens de uma vez, ninguém lia nenhum — 67% dos
   * passos com sub-item eram concluídos sem conferir um só (medido em 31/07/2026).
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

  // Determine current stage index
  const currentIdx = stages.findIndex(s => s.id === currentStageId);

  const activeViewStageId = viewingStageId || currentStageId;

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

  if (!boardId || stages.length === 0) return null;

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      {/* Stepper bar — always visible, segments clickable to switch stage view, click toggles expand */}
      <div className="w-full mt-2">
        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1 flex-1 min-w-0"
          >
            {stages.map((stage, idx) => {
              const stageDetail = hierarchicalProgress.stageDetails.find(d => d.stageId === stage.id);
              const stageWeight = stageDetail?.stagePercent || 0;
              const stageCompleted = stageDetail?.completedPercent || 0;
              const fillPercent = stageWeight > 0 ? (stageCompleted / stageWeight) * 100 : 0;
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
              const tooltip = `${prefix}${stage.name} — ${Math.round(fillPercent)}%${objLine}`;

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
          >
            <span className={cn(
              "font-bold tabular-nums min-w-[34px] text-right",
              globalPercent >= 100 ? "text-emerald-600" : "text-foreground"
            )}>
              {Math.round(globalPercent)}%
            </span>
            {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
        </div>

        {/* Single label line — current stage only when collapsed */}
        {!expanded && currentStageId && (
          <div className="mt-1.5 text-[11px] text-muted-foreground truncate">
            <span className="font-medium text-foreground">
              {stages.find(s => s.id === currentStageId)?.name}
            </span>
            <span className="ml-1.5">· fase {currentIdx + 1} de {stages.length}</span>
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
                        <div key={item.id} className="space-y-0.5">
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
                            return (
                              <div className="ml-6 p-1.5 rounded bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800/40">
                                <div className="flex items-center justify-between gap-2 mb-0.5">
                                  <div className="flex items-center gap-1 min-w-0">
                                    <ClipboardList className="h-2.5 w-2.5 shrink-0 text-orange-600 dark:text-orange-400" />
                                    <span className="text-[9px] font-semibold text-orange-700 dark:text-orange-400 uppercase tracking-wide truncate">
                                      {typeInfo.icon} {typeInfo.label} · {docDone}/{item.docChecklist.length}
                                    </span>
                                  </div>
                                  {/* Sem "marcar todos" aqui, de propósito: o passo só
                                      fecha com o checklist conferido item a item —
                                      o que não couber no caso vai em "não se aplica". */}
                                  {!instance.is_readonly && !isHistory && docDone < item.docChecklist.length && (
                                    <span className="text-[9px] shrink-0 text-orange-700/80 dark:text-orange-400/80 whitespace-nowrap">
                                      trava o passo
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
