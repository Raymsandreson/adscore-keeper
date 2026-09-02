import { db } from '@/integrations/supabase';
import { nomeDoUsuario, notificarResponsavel } from './feedbackEvaluation';
import { statusAtividadeLabel, type StatusAtividade } from './activityStatus';

// Regra ÚNICA de troca de situação da atividade fora do formulário.
//
// Nasceu em 02/09/2026: avaliar um retorno como "incompleto" deixava a
// atividade parada em "Concluída" — o funil de feedback dizia que faltava
// coisa e o quadro de atividades dizia que estava pronta. Quem avalia passou a
// ser perguntado se quer corrigir a situação (e a data) na hora.
//
// Grava e avisa o responsável. As duas telas que avaliam (funil das Atividades
// e painel do telão) chamam daqui — não reescreva o update em tela nenhuma.

// `rescheduled_to` existe no Externo (DATE, confirmado no information_schema)
// mas ainda não entrou nos types gerados — o cast fica isolado aqui, numa linha,
// em vez de espalhado pelo arquivo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dbSemTipos = db as any;

export interface SituacaoAtual {
  id: string;
  status: StatusAtividade;
  /** Prazo de execução (`yyyy-MM-dd`). */
  deadline: string | null;
  /** Data do reagendamento (`yyyy-MM-dd`), quando status = 'reagendada'. */
  rescheduled_to: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  title: string | null;
}

/** Lê a situação de agora — quem avalia nem sempre tem a linha em mãos (o telão só tem o id). */
export async function lerSituacaoAtual(activityId: string): Promise<SituacaoAtual | null> {
  const { data, error } = await dbSemTipos
    .from('lead_activities')
    .select('id, status, deadline, rescheduled_to, assigned_to, assigned_to_name, title')
    .eq('id', activityId)
    .maybeSingle();
  if (error || !data) {
    if (error) console.warn('[activityStatusChange] lerSituacaoAtual falhou:', error);
    return null;
  }
  return {
    id: data.id,
    status: (data.status || 'pendente') as StatusAtividade,
    deadline: data.deadline ?? null,
    rescheduled_to: data.rescheduled_to ?? null,
    assigned_to: data.assigned_to ?? null,
    assigned_to_name: data.assigned_to_name ?? null,
    title: data.title ?? null,
  };
}

export interface MudancaSituacao {
  status: StatusAtividade;
  /**
   * `yyyy-MM-dd`. Em 'reagendada' vira `rescheduled_to` (é a data do
   * reagendamento que o resto do sistema lê); nas outras situações vira o novo
   * `deadline`. Vazio = não mexe em data nenhuma.
   */
  data?: string | null;
}

/** O que muda de fato — usado pro texto do aviso e pra atualização otimista da lista. */
export interface ResultadoMudanca extends MudancaSituacao {
  statusAnterior: StatusAtividade;
  /** Campos gravados, pra quem chama refletir na lista sem recarregar. */
  patch: Record<string, unknown>;
}

/**
 * Grava a nova situação e avisa o responsável.
 * Lança erro se o update falhar — quem chama mostra o toast.
 *
 * Concluir carimba `completed_*` igual ao `completeActivity` do
 * useLeadActivities; sair de concluída limpa os mesmos campos, igual ao
 * "Reabrir" da ficha. Situação e carimbo de conclusão não podem discordar.
 */
export async function alterarSituacaoAtividade({
  atual, mudanca, extId, cloudUserId,
}: {
  atual: SituacaoAtual;
  mudanca: MudancaSituacao;
  extId: string | null;
  cloudUserId?: string | null;
}): Promise<ResultadoMudanca> {
  const autorNome = await nomeDoUsuario(cloudUserId);
  const data = mudanca.data?.trim() || null;

  const patch: Record<string, unknown> = { status: mudanca.status, updated_by: extId };
  if (mudanca.status === 'reagendada') {
    if (data) patch.rescheduled_to = data;
  } else if (data) {
    patch.deadline = data;
  }

  if (mudanca.status === 'concluida') {
    patch.completed_at = new Date().toISOString();
    patch.completed_by = extId;
    patch.completed_by_name = autorNome;
  } else if (atual.status === 'concluida') {
    patch.completed_at = null;
    patch.completed_by = null;
    patch.completed_by_name = null;
  }

  const { error } = await dbSemTipos
    .from('lead_activities')
    .update(patch)
    .eq('id', atual.id);
  if (error) throw error;

  const quando = data ? ` · ${data.slice(8, 10)}/${data.slice(5, 7)}/${data.slice(0, 4)}` : '';
  await notificarResponsavel(
    { id: atual.id, assigned_to: atual.assigned_to, assigned_to_name: atual.assigned_to_name, title: atual.title },
    'status',
    '🔄 Situação da atividade alterada',
    `${statusAtividadeLabel(atual.status)} → ${statusAtividadeLabel(mudanca.status)}${quando}`,
    extId,
    autorNome,
  );

  return { ...mudanca, data, statusAnterior: atual.status, patch };
}
