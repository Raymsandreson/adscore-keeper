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
import { resolverResponsavel, resolverResponsavelComCargos, type OrigemResponsavel } from '@/lib/popResponsavel';
import { fetchCargoMap } from '@/lib/popCargo';

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
  /**
   * Dono do passo já resolvido pela cascata passo → objetivo → fase → processo
   * (src/lib/popResponsavel.ts). É id do Externo, o mesmo espaço de
   * profiles.user_id e de leads.processual_responsible_id.
   *
   * Ficava de fora: os três níveis existem no banco desde 08/08/2026, o
   * resolverResponsavel foi escrito junto com 7 testes — e ninguém no app
   * chamava. O passo saía daqui sem dono, então nada a jusante conseguia
   * perguntar "de quem é este passo?".
   */
  assigneeId: string | null;
  /** De qual nível o nome veio — "herdado da fase" precisa aparecer diferente. */
  assigneeOrigem: OrigemResponsavel;
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

  const [boardRes, instancesRes, leadRes, linksRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).from('kanban_boards').select('stages, notificacoes_assignee_id, settings').eq('id', boardId).maybeSingle(),
    db
      .from('lead_checklist_instances')
      .select('items, checklist_template_id, stage_id, id')
      .eq('lead_id', leadId)
      .eq('board_id', boardId)
      .order('created_at', { ascending: true }),
    db.from('leads').select('status, processual_responsible_id').eq('id', leadId).maybeSingle(),
    // Responsável do objetivo mora no LINK, não no template: o mesmo
    // "Protocolo e citação" existe no trabalhista e no cível com donos
    // diferentes, e só o link conhece a combinação (POP, fase, objetivo).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any)
      .from('checklist_stage_links')
      .select('checklist_template_id, stage_id, assignee_id')
      .eq('board_id', boardId),
  ]);

  const board = boardRes.data as {
    stages?: Array<{ id: string; name: string; assigneeId?: string | null; assigneeCargo?: string | null }>;
    notificacoes_assignee_id?: string | null;
    settings?: { responsible_team_id?: string | null; objetivo_cargos?: Record<string, string> } | null;
  } | null;
  const stages = board?.stages || [];
  // Último degrau nomeado da cascata: quem recebe as notificações deste POP.
  const responsavelDoPop = board?.notificacoes_assignee_id || null;
  const stageNameById: Record<string, string> = {};
  const stageAssigneeById: Record<string, string | null> = {};
  const stageCargoById: Record<string, string | null> = {};
  stages.forEach((s) => {
    stageNameById[s.id] = s.name;
    stageAssigneeById[s.id] = s.assigneeId ?? null;
    stageCargoById[s.id] = s.assigneeCargo ?? null;
  });
  // Responsável por CARGO: o time vinculado ao POP traduz cargo → pessoa na
  // hora (src/lib/popCargo.ts). Sem time, o mapa é vazio e cada nível com só
  // cargo desce a cascata.
  const cargoMap = await fetchCargoMap(board?.settings?.responsible_team_id || null);
  const objetivoCargos = board?.settings?.objetivo_cargos || {};
  const lead = leadRes.data as { status?: string; processual_responsible_id?: string | null } | null;
  const currentStageId = lead?.status || null;
  const responsavelDoProcesso = lead?.processual_responsible_id || null;

  // Chave (fase, objetivo) → dono do objetivo naquela fase deste POP.
  const objetivoAssignee: Record<string, string | null> = {};
  for (const l of ((linksRes as { data?: Array<{ checklist_template_id: string; stage_id: string; assignee_id: string | null }> })?.data || [])) {
    objetivoAssignee[`${l.stage_id}|${l.checklist_template_id}`] = l.assignee_id;
  }

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
      const { assigneeId, origem } = resolverResponsavelComCargos(
        {
          passo: it.assigneeId,
          objetivo: objetivoAssignee[`${inst.stage_id}|${inst.checklist_template_id}`],
          fase: stageAssigneeById[inst.stage_id],
          processo: responsavelDoProcesso,
          pop: responsavelDoPop,
        },
        {
          passo: it.assigneeCargo,
          objetivo: objetivoCargos[`${inst.stage_id}|${inst.checklist_template_id}`],
          fase: stageCargoById[inst.stage_id],
        },
        cargoMap.membroPorCargo,
      );
      steps.push({
        stepId: it.id,
        stepLabel: it.label,
        phaseId: inst.stage_id,
        phaseLabel: stageNameById[inst.stage_id] || null,
        objectiveLabel: templateNames[inst.checklist_template_id] || null,
        templateId: inst.checklist_template_id,
        instanceId: inst.id,
        checked: !!it.checked,
        assigneeId,
        assigneeOrigem: origem,
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

export interface PassoAberto {
  /** Id do Externo de quem responde pelo passo. Null quando ninguém foi designado. */
  assigneeId: string | null;
  origem: OrigemResponsavel;
  stepLabel: string | null;
  phaseLabel: string | null;
}

/**
 * Quem responde pelo passo que está EM ABERTO agora neste processo.
 *
 * "Em aberto" é o mesmo defaultStepId do resto do app: 1º não-concluído da fase
 * atual → 1º não-concluído geral → último. Manter a mesma régua importa porque
 * o passo que o sino usa para avisar tem que ser o mesmo que a ficha mostra;
 * duas definições de "passo atual" seriam duas verdades.
 *
 * SEM PASSO NÃO SIGNIFICA SEM DONO. Processo sem POP, ou com POP mas sem
 * checklist instanciado, ainda tem os dois últimos degraus: o responsável do
 * lead e o responsável de notificações do POP. Devolver null aqui deixaria
 * justamente esses casos — que são a maioria hoje — fora do aviso, e o degrau
 * do POP nunca alcançaria quem ele foi criado para atender.
 *
 * Nunca devolve null: sem ninguém em degrau algum, volta origem 'nenhum', e
 * quem chama decide (no sino, é avisar todo mundo).
 */
export async function responsavelDoPassoAberto(
  processId: string | null | undefined,
  leadId: string | null | undefined,
): Promise<PassoAberto> {
  const SEM_NINGUEM: PassoAberto = {
    assigneeId: null, origem: 'nenhum', stepLabel: null, phaseLabel: null,
  };
  if (!leadId) return SEM_NINGUEM;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = db as any;
  const [procRes, leadRes] = await Promise.all([
    processId
      ? client.from('lead_processes').select('workflow_id').eq('id', processId).maybeSingle()
      : Promise.resolve({ data: null }),
    client.from('leads').select('board_id, processual_responsible_id').eq('id', leadId).maybeSingle(),
  ]);

  const responsavelDoProcesso = leadRes?.data?.processual_responsible_id || null;
  const boardId = procRes?.data?.workflow_id || leadRes?.data?.board_id || null;

  if (boardId) {
    const { steps, defaultStepId } = await fetchLeadSteps(leadId, boardId);
    const passo = steps.find((s) => s.stepId === defaultStepId);
    if (passo) {
      return {
        assigneeId: passo.assigneeId,
        origem: passo.assigneeOrigem,
        stepLabel: passo.stepLabel,
        phaseLabel: passo.phaseLabel,
      };
    }
  }

  // Sem passo: sobram os dois últimos degraus. O do POP só é lido quando há
  // board — sem board não existe POP de onde tirar responsável.
  let responsavelDoPop: string | null = null;
  if (boardId) {
    const { data } = await client
      .from('kanban_boards').select('notificacoes_assignee_id').eq('id', boardId).maybeSingle();
    responsavelDoPop = data?.notificacoes_assignee_id || null;
  }

  const { assigneeId, origem } = resolverResponsavel({
    processo: responsavelDoProcesso,
    pop: responsavelDoPop,
  });
  return { assigneeId, origem, stepLabel: null, phaseLabel: null };
}
