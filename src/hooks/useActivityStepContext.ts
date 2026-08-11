import { useCallback, useEffect, useMemo, useState } from 'react';
import { db as supabase } from '@/integrations/supabase';
import { toast } from 'sonner';
import { fetchLeadSteps, type StepOption } from '@/lib/leadStepContext';
import {
  ChecklistItem,
  DocChecklistItem,
  TemplateVariation,
  normalizeMessageTemplates,
  serializeMessageTemplates,
} from './useChecklists';

export type { StepOption };

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
  // Lista completa de passos do lead nesse board (para troca de passo)
  allSteps: StepOption[];
}

export function useActivityStepContext(
  leadId: string | null | undefined,
  boardId: string | null | undefined,
) {
  const [allSteps, setAllSteps] = useState<StepOption[]>([]);
  const [defaultStepId, setDefaultStepId] = useState<string | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const reload = useCallback(() => setReloadTick(t => t + 1), []);

  useEffect(() => {
    if (!leadId || !boardId) {
      setAllSteps([]);
      setDefaultStepId(null);
      setSelectedStepId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { steps, defaultStepId: defId } = await fetchLeadSteps(leadId, boardId);
        if (!cancelled) {
          setAllSteps(steps);
          setDefaultStepId(defId);
        }
      } catch (err) {
        console.warn('[useActivityStepContext]', err);
        if (!cancelled) {
          setAllSteps([]);
          setDefaultStepId(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [leadId, boardId, reloadTick]);

  // Reset seleção manual ao trocar de lead/board
  useEffect(() => { setSelectedStepId(null); }, [leadId, boardId]);

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
      boardId: boardId || null,
      stageId: activeStep.phaseId,
      allSteps,
    };
  }, [activeStep, activeDetails, allSteps, boardId]);

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
