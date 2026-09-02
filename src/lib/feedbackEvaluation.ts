import { externalSupabase } from '@/integrations/supabase/external-client';
import { supabase } from '@/integrations/supabase/client';

// Regra ÚNICA de avaliação de feedback do sistema.
//
// Nasceu dentro do FeedbackFunnel (aba "Avaliar" das Atividades). Foi extraída
// em 06/08/2026 porque o telão passou a avaliar direto do painel "Feedbacks sem
// avaliar" — duas telas, uma regra só. Quem for avaliar feedback em qualquer
// outro lugar usa daqui; não reescreva as validações.

export type FeedbackOutcome = 'satisfeito' | 'incompleto' | 'insatisfeito';

export interface FeedbackAlvo {
  id: string;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  title?: string | null;
}

export interface AvaliacaoDraft {
  rating: number;
  /** Por que da nota. Obrigatória no 5 e no <= 2. */
  justification: string;
  /** 1 coisa que ficou boa. Obrigatória no 'insatisfeito' (sanduíche). */
  praise: string;
}

/**
 * Valida o rascunho. Devolve a mensagem de erro (pra toast) ou null se está ok.
 * Mesmas regras que valiam no funil desde o início:
 *  - nota obrigatória;
 *  - justificativa obrigatória no 5 (reconhecer) e no <= 2 (construtivo);
 *  - 'insatisfeito' exige registrar 1 ponto positivo, que vai junto no aviso.
 */
export function validarAvaliacao(d: AvaliacaoDraft, outcome: FeedbackOutcome): string | null {
  if (!d.rating) return 'Dê uma nota em estrelas antes de avaliar.';
  if ((d.rating === 5 || d.rating <= 2) && !d.justification.trim()) {
    return d.rating === 5
      ? 'No 5 estrelas, registre o que motivou a nota máxima (reconhecimento).'
      : 'Em nota baixa (≤2), registre o que faltou — de forma construtiva.';
  }
  if (outcome === 'insatisfeito' && !d.praise.trim()) {
    return 'Antes de pedir melhoria, registre 1 coisa que ficou boa (será enviada junto).';
  }
  return null;
}

/** Nome de quem agiu, no Cloud (aparece pro responsável no aviso). */
export async function nomeDoUsuario(cloudUserId?: string | null): Promise<string | null> {
  if (!cloudUserId) return null;
  const { data } = await supabase.from('profiles').select('full_name').eq('user_id', cloudUserId).maybeSingle();
  return (data as { full_name?: string } | null)?.full_name || null;
}

/**
 * Avisa o responsável — toda avaliação notifica, sem exceção de nota.
 * Exportada porque a troca de situação pós-avaliação (activityStatusChange)
 * avisa pela mesma porta; regra do autoaviso mora aqui, num lugar só.
 */
export async function notificarResponsavel(
  alvo: FeedbackAlvo,
  type: string,
  title: string,
  body: string,
  extId: string | null,
  actorName: string | null,
) {
  if (!alvo.assigned_to || alvo.assigned_to === extId) return; // sem autofeedback
  try {
    await (externalSupabase as any).from('activity_notifications').insert({
      activity_id: alvo.id,
      recipient_id: alvo.assigned_to,
      recipient_name: alvo.assigned_to_name,
      type,
      title,
      body,
      actor_id: extId,
      actor_name: actorName,
    });
  } catch (e) {
    console.warn('[feedbackEvaluation] notificar falhou:', e);
  }
}

export interface ResultadoAvaliacao {
  /** Nome de quem avaliou, pra atualização otimista da lista. */
  avaliadorNome: string | null;
  ratedAt: string;
  /** Mensagem de sucesso adequada ao desfecho. */
  mensagem: string;
  /** 'insatisfeito' pede a atividade de melhoria em seguida. */
  pedeFollowUp: boolean;
}

/**
 * Grava a avaliação em lead_activities (Externo) e dispara o aviso.
 * Lança erro se o update falhar — quem chama mostra o toast de erro.
 */
export async function salvarAvaliacao({
  alvo, outcome, draft, extId, cloudUserId,
}: {
  alvo: FeedbackAlvo;
  outcome: FeedbackOutcome;
  draft: AvaliacaoDraft;
  extId: string | null;
  cloudUserId?: string | null;
}): Promise<ResultadoAvaliacao> {
  const avaliadorNome = await nomeDoUsuario(cloudUserId);
  const ratedAt = new Date().toISOString();

  // Quem chama nem sempre tem o responsável em mãos (o telão só recebe o nome
  // pela RPC do detalhe). Sem o UUID não dá pra avisar ninguém — busca aqui.
  if (alvo.assigned_to === undefined) {
    const { data } = await (externalSupabase as any)
      .from('lead_activities')
      .select('assigned_to, assigned_to_name')
      .eq('id', alvo.id)
      .maybeSingle();
    alvo = { ...alvo, assigned_to: data?.assigned_to ?? null, assigned_to_name: alvo.assigned_to_name ?? data?.assigned_to_name ?? null };
  }

  const { error } = await (externalSupabase as any)
    .from('lead_activities')
    .update({
      feedback_rating: draft.rating,
      feedback_outcome: outcome,
      feedback_rating_justification: draft.justification.trim() || null,
      feedback_praise: draft.praise.trim() || null,
      feedback_rated_by: extId,
      feedback_rated_by_name: avaliadorNome,
      feedback_rated_at: ratedAt,
      updated_by: extId,
    })
    .eq('id', alvo.id);
  if (error) throw error;

  const nota = `${draft.rating}⭐`;
  const porque = draft.justification.trim().slice(0, 300);
  let mensagem: string;

  if (outcome === 'incompleto') {
    await notificarResponsavel(alvo, 'incompleto', '⚠️ Feedback incompleto', `Falta detalhar: ${porque || 'complete o retorno.'}`, extId, avaliadorNome);
    mensagem = 'Marcado como incompleto — o responsável foi avisado para completar.';
  } else if (outcome === 'satisfeito') {
    if (draft.rating >= 4) {
      await notificarResponsavel(alvo, 'praise', '🌟 Seu trabalho foi elogiado', porque ? `${nota} — ${porque}` : `${nota} pelo retorno.`, extId, avaliadorNome);
    } else {
      await notificarResponsavel(alvo, 'avaliacao', '✅ Sua atividade foi avaliada', `${nota} · satisfeito${porque ? ` — ${porque}` : ''}`, extId, avaliadorNome);
    }
    mensagem = 'Avaliado como satisfeito!';
  } else {
    await notificarResponsavel(
      alvo,
      'insatisfeito',
      '🔄 Pedido de melhoria na atividade',
      [
        draft.praise.trim() ? `✅ Ficou bom: ${draft.praise.trim().slice(0, 200)}` : '',
        `${nota} · o que melhorar: ${porque || 'ver a atividade'}`,
      ].filter(Boolean).join('\n'),
      extId,
      avaliadorNome,
    );
    mensagem = 'Pedido de melhoria enviado.';
  }

  return { avaliadorNome, ratedAt, mensagem, pedeFollowUp: outcome === 'insatisfeito' };
}
