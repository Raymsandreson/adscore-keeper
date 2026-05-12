import { useCallback, useEffect, useState } from 'react';
import { db as supabase } from '@/integrations/supabase';
import { toast } from 'sonner';
import {
  ChecklistItem,
  DocChecklistItem,
  TemplateVariation,
  normalizeMessageTemplates,
  serializeMessageTemplates,
} from './useChecklists';

export interface ActivityStepContext {
  stepId: string;
  stepLabel: string;
  phaseLabel: string | null;
  objectiveLabel: string | null;
  docChecklist: DocChecklistItem[];
  messageTemplates: Record<string, TemplateVariation[]>; // por field_key
  totalCount: number;
  completedCount: number;
  // Origem da persistência (necessária para salvar novos modelos no passo)
  templateId: string | null;
  boardId: string | null;
  stageId: string | null;
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
  const [reloadTick, setReloadTick] = useState(0);

  const reload = useCallback(() => setReloadTick(t => t + 1), []);

  useEffect(() => {
    if (!leadId || !boardId) {
      setCtx(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
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

        const { data: instances } = await supabase
          .from('lead_checklist_instances')
          .select('items, is_completed, checklist_template_id')
          .eq('lead_id', leadId)
          .eq('board_id', boardId)
          .eq('stage_id', stageId)
          .order('created_at', { ascending: true });

        if (!instances || instances.length === 0) {
          if (!cancelled) setCtx(null);
          return;
        }

        // Achata todos os itens (passos) das instâncias e mantém origem
        const allSteps: { item: ChecklistItem; templateId: string }[] = [];
        for (const inst of instances) {
          const items = (inst.items as unknown as ChecklistItem[]) || [];
          for (const it of items) {
            allSteps.push({ item: it, templateId: (inst as any).checklist_template_id });
          }
        }
        if (allSteps.length === 0) {
          if (!cancelled) setCtx(null);
          return;
        }
        const completedCount = allSteps.filter(s => s.item.checked).length;
        const active = allSteps.find(s => !s.item.checked) || allSteps[allSteps.length - 1];

        // Resolve fase (stage do board) e objetivo (template do passo ativo)
        const [boardRes, templateRes] = await Promise.all([
          supabase.from('kanban_boards').select('stages').eq('id', boardId).maybeSingle(),
          supabase.from('checklist_templates').select('name').eq('id', active.templateId).maybeSingle(),
        ]);
        const stages = ((boardRes.data as any)?.stages || []) as Array<{ id: string; name: string }>;
        const phaseLabel = stages.find(s => s.id === stageId)?.name || null;
        const objectiveLabel = (templateRes.data as any)?.name || null;

        if (!cancelled) {
          setCtx({
            stepId: active.item.id,
            stepLabel: active.item.label,
            phaseLabel,
            objectiveLabel,
            docChecklist: active.item.docChecklist || [],
            messageTemplates: normalizeMessageTemplates(active.item.messageTemplates),
            totalCount: allSteps.length,
            completedCount,
            templateId: active.templateId,
            boardId,
            stageId,
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
  }, [leadId, boardId, reloadTick]);

  /**
   * Persiste as variações de um campo (field_key) do passo atual diretamente
   * no `checklist_templates.items[*].messageTemplates[fieldKey]`.
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

        // 1) Atualiza o TEMPLATE (fonte) — afeta novos leads
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

        // 2) Atualiza a INSTÂNCIA ativa do lead (snapshot que a UI lê)
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

  return { stepContext: ctx, loading, reload, saveStepFieldTemplates };
}
