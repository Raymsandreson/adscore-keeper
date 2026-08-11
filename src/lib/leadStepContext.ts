// =============================================================================
// Carrega os passos do POP de um lead (fases do board × objetivos do checklist
// × passos) FORA de componente React.
//
// A lógica vivia só dentro do useActivityStepContext, o que deixava quem não é
// componente — o envio do sino de atualizações, por exemplo — sem acesso à
// etapa/objetivo/passo atual e ao progresso. Aqui é uma função async pura de
// I/O; o hook passou a consumi-la, então existe UMA implementação só.
// =============================================================================
import { db } from '@/integrations/supabase';
import type { ChecklistItem } from '@/hooks/useChecklists';

interface InstanciaChecklist {
  id: string;
  stage_id: string;
  checklist_template_id: string;
  items: ChecklistItem[] | null;
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

export interface LeadStepsResult {
  steps: StepOption[];
  /** Passo padrão: 1º não-concluído da fase atual → 1º não-concluído geral → último. */
  defaultStepId: string | null;
  /** status do lead = id da fase (stage) atual no board. */
  currentStageId: string | null;
}

const VAZIO: LeadStepsResult = { steps: [], defaultStepId: null, currentStageId: null };

export async function fetchLeadSteps(
  leadId: string | null | undefined,
  boardId: string | null | undefined,
): Promise<LeadStepsResult> {
  if (!leadId || !boardId) return VAZIO;

  const [boardRes, instancesRes, leadRes] = await Promise.all([
    db.from('kanban_boards').select('stages').eq('id', boardId).maybeSingle(),
    db
      .from('lead_checklist_instances')
      .select('items, checklist_template_id, stage_id, id')
      .eq('lead_id', leadId)
      .eq('board_id', boardId)
      .order('created_at', { ascending: true }),
    db.from('leads').select('status').eq('id', leadId).maybeSingle(),
  ]);

  const stages = (boardRes.data as { stages?: Array<{ id: string; name: string }> } | null)?.stages || [];
  const stageNameById: Record<string, string> = {};
  stages.forEach((s) => { stageNameById[s.id] = s.name; });
  const currentStageId = (leadRes.data as { status?: string } | null)?.status || null;

  const instances = (instancesRes.data || []) as unknown as InstanciaChecklist[];
  if (instances.length === 0) return { ...VAZIO, currentStageId };

  // Resolve nomes dos templates (objetivos)
  const templateIds = [...new Set(instances.map((i) => i.checklist_template_id).filter(Boolean))];
  const templateNames: Record<string, string> = {};
  if (templateIds.length > 0) {
    const { data: tpls } = await db
      .from('checklist_templates')
      .select('id, name')
      .in('id', templateIds);
    (tpls || []).forEach((t) => { templateNames[t.id] = t.name; });
  }

  // Achata todos os passos
  const steps: StepOption[] = [];
  for (const inst of instances) {
    const items = inst.items || [];
    for (const it of items) {
      steps.push({
        stepId: it.id,
        stepLabel: it.label,
        phaseId: inst.stage_id,
        phaseLabel: stageNameById[inst.stage_id] || null,
        objectiveLabel: templateNames[inst.checklist_template_id] || null,
        templateId: inst.checklist_template_id,
        instanceId: inst.id,
        checked: !!it.checked,
      });
    }
  }

  let defaultStepId: string | null = null;
  if (currentStageId) {
    defaultStepId = steps.find((s) => s.phaseId === currentStageId && !s.checked)?.stepId || null;
  }
  if (!defaultStepId) defaultStepId = steps.find((s) => !s.checked)?.stepId || null;
  if (!defaultStepId && steps.length > 0) defaultStepId = steps[steps.length - 1].stepId;

  return { steps, defaultStepId, currentStageId };
}
