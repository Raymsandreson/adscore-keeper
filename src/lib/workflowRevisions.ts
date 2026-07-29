/**
 * Revisões de POP/Funil — histórico estilo "lei consolidada".
 *
 * Cada revisão guarda a foto completa do fluxo (snapshot) + quem/quando/motivo
 * + o diff resumido em relação à revisão anterior. Tabela `workflow_revisions`
 * no Supabase EXTERNO; escrita só via RPC `create_workflow_revision`.
 */
import { db, ensureExternalSession } from '@/integrations/supabase';
import type { ChecklistItem } from '@/hooks/useChecklists';

// ─────────── Snapshot ───────────

export interface SnapshotObjective {
  templateId?: string;
  name: string;
  description: string;
  is_mandatory: boolean;
  items: ChecklistItem[];
}

export interface SnapshotPhase {
  stageId: string;
  stageName: string;
  stageColor: string;
  stagnationDays?: number;
  objectives: SnapshotObjective[];
}

export interface WorkflowSnapshot {
  name: string;
  description: string;
  resultados?: { id: string; label: string; marco?: string | null }[];
  resultadoEsperadoIds?: string[];
  phases: SnapshotPhase[];
}

/** Monta o snapshot canônico a partir do estado do editor (descarta isExpanded etc.). */
export function buildWorkflowSnapshot(
  name: string,
  description: string,
  resultados: { id: string; label: string; marco?: string | null }[],
  resultadoEsperadoIds: string[],
  phases: Array<{
    stageId: string; stageName: string; stageColor: string; stagnationDays?: number;
    objectives: Array<{ templateId?: string; name: string; description: string; is_mandatory: boolean; items: ChecklistItem[] }>;
  }>,
): WorkflowSnapshot {
  return {
    name: name.trim(),
    description: description.trim(),
    resultados: resultados.map(r => ({ id: r.id, label: r.label, marco: r.marco ?? null })),
    resultadoEsperadoIds: [...resultadoEsperadoIds],
    phases: phases.map(p => ({
      stageId: p.stageId,
      stageName: p.stageName,
      stageColor: p.stageColor,
      stagnationDays: p.stagnationDays,
      objectives: p.objectives.map(o => ({
        templateId: o.templateId,
        name: o.name,
        description: o.description,
        is_mandatory: o.is_mandatory,
        // strip de campos de instância (checked/selectedAnswerId não pertencem ao template)
        items: o.items.map(({ checked: _c, selectedAnswerId: _s, ...rest }) => rest as ChecklistItem),
      })),
    })),
  };
}

// ─────────── Diff ───────────

export interface DiffEntry {
  kind: 'pop' | 'fase' | 'objetivo' | 'passo';
  action: 'adicionado' | 'removido' | 'renomeado' | 'alterado' | 'movido';
  /** Nome do elemento (o atual, ou o último conhecido se removido). */
  label: string;
  /** Localização legível, ex.: "Pré-Atendimento › Coleta de Informações". */
  path: string;
  /** Campo alterado quando action = alterado/renomeado (script, descrição...). */
  field?: string;
  before?: string;
  after?: string;
  /** Id estável do passo (permite ancorar anotações na versão anotada). */
  stepId?: string;
}

const clip = (s: string | undefined | null, max = 300): string | undefined => {
  const v = (s ?? '').trim();
  if (!v) return undefined;
  return v.length > max ? v.slice(0, max) + '…' : v;
};

type StepLoc = { step: ChecklistItem; phaseName: string; objName: string; objKey: string };

function indexSteps(snap: WorkflowSnapshot): Map<string, StepLoc> {
  const map = new Map<string, StepLoc>();
  for (const p of snap.phases) {
    for (const o of p.objectives) {
      const objKey = o.templateId || `${p.stageId}::${o.name}`;
      for (const s of o.items) {
        map.set(s.id, { step: s, phaseName: p.stageName, objName: o.name, objKey });
      }
    }
  }
  return map;
}

/** Compara dois snapshots e devolve o diff em entradas legíveis. */
export function diffSnapshots(prev: WorkflowSnapshot, next: WorkflowSnapshot): DiffEntry[] {
  const out: DiffEntry[] = [];

  if (prev.name !== next.name) {
    out.push({ kind: 'pop', action: 'renomeado', label: next.name, path: '', field: 'nome', before: prev.name, after: next.name });
  }
  if (prev.description !== next.description) {
    out.push({ kind: 'pop', action: 'alterado', label: next.name, path: '', field: 'descrição', before: clip(prev.description), after: clip(next.description) });
  }
  const prevRes = JSON.stringify((prev.resultados || []).map(r => r.label));
  const nextRes = JSON.stringify((next.resultados || []).map(r => r.label));
  if (prevRes !== nextRes) {
    out.push({
      kind: 'pop', action: 'alterado', label: next.name, path: '', field: 'status possíveis',
      before: (prev.resultados || []).map(r => r.label).join(', ') || '(nenhum)',
      after: (next.resultados || []).map(r => r.label).join(', ') || '(nenhum)',
    });
  }

  // Fases por stageId
  const prevPhases = new Map(prev.phases.map(p => [p.stageId, p]));
  const nextPhases = new Map(next.phases.map(p => [p.stageId, p]));
  for (const p of prev.phases) {
    if (!nextPhases.has(p.stageId)) out.push({ kind: 'fase', action: 'removido', label: p.stageName, path: p.stageName });
  }
  for (const p of next.phases) {
    const old = prevPhases.get(p.stageId);
    if (!old) {
      out.push({ kind: 'fase', action: 'adicionado', label: p.stageName, path: p.stageName });
    } else if (old.stageName !== p.stageName) {
      out.push({ kind: 'fase', action: 'renomeado', label: p.stageName, path: p.stageName, field: 'nome', before: old.stageName, after: p.stageName });
    }
  }

  // Objetivos por templateId (fallback: nome dentro da mesma fase)
  type ObjLoc = { obj: SnapshotObjective; phase: SnapshotPhase };
  const collectObjs = (snap: WorkflowSnapshot): Map<string, ObjLoc> => {
    const m = new Map<string, ObjLoc>();
    for (const p of snap.phases) for (const o of p.objectives) {
      m.set(o.templateId || `${p.stageId}::${o.name}`, { obj: o, phase: p });
    }
    return m;
  };
  const prevObjs = collectObjs(prev);
  const nextObjs = collectObjs(next);
  for (const [key, { obj, phase }] of prevObjs) {
    if (!nextObjs.has(key)) {
      out.push({ kind: 'objetivo', action: 'removido', label: obj.name, path: phase.stageName });
    }
  }
  for (const [key, { obj, phase }] of nextObjs) {
    const old = prevObjs.get(key);
    if (!old) {
      out.push({ kind: 'objetivo', action: 'adicionado', label: obj.name, path: phase.stageName });
      continue;
    }
    const path = `${phase.stageName} › ${obj.name}`;
    if (old.obj.name !== obj.name) {
      out.push({ kind: 'objetivo', action: 'renomeado', label: obj.name, path: phase.stageName, field: 'nome', before: old.obj.name, after: obj.name });
    }
    if ((old.obj.description || '') !== (obj.description || '')) {
      out.push({ kind: 'objetivo', action: 'alterado', label: obj.name, path, field: 'descrição', before: clip(old.obj.description), after: clip(obj.description) });
    }
    if (old.obj.is_mandatory !== obj.is_mandatory) {
      out.push({ kind: 'objetivo', action: 'alterado', label: obj.name, path, field: 'obrigatório', before: old.obj.is_mandatory ? 'sim' : 'não', after: obj.is_mandatory ? 'sim' : 'não' });
    }
    if (old.phase.stageId !== phase.stageId) {
      out.push({ kind: 'objetivo', action: 'movido', label: obj.name, path, before: old.phase.stageName, after: phase.stageName });
    }
  }

  // Passos por id (global, pra detectar mudança de objetivo/fase)
  const prevSteps = indexSteps(prev);
  const nextSteps = indexSteps(next);
  for (const [id, loc] of prevSteps) {
    if (!nextSteps.has(id)) {
      out.push({ kind: 'passo', action: 'removido', label: loc.step.label, path: `${loc.phaseName} › ${loc.objName}`, stepId: id });
    }
  }
  for (const [id, loc] of nextSteps) {
    const old = prevSteps.get(id);
    const path = `${loc.phaseName} › ${loc.objName}`;
    if (!old) {
      out.push({ kind: 'passo', action: 'adicionado', label: loc.step.label, path, stepId: id });
      continue;
    }
    if (old.objKey !== loc.objKey) {
      out.push({ kind: 'passo', action: 'movido', label: loc.step.label, path, stepId: id, before: `${old.phaseName} › ${old.objName}`, after: path });
    }
    if (old.step.label !== loc.step.label) {
      out.push({ kind: 'passo', action: 'renomeado', label: loc.step.label, path, stepId: id, field: 'nome', before: old.step.label, after: loc.step.label });
    }
    const fieldDiffs: Array<[string, string | undefined, string | undefined]> = [
      ['descrição', clip(old.step.description), clip(loc.step.description)],
      ['script', clip(old.step.script), clip(loc.step.script)],
      ['tipo de atividade', old.step.activityType, loc.step.activityType],
    ];
    for (const [field, before, after] of fieldDiffs) {
      if ((before || '') !== (after || '')) {
        out.push({ kind: 'passo', action: 'alterado', label: loc.step.label, path, stepId: id, field, before, after });
      }
    }
    const oldAnswers = (old.step.answers || []).map(a => a.label).join(' | ');
    const newAnswers = (loc.step.answers || []).map(a => a.label).join(' | ');
    if (oldAnswers !== newAnswers) {
      out.push({ kind: 'passo', action: 'alterado', label: loc.step.label, path, stepId: id, field: 'opções de resposta', before: oldAnswers || '(nenhuma)', after: newAnswers || '(nenhuma)' });
    }
    const oldDocs = (old.step.docChecklist || []).map(d => d.label).join(' | ');
    const newDocs = (loc.step.docChecklist || []).map(d => d.label).join(' | ');
    if (oldDocs !== newDocs) {
      out.push({ kind: 'passo', action: 'alterado', label: loc.step.label, path, stepId: id, field: 'checklist de documentos', before: oldDocs || '(vazio)', after: newDocs || '(vazio)' });
    }
    const oldTpl = JSON.stringify(old.step.messageTemplates || {});
    const newTpl = JSON.stringify(loc.step.messageTemplates || {});
    if (oldTpl !== newTpl) {
      out.push({ kind: 'passo', action: 'alterado', label: loc.step.label, path, stepId: id, field: 'modelos de mensagem' });
    }
    if ((old.step.nextStageId || '') !== (loc.step.nextStageId || '') || (old.step.setStatusId || '') !== (loc.step.setStatusId || '')) {
      out.push({ kind: 'passo', action: 'alterado', label: loc.step.label, path, stepId: id, field: 'automação (mover para / status)' });
    }
  }

  return out;
}

/** Linhas de resumo em pt-BR — usadas na notificação e no dialog de motivo. */
export function formatDiffLines(entries: DiffEntry[]): string[] {
  return entries.map(e => {
    const where = e.path ? ` (${e.path})` : '';
    const kindLabel = e.kind === 'pop' ? 'POP' : e.kind.charAt(0).toUpperCase() + e.kind.slice(1);
    switch (e.action) {
      case 'adicionado': return `${kindLabel} "${e.label}" adicionado${where}`;
      case 'removido': return `${kindLabel} "${e.label}" removido${where}`;
      case 'movido': return `${kindLabel} "${e.label}" movido de ${e.before} para ${e.after}`;
      case 'renomeado': return `${kindLabel} renomeado: "${e.before}" → "${e.after}"${where}`;
      default: return `${kindLabel} "${e.label}": ${e.field || 'conteúdo'} alterado${where}`;
    }
  });
}

/** Resumo compacto pra notificação (cap de linhas pra não virar textão). */
export function formatNotificationSummary(entries: DiffEntry[], maxLines = 8): string {
  const lines = formatDiffLines(entries);
  if (lines.length <= maxLines) return lines.map(l => `• ${l}`).join('\n');
  const rest = lines.length - maxLines;
  return lines.slice(0, maxLines).map(l => `• ${l}`).join('\n') + `\n… e mais ${rest} alteração(ões)`;
}

// ─────────── API (Externo) ───────────

export interface WorkflowRevisionRow {
  id: string;
  board_id: string;
  revision_number: number;
  snapshot: WorkflowSnapshot;
  change_reason: string | null;
  change_summary: DiffEntry[] | null;
  origin: 'manual' | 'ia' | 'baseline' | 'restore';
  changed_by: string | null;
  changed_by_name: string | null;
  created_at: string;
}

// A tabela/RPCs de revisão não estão nos types gerados do client — cast local.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ext = () => db as any;

export async function fetchWorkflowRevisions(boardId: string): Promise<WorkflowRevisionRow[]> {
  await ensureExternalSession();
  const { data, error } = await ext()
    .from('workflow_revisions')
    .select('*')
    .eq('board_id', boardId)
    .order('revision_number', { ascending: false });
  if (error) throw error;
  return (data || []) as WorkflowRevisionRow[];
}

export async function fetchLatestWorkflowRevision(boardId: string): Promise<WorkflowRevisionRow | null> {
  await ensureExternalSession();
  const { data, error } = await ext()
    .from('workflow_revisions')
    .select('*')
    .eq('board_id', boardId)
    .order('revision_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as WorkflowRevisionRow) || null;
}

export async function createWorkflowRevision(params: {
  boardId: string;
  snapshot: WorkflowSnapshot;
  reason?: string | null;
  summary?: DiffEntry[] | null;
  origin?: WorkflowRevisionRow['origin'];
  changedBy?: string | null;
  changedByName?: string | null;
}): Promise<WorkflowRevisionRow> {
  await ensureExternalSession();
  const { data, error } = await ext().rpc('create_workflow_revision', {
    p_board_id: params.boardId,
    p_snapshot: params.snapshot,
    p_change_reason: params.reason ?? null,
    p_change_summary: params.summary ?? null,
    p_origin: params.origin ?? 'manual',
    p_changed_by: params.changedBy ?? null,
    p_changed_by_name: params.changedByName ?? null,
  });
  if (error) throw error;
  return data as WorkflowRevisionRow;
}

export async function notifyWorkflowRevision(params: {
  boardId: string;
  title: string;
  summary: string;
  reason?: string | null;
  changedBy?: string | null;
  changedByName?: string | null;
}): Promise<number> {
  await ensureExternalSession();
  const { data, error } = await ext().rpc('notify_workflow_revision', {
    p_board_id: params.boardId,
    p_title: params.title,
    p_summary: params.summary,
    p_reason: params.reason ?? null,
    p_changed_by: params.changedBy ?? null,
    p_changed_by_name: params.changedByName ?? null,
  });
  if (error) throw error;
  return (data as number) ?? 0;
}
