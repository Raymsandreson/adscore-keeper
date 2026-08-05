import { externalSupabase } from '@/integrations/supabase/external-client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db as supabase } from '@/integrations/supabase';
import { toast } from 'sonner';
import {
  ChecklistItem,
  DocChecklistItem,
  TemplateVariation,
  normalizeMessageTemplates,
  serializeMessageTemplates,
} from './useChecklists';

/**
 * Nome da fase quando o `stage_id` da instância não existe mais no board (fase
 * renomeada/removida — 77% das instâncias do POP-BPC e 65% das do Acidente de
 * Trabalho estão nessa situação, medido em ago/2026). O id gerado pelo builder
 * carrega o rótulo original: "captação_e_triagem_1776178507796_awyv".
 * Só converte quando o id TEM esse formato; ids legados curtos ("done", "dm",
 * "whatsapp") viram null — melhor sem a linha do que "Etapa: Done" pro cliente.
 */
export function phaseLabelFromStageId(stageId: string | null | undefined): string | null {
  if (!stageId) return null;
  const m = /^(.+?)_\d{10,}(?:_[a-z0-9]{2,6})?$/i.exec(String(stageId));
  if (!m) return null;
  const raw = m[1].replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Linha de `lead_checklist_instances` como o hook a consulta. */
interface InstanceRow {
  id: string;
  items: ChecklistItem[] | null;
  checklist_template_id: string;
  stage_id: string;
}

export interface StepOption {
  stepId: string;
  stepLabel: string;
  phaseId: string;
  phaseLabel: string | null;
  objectiveLabel: string | null;
  templateId: string;
  instanceId: string;
  checked: boolean;
}

/**
 * De onde o fluxo (fase/objetivo/passo/%) foi resolvido. Regra do usuário
 * (ago/2026): atv com processo → POP do processo; atv sem processo mas com POP
 * próprio → esse POP, e a atv vira a REFERÊNCIA do acompanhamento (o nº dela
 * entra na mensagem); sem nenhum dos dois → funil de vendas do lead.
 */
export type FlowSource = 'processo' | 'atv' | 'funil';

export interface FlowBoardCandidate {
  boardId: string | null | undefined;
  source: FlowSource;
}

export interface ActivityStepContext {
  stepId: string;
  stepLabel: string;
  phaseLabel: string | null;
  objectiveLabel: string | null;
  docChecklist: DocChecklistItem[];
  messageTemplates: Record<string, TemplateVariation[]>;
  totalCount: number;
  completedCount: number;
  templateId: string | null;
  boardId: string | null;
  stageId: string | null;
  /** Qual candidato venceu a cadeia — vira o rótulo/nº de referência na mensagem. */
  source: FlowSource | null;
  // Lista completa de passos do lead nesse board (para troca de passo)
  allSteps: StepOption[];
}

/**
 * `boards` aceita um id só (compatibilidade) ou a CADEIA ordenada de candidatos.
 * Com a cadeia, o primeiro candidato que tiver checklist do lead vence — é assim
 * que a atv linkada a processo mostra o POP do processo, e a atv solta cai pro
 * funil em vez de ficar sem fluxo nenhum na mensagem.
 */
export function useActivityStepContext(
  leadId: string | null | undefined,
  boards: string | null | undefined | FlowBoardCandidate[],
) {
  const candidates: FlowBoardCandidate[] = Array.isArray(boards)
    ? boards.filter(c => !!c.boardId)
    : (boards ? [{ boardId: boards, source: 'atv' as FlowSource }] : []);
  // Chave estável: o array é recriado a cada render e não serve de dependência.
  const candidatesKey = candidates.map(c => `${c.source}:${c.boardId}`).join('|');
  const primaryBoardId = candidates[0]?.boardId || null;

  const [allSteps, setAllSteps] = useState<StepOption[]>([]);
  // Board de onde os passos realmente vieram (pode não ser o primeiro candidato).
  // saveStepFieldTemplates precisa deste, não do pedido.
  const [resolvedBoardId, setResolvedBoardId] = useState<string | null>(null);
  const [resolvedSource, setResolvedSource] = useState<FlowSource | null>(null);
  const [defaultStepId, setDefaultStepId] = useState<string | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const reload = useCallback(() => setReloadTick(t => t + 1), []);

  useEffect(() => {
    if (!leadId || candidates.length === 0) {
      setAllSteps([]);
      setResolvedBoardId(null);
      setResolvedSource(null);
      setDefaultStepId(null);
      setSelectedStepId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Carrega o board (para nomes de fases) e todas as instâncias do lead nesse board
        const loadInstances = (bid: string) =>
          supabase
            .from('lead_checklist_instances')
            .select('items, checklist_template_id, stage_id, id')
            .eq('lead_id', leadId)
            .eq('board_id', bid)
            .order('created_at', { ascending: true });

        const [firstRes, leadRes] = await Promise.all([
          loadInstances(candidates[0].boardId as string),
          externalSupabase.from('leads').select('status, board_id').eq('id', leadId).maybeSingle(),
        ]);

        const leadRow = leadRes.data as { status: string | null; board_id: string | null } | null;
        const currentStageId = leadRow?.status || null;

        // Cadeia: o primeiro candidato COM checklist vence. O funil do lead entra
        // como último recurso mesmo quem chamou não o tendo passado (leadPreview
        // pode não ter carregado) — sem isso a mensagem saía sem fluxo nenhum.
        const chain: FlowBoardCandidate[] = [...candidates];
        if (leadRow?.board_id && !chain.some(c => c.boardId === leadRow.board_id)) {
          chain.push({ boardId: leadRow.board_id, source: 'funil' });
        }

        let effectiveBoardId: string | null = null;
        let effectiveSource: FlowSource | null = null;
        let instances: InstanceRow[] = [];
        for (let i = 0; i < chain.length; i++) {
          const cand = chain[i];
          if (!cand.boardId) continue;
          const rows = i === 0
            ? ((firstRes.data || []) as InstanceRow[])
            : ((await loadInstances(cand.boardId)).data || []) as InstanceRow[];
          if (rows.length > 0) {
            effectiveBoardId = cand.boardId;
            effectiveSource = cand.source;
            instances = rows;
            break;
          }
        }

        if (instances.length === 0 || !effectiveBoardId) {
          if (!cancelled) {
            setAllSteps([]);
            setResolvedBoardId(null);
            setResolvedSource(null);
            setDefaultStepId(null);
          }
          return;
        }

        // Nomes das fases vêm do board de onde as instâncias realmente saíram.
        const stagesRes = await externalSupabase
          .from('kanban_boards').select('stages').eq('id', effectiveBoardId).maybeSingle();
        const stagesRow = stagesRes.data as { stages: Array<{ id: string; name: string }> | null } | null;
        const stages = stagesRow?.stages || [];
        const stageNameById: Record<string, string> = {};
        stages.forEach(s => { stageNameById[s.id] = s.name; });

        // Resolve nomes dos templates (objetivos)
        const templateIds = [...new Set(instances.map(i => i.checklist_template_id).filter(Boolean))];
        const templateNames: Record<string, string> = {};
        if (templateIds.length > 0) {
          const { data: tpls } = await supabase
            .from('checklist_templates')
            .select('id, name')
            .in('id', templateIds);
          ((tpls || []) as Array<{ id: string; name: string }>)
            .forEach(t => { templateNames[t.id] = t.name; });
        }

        // Achata todos os passos
        const steps: StepOption[] = [];
        for (const inst of instances) {
          const items = ((inst.items as ChecklistItem[]) || []);
          for (const it of items) {
            steps.push({
              stepId: it.id,
              stepLabel: it.label,
              phaseId: inst.stage_id,
              phaseLabel: stageNameById[inst.stage_id] || phaseLabelFromStageId(inst.stage_id),
              objectiveLabel: templateNames[inst.checklist_template_id] || null,
              templateId: inst.checklist_template_id,
              instanceId: inst.id,
              checked: !!it.checked,
            });
          }
        }

        // Default = primeiro não-concluído da fase atual; senão primeiro não-concluído geral; senão último
        let defId: string | null = null;
        if (currentStageId) {
          defId = steps.find(s => s.phaseId === currentStageId && !s.checked)?.stepId || null;
        }
        if (!defId) defId = steps.find(s => !s.checked)?.stepId || null;
        if (!defId && steps.length > 0) defId = steps[steps.length - 1].stepId;

        if (!cancelled) {
          setAllSteps(steps);
          setResolvedBoardId(effectiveBoardId);
          setResolvedSource(effectiveSource);
          setDefaultStepId(defId);
        }
      } catch (err) {
        console.warn('[useActivityStepContext]', err);
        if (!cancelled) {
          setAllSteps([]);
          setResolvedBoardId(null);
          setResolvedSource(null);
          setDefaultStepId(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- candidatesKey serializa `candidates`
  }, [leadId, candidatesKey, reloadTick]);

  // Reset seleção manual ao trocar de lead/cadeia de boards
  useEffect(() => { setSelectedStepId(null); }, [leadId, candidatesKey]);

  // Resolve passo ativo — manual ou default
  const activeStep = useMemo<StepOption | null>(() => {
    if (allSteps.length === 0) return null;
    const id = selectedStepId || defaultStepId;
    return allSteps.find(s => s.stepId === id) || allSteps[0];
  }, [allSteps, selectedStepId, defaultStepId]);

  // Carrega docChecklist + messageTemplates do passo ativo (precisa ler items da instância)
  const [activeDetails, setActiveDetails] = useState<{
    docChecklist: DocChecklistItem[];
    messageTemplates: Record<string, TemplateVariation[]>;
  }>({ docChecklist: [], messageTemplates: {} });

  useEffect(() => {
    if (!activeStep) {
      setActiveDetails({ docChecklist: [], messageTemplates: {} });
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('lead_checklist_instances')
        .select('items')
        .eq('id', activeStep.instanceId)
        .maybeSingle();
      const items = ((data?.items as unknown as ChecklistItem[]) || []);
      const it = items.find(i => i.id === activeStep.stepId);
      if (cancelled) return;
      setActiveDetails({
        docChecklist: it?.docChecklist || [],
        messageTemplates: normalizeMessageTemplates(it?.messageTemplates),
      });
    })();
    return () => { cancelled = true; };
  }, [activeStep, reloadTick]);

  const ctx = useMemo<ActivityStepContext | null>(() => {
    if (!activeStep) return null;
    return {
      stepId: activeStep.stepId,
      stepLabel: activeStep.stepLabel,
      phaseLabel: activeStep.phaseLabel,
      objectiveLabel: activeStep.objectiveLabel,
      docChecklist: activeDetails.docChecklist,
      messageTemplates: activeDetails.messageTemplates,
      totalCount: allSteps.length,
      completedCount: allSteps.filter(s => s.checked).length,
      templateId: activeStep.templateId,
      boardId: resolvedBoardId || primaryBoardId,
      stageId: activeStep.phaseId,
      source: resolvedSource,
      allSteps,
    };
  }, [activeStep, activeDetails, allSteps, primaryBoardId, resolvedBoardId, resolvedSource]);

  /**
   * Persiste as variações de um campo do passo ATIVO no template e na instância.
   */
  const saveStepFieldTemplates = useCallback(
    async (fieldKey: string, variations: TemplateVariation[]) => {
      if (!ctx?.templateId || !ctx.stepId) {
        toast.error('Passo atual indisponível para salvar modelo');
        return false;
      }
      try {
        const patchItems = (raw: ChecklistItem[] | null | undefined) =>
          ((raw as ChecklistItem[]) || []).map(it => {
            if (it.id !== ctx.stepId) return it;
            const current = normalizeMessageTemplates(it.messageTemplates);
            current[fieldKey] = variations;
            return { ...it, messageTemplates: serializeMessageTemplates(current) };
          });

        // 1) Atualiza o TEMPLATE
        const { data: tpl, error: fetchErr } = await supabase
          .from('checklist_templates')
          .select('items')
          .eq('id', ctx.templateId)
          .maybeSingle();
        if (fetchErr) throw fetchErr;

        const newTplItems = patchItems(tpl?.items as unknown as ChecklistItem[]);
        const { error: updErr } = await supabase
          .from('checklist_templates')
          .update({ items: JSON.parse(JSON.stringify(newTplItems)) })
          .eq('id', ctx.templateId);
        if (updErr) throw updErr;

        // 2) Atualiza a INSTÂNCIA do lead correspondente
        if (leadId && ctx.boardId && ctx.stageId) {
          const { data: instances } = await supabase
            .from('lead_checklist_instances')
            .select('id, items, checklist_template_id')
            .eq('lead_id', leadId)
            .eq('board_id', ctx.boardId)
            .eq('stage_id', ctx.stageId);
          for (const inst of instances || []) {
            if ((inst as any).checklist_template_id !== ctx.templateId) continue;
            const newInstItems = patchItems((inst as any).items as ChecklistItem[]);
            await supabase
              .from('lead_checklist_instances')
              .update({ items: JSON.parse(JSON.stringify(newInstItems)) })
              .eq('id', (inst as any).id);
          }
        }

        toast.success('Modelo vinculado ao passo!');
        reload();
        return true;
      } catch (err) {
        console.error('[saveStepFieldTemplates]', err);
        toast.error('Erro ao salvar modelo no passo');
        return false;
      }
    },
    [ctx, leadId, reload],
  );

  return {
    stepContext: ctx,
    loading,
    reload,
    saveStepFieldTemplates,
    selectedStepId: activeStep?.stepId || null,
    setSelectedStepId,
  };
}
