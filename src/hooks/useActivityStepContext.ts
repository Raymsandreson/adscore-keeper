import { useEffect, useState } from 'react';
import { db as supabase } from '@/integrations/supabase';
import {
  ChecklistItem,
  DocChecklistItem,
  TemplateVariation,
  normalizeMessageTemplates,
} from './useChecklists';

export interface ActivityStepContext {
  stepId: string;
  stepLabel: string;
  docChecklist: DocChecklistItem[];
  messageTemplates: Record<string, TemplateVariation[]>; // por field_key
  totalCount: number;
  completedCount: number;
}

/**
 * Resolve o "passo atual" de uma atividade a partir do lead + board (funil ou
 * workflow do processo). Retorna o primeiro passo não concluído da instância
 * de checklist que combina com o stage atual do lead.
 */
export function useActivityStepContext(
  leadId: string | null | undefined,
  boardId: string | null | undefined,
) {
  const [ctx, setCtx] = useState<ActivityStepContext | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!leadId || !boardId) {
      setCtx(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // 1) stage atual do lead
        const { data: leadData } = await supabase
          .from('leads')
          .select('status')
          .eq('id', leadId)
          .maybeSingle();
        const stageId = (leadData as { status?: string } | null)?.status;
        if (!stageId) {
          if (!cancelled) setCtx(null);
          return;
        }

        // 2) instâncias de checklist deste lead/board/stage
        const { data: instances } = await supabase
          .from('lead_checklist_instances')
          .select('items, is_completed')
          .eq('lead_id', leadId)
          .eq('board_id', boardId)
          .eq('stage_id', stageId)
          .order('created_at', { ascending: true });

        if (!instances || instances.length === 0) {
          if (!cancelled) setCtx(null);
          return;
        }

        // Achata todos os itens (passos) das instâncias
        const allSteps: ChecklistItem[] = [];
        for (const inst of instances) {
          const items = (inst.items as unknown as ChecklistItem[]) || [];
          allSteps.push(...items);
        }
        if (allSteps.length === 0) {
          if (!cancelled) setCtx(null);
          return;
        }
        const completedCount = allSteps.filter(s => s.checked).length;
        const activeStep = allSteps.find(s => !s.checked) || allSteps[allSteps.length - 1];

        if (!cancelled) {
          setCtx({
            stepId: activeStep.id,
            stepLabel: activeStep.label,
            docChecklist: activeStep.docChecklist || [],
            messageTemplates: normalizeMessageTemplates(activeStep.messageTemplates),
            totalCount: allSteps.length,
            completedCount,
          });
        }
      } catch (err) {
        console.warn('[useActivityStepContext]', err);
        if (!cancelled) setCtx(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId, boardId]);

  return { stepContext: ctx, loading };
}
