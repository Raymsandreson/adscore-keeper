/**
 * Histórico de uma atividade: o que aconteceu com ela, quando e por quem.
 *
 * A fonte é `lead_activity_audit_log` (Supabase Externo), gravada pelo trigger
 * `log_activity_audit` a cada INSERT/UPDATE/DELETE em `lead_activities`. Até
 * 08/09/2026 nenhuma tela lia essa tabela — ela só era escrita, e a ficha da
 * atividade mostrava "Criado por: —" mesmo quando o banco sabia exatamente que
 * quem criou foi um robô, e não sabia dizer que a atividade tinha passado por
 * três pessoas antes de chegar em quem a está lendo.
 *
 * Aqui a linha crua vira frase. Duas regras que este módulo não quebra:
 *
 *  - **Não inventa autor.** `actor_id` nulo é rotina de servidor (roda sem
 *    `auth.uid()`); `actor_id` que não resolve nome é sessão do app sem login
 *    identificado (a sessão do Externo é anônima — ver
 *    `docs/sistema/identidade-de-usuario.md`). São coisas diferentes e a tela
 *    diz qual das duas é, em vez de chamar as duas de "sistema".
 *  - **Não finge cobertura que não existe.** O audit começou em 18/07/2026 e
 *    troca de responsável só passou a ser gravada em 21/08/2026. Atividade mais
 *    velha que isso ganha aviso — "sem registro" não é o mesmo que "não houve".
 */
import { robotActivityLabel, type ActivityRobotFields } from '@/lib/activityRobot';

/** Rótulo das situações de `lead_activities.status`. */
export const ACTIVITY_STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
  reagendada: 'Reagendada',
};

/** Cor de cada situação — mesma paleta da cadeia de continuidade. */
export const ACTIVITY_STATUS_CLASS: Record<string, string> = {
  pendente: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  em_andamento: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  concluida: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  reagendada: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
};

export const statusLabel = (status: string | null | undefined): string | null =>
  status ? ACTIVITY_STATUS_LABEL[status] || status : null;

/**
 * Primeiro evento gravado no `lead_activity_audit_log` (medido em 08/09/2026:
 * 2026-07-18 22:32 UTC). Antes disso a atividade existe sem rastro nenhum.
 */
export const AUDIT_START_ISO = '2026-07-18T22:32:11Z';

/**
 * Quando o trigger passou a registrar troca de responsável (migration
 * `20260821120000_audit_registra_troca_de_responsavel`; primeiro registro real
 * em 2026-08-21 15:04 UTC). Repasse anterior a essa data existiu e não foi
 * gravado — daí o aviso na tela em vez de "nunca foi repassada".
 */
export const HANDOFF_AUDIT_START_ISO = '2026-08-21T15:04:03Z';

/** Linha crua de `lead_activity_audit_log`. */
export interface ActivityAuditRow {
  id: string;
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_kind: string | null;
  activity_title: string | null;
  old_status: string | null;
  new_status: string | null;
  changes: Record<string, unknown> | null;
  created_at: string;
}

export type ActivityEventKind =
  | 'created'
  | 'handoff'
  | 'coassignees'
  | 'status'
  | 'title'
  | 'deleted'
  | 'restored'
  | 'edited';

/** De onde veio o ator do evento. */
export type ActivityActorKind = 'user' | 'ai' | 'routine' | 'unidentified';

export interface ActivityHistoryEvent {
  id: string;
  at: string;
  kind: ActivityEventKind;
  /** Frase principal da linha do tempo. */
  text: string;
  /** Responsável antes e depois — só em `handoff`. */
  from: string | null;
  to: string | null;
  /** Situação da atividade no momento do evento (o estado em que ela foi repassada). */
  status: string | null;
  /** Nome de quem fez. `null` quando não há pessoa identificada. */
  actor: string | null;
  actorKind: ActivityActorKind;
  /** Complemento opcional (título antigo, co-assessores). */
  detail: string | null;
}

/** Resolve UUID → nome. O front injeta (teamMembers + remap + profiles do Externo). */
export type NameResolver = (uuid: string | null | undefined) => string | null;

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const uuidList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/**
 * Quem fez o evento.
 *
 * Ordem: nome resolvido pelo front (cobre `profiles.id` e `user_id`, que
 * divergem para parte da equipe) → nome que o próprio trigger gravou → nada.
 * Sem nome, o que distingue rotina de sessão anônima é a EXISTÊNCIA do
 * `actor_id`: rotina de servidor roda sem `auth.uid()` e grava nulo.
 */
export function describeAuditActor(
  row: Pick<ActivityAuditRow, 'actor_id' | 'actor_name' | 'actor_kind'>,
  resolve: NameResolver = () => null,
): { actor: string | null; actorKind: ActivityActorKind } {
  const name = resolve(row.actor_id) || str(row.actor_name);
  if (name) return { actor: name, actorKind: 'user' };
  if (row.actor_kind === 'ai') return { actor: null, actorKind: 'ai' };
  if (!row.actor_id) return { actor: null, actorKind: 'routine' };
  return { actor: null, actorKind: 'unidentified' };
}

/** Texto de "por quem", pronto para a linha do tempo. */
export function actorText(actor: string | null, kind: ActivityActorKind): string {
  if (actor) return actor;
  if (kind === 'ai') return 'IA';
  if (kind === 'routine') return 'rotina do sistema';
  return 'sem identificação';
}

/** Uma linha do audit vira um evento legível. */
export function describeAuditRow(row: ActivityAuditRow, resolve: NameResolver = () => null): ActivityHistoryEvent {
  const changes = row.changes || {};
  const { actor, actorKind } = describeAuditActor(row, resolve);
  const base = {
    id: row.id,
    at: row.created_at,
    from: null as string | null,
    to: null as string | null,
    status: row.new_status || row.old_status || null,
    actor,
    actorKind,
    detail: null as string | null,
  };

  if (row.action === 'insert') {
    return { ...base, kind: 'created', text: 'Atividade criada' };
  }

  if (row.action === 'soft_delete') {
    return { ...base, kind: 'deleted', text: 'Atividade excluída' };
  }

  if (row.action === 'hard_delete') {
    return { ...base, kind: 'deleted', text: 'Atividade apagada em definitivo' };
  }

  if (row.action === 'restore') {
    return { ...base, kind: 'restored', text: 'Atividade restaurada' };
  }

  // Repasse é o que mais gera pergunta ("por que essa atividade saiu de mim?"),
  // então vem antes de situação e assunto quando o mesmo save mudou mais de uma
  // coisa. Nome do responsável: o do audit; se faltar, resolve pelo uuid.
  if ('assigned_to_new' in changes || 'assigned_to_old' in changes) {
    const from = str(changes.assigned_to_old_name) || resolve(str(changes.assigned_to_old));
    const to = str(changes.assigned_to_new_name) || resolve(str(changes.assigned_to_new));
    const text = to && from
      ? `Passou de ${from} para ${to}`
      : to
        ? `Passou a ser de ${to}`
        : from
          ? `Saiu de ${from} e ficou sem responsável`
          : 'Responsável alterado';
    return { ...base, kind: 'handoff', text, from, to };
  }

  if ('assigned_to_ids_new' in changes || 'assigned_to_ids_old' in changes) {
    const before = uuidList(changes.assigned_to_ids_old);
    const after = uuidList(changes.assigned_to_ids_new);
    const entrou = after.filter((id) => !before.includes(id)).map((id) => resolve(id) || 'alguém');
    const saiu = before.filter((id) => !after.includes(id)).map((id) => resolve(id) || 'alguém');
    const partes = [
      entrou.length ? `entrou ${entrou.join(', ')}` : null,
      saiu.length ? `saiu ${saiu.join(', ')}` : null,
    ].filter(Boolean);
    return {
      ...base,
      kind: 'coassignees',
      text: 'Co-assessores alterados',
      detail: partes.length ? partes.join(' · ') : null,
    };
  }

  if ('status_new' in changes || 'status_old' in changes) {
    const de = statusLabel(str(changes.status_old));
    const para = statusLabel(str(changes.status_new));
    return {
      ...base,
      kind: 'status',
      text: de && para ? `Situação: ${de} → ${para}` : `Situação alterada${para ? ` para ${para}` : ''}`,
      status: str(changes.status_new) || base.status,
    };
  }

  if ('title_new' in changes || 'title_old' in changes) {
    return {
      ...base,
      kind: 'title',
      text: 'Assunto alterado',
      detail: str(changes.title_old) ? `Antes: ${str(changes.title_old)}` : null,
    };
  }

  // 62% dos updates chegam com `changes` vazio: o trigger só compara status,
  // assunto, responsável e co-assessores. Mudou descrição/prazo/anexo e a linha
  // registra que houve edição, sem saber qual campo. Dizer isso é melhor do que
  // sumir com o evento — o carimbo de quem e quando continua valendo.
  return { ...base, kind: 'edited', text: 'Atividade editada' };
}

/** Todas as linhas do audit viram eventos, da mais antiga para a mais nova. */
export function buildActivityHistory(
  rows: ActivityAuditRow[],
  resolve: NameResolver = () => null,
): ActivityHistoryEvent[] {
  return [...rows]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((row) => describeAuditRow(row, resolve));
}

/** Campos que o rodapé de autoria precisa da atividade. */
export interface ActivityAuthorFields extends ActivityRobotFields {
  created_by?: string | null;
}

export interface ActivityAuthor {
  /** "Robô do INSS", "Luana Barros" ou "autor não registrado". */
  label: string;
  /** true quando foi robô/IA — a tela pode desenhar o símbolo. */
  robot: boolean;
  /** false quando ninguém ficou registrado; a tela não deve fingir que sabe. */
  known: boolean;
}

/**
 * Quem criou a atividade, para o rodapé da ficha.
 *
 * Antes daqui a ficha da página de Atividades imprimia "Criado por: —" para
 * 10.152 atividades vivas (25,5% das vivas, medido em 08/09/2026) sem
 * `created_by` — e 5.332 delas dizem no banco exatamente qual robô criou
 * ("Etiqueta do WhatsApp", "Robô do INSS", "Follow-up automático"). O traço
 * escondia informação que já existia.
 *
 * `resolvedName` é o nome já resolvido de `created_by` pelo chamador (é ele que
 * tem teamMembers/remap em mãos).
 */
export function describeActivityAuthor(
  activity: ActivityAuthorFields | null | undefined,
  resolvedName: string | null = null,
): ActivityAuthor {
  const robotLabel = robotActivityLabel(activity);
  if (robotLabel) {
    // "Criada automaticamente por: X" → só o "X" entra no rodapé.
    const nome = robotLabel.replace(/^Criada automaticamente (por:|pela)\s*/i, '').trim();
    return { label: nome || 'robô do sistema', robot: true, known: true };
  }
  if (resolvedName) return { label: resolvedName, robot: false, known: true };
  return { label: 'autor não registrado', robot: false, known: false };
}

/**
 * Aviso de cobertura: o que a linha do tempo NÃO consegue mostrar para esta
 * atividade, por ela ser anterior ao audit. `null` quando não há lacuna.
 */
export function auditCoverageNotice(
  activityCreatedAt: string | null | undefined,
  opts: { hasHandoff: boolean },
): string | null {
  if (!activityCreatedAt) return null;
  const created = Date.parse(activityCreatedAt);
  if (Number.isNaN(created)) return null;

  if (created < Date.parse(AUDIT_START_ISO)) {
    return 'Esta atividade é anterior a 18/07/2026, quando o registro de histórico começou. O que aconteceu antes dessa data não foi gravado.';
  }
  if (!opts.hasHandoff && created < Date.parse(HANDOFF_AUDIT_START_ISO)) {
    return 'Troca de responsável só passou a ser registrada em 21/08/2026. Se esta atividade mudou de mãos antes disso, o repasse não foi gravado.';
  }
  return null;
}
