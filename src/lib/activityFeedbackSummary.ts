import { externalSupabase } from '@/integrations/supabase/external-client';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface SummarizeParams {
  activityId: string;
  whatWasDone?: string | null;
  currentStatus?: string | null;
  nextSteps?: string | null;
}

/** Próxima atividade sugerida pela IA (mostrada num popup para o usuário criar). */
export interface SuggestedActivity {
  title: string;
  activity_type?: string;
  priority?: string;
  /** Prazo sugerido em dias a partir de hoje. */
  prazo_dias?: number;
  /** Por que essa é a próxima ação (cita movimentação/estágio/documento). */
  justificativa?: string;
}

export interface ActivityReview {
  feedback: string;
  suggestion: SuggestedActivity | null;
}

/** Busca as mensagens do chat interno da equipe para esta atividade. */
async function fetchTeamConversation(activityId: string): Promise<string> {
  const { data } = await externalSupabase
    .from('team_chat_messages')
    .select('sender_name, content')
    .eq('entity_type', 'activity')
    .eq('entity_id', activityId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(200);

  return (data || [])
    .map((m) => `${m.sender_name || 'Membro'}: ${m.content}`)
    .join('\n')
    .trim();
}

function fieldsBlock({ whatWasDone, currentStatus, nextSteps }: SummarizeParams): string {
  return [
    whatWasDone && `O que foi feito: ${whatWasDone}`,
    currentStatus && `Situação atual: ${currentStatus}`,
    nextSteps && `Próximo passo: ${nextSteps}`,
  ]
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractText(data: unknown): string {
  const d = data as { options?: string[]; result?: string; text?: string } | string | null;
  if (!d) return '';
  if (typeof d === 'string') return d;
  if (d.options?.[0]) return d.options[0];
  if (d.result) return d.result;
  if (d.text) return d.text;
  return '';
}

/**
 * Resume a conversa interna da equipe + os campos da atividade num texto curto
 * para o campo `feedback`. Usado no auto-resumo ao concluir. Reaproveita a edge
 * `ai-text-editor` — sem função nova. Retorna `null` se não houver o que resumir.
 */
export async function summarizeActivityConversation(params: SummarizeParams): Promise<string | null> {
  if (!params.activityId) return null;

  const conversa = await fetchTeamConversation(params.activityId);
  const feito = fieldsBlock(params);
  if (!conversa && !feito) return null;

  const ctx = [
    'CONVERSA INTERNA DA EQUIPE:',
    conversa || '(sem mensagens)',
    '',
    'CAMPOS DA ATIVIDADE:',
    feito || '(vazios)',
  ].join('\n');

  const { data, error } = await cloudFunctions.invoke('ai-text-editor', {
    body: {
      action: 'custom',
      text: ctx,
      custom_prompt:
        'Você é assistente de um escritório de advocacia. Com base na CONVERSA INTERNA DA EQUIPE e nos CAMPOS DA ATIVIDADE acima, escreva um FEEDBACK curto (máximo 5 linhas) resumindo o que foi discutido pela equipe e o que foi efetivamente feito nesta atividade. Português brasileiro, direto, texto corrido, sem saudação nem juridiquês. Retorne apenas o texto do feedback.',
    },
  });
  if (error) return null;

  return extractText(data).trim() || null;
}

interface ReviewParams extends SummarizeParams {
  leadId?: string | null;
  processId?: string | null;
}

/**
 * Revisão completa com IA: além do feedback, junta o estágio do funil/fluxo, as
 * últimas movimentações do processo e os documentos, e sugere a PRÓXIMA
 * atividade (mostrada num popup). Pede um JSON estruturado à `ai-text-editor`.
 * Se o parse falhar, devolve o texto todo como feedback e sugestão nula.
 */
export async function reviewActivityWithAI(params: ReviewParams): Promise<ActivityReview | null> {
  const { activityId, leadId, processId } = params;
  if (!activityId) return null;

  const emptyResult = { data: null } as { data: null };
  const [conversa, stageRes, movRes, docRes] = await Promise.all([
    fetchTeamConversation(activityId),
    leadId
      ? externalSupabase
          .from('lead_stage_history')
          .select('to_stage, changed_at')
          .eq('lead_id', leadId)
          .order('changed_at', { ascending: false })
          .limit(1)
      : Promise.resolve(emptyResult),
    processId
      ? externalSupabase
          .from('process_movements')
          .select('categoria, titulo, descricao, data_movimentacao')
          .eq('process_id', processId)
          .order('data_movimentacao', { ascending: false })
          .limit(6)
      : Promise.resolve(emptyResult),
    processId
      ? externalSupabase
          .from('process_documents')
          .select('document_type, title, document_date')
          .eq('process_id', processId)
          .order('document_date', { ascending: false, nullsFirst: false })
          .limit(6)
      : Promise.resolve(emptyResult),
  ]);

  const feito = fieldsBlock(params);
  const estagio = (stageRes.data as { to_stage?: string }[] | null)?.[0]?.to_stage || '';
  const movimentacoes = ((movRes.data as { categoria?: string; titulo?: string; descricao?: string; data_movimentacao?: string }[] | null) || [])
    .map((m) => `- [${m.data_movimentacao || 's/data'}] ${m.categoria ? m.categoria + ': ' : ''}${m.titulo || ''}${m.descricao ? ' — ' + m.descricao : ''}`)
    .join('\n');
  const documentos = ((docRes.data as { document_type?: string; title?: string; document_date?: string }[] | null) || [])
    .map((d) => `- ${d.document_type || 'doc'}: ${d.title || ''}${d.document_date ? ' (' + d.document_date + ')' : ''}`)
    .join('\n');

  if (!conversa && !feito && !movimentacoes && !documentos) return null;

  const ctx = [
    'CONVERSA INTERNA DA EQUIPE:',
    conversa || '(sem mensagens)',
    '',
    'CAMPOS DA ATIVIDADE:',
    feito || '(vazios)',
    '',
    'ESTÁGIO ATUAL NO FUNIL/FLUXO DE TRABALHO:',
    estagio || '(desconhecido)',
    '',
    'ÚLTIMAS MOVIMENTAÇÕES DO PROCESSO:',
    movimentacoes || '(sem movimentações)',
    '',
    'DOCUMENTOS DO PROCESSO:',
    documentos || '(sem documentos)',
  ].join('\n');

  const { data, error } = await cloudFunctions.invoke('ai-text-editor', {
    body: {
      action: 'custom',
      text: ctx,
      custom_prompt:
        'Você é assistente de um escritório de advocacia. Analise a CONVERSA INTERNA DA EQUIPE, os CAMPOS DA ATIVIDADE, o ESTÁGIO NO FUNIL/FLUXO, as MOVIMENTAÇÕES e os DOCUMENTOS acima. ' +
        'Responda SOMENTE com um JSON válido (sem markdown, sem crases) no formato: ' +
        '{"feedback": "texto do feedback completo, máximo 6 linhas, português direto, resumindo o que foi discutido e feito", ' +
        '"proxima_atividade": null OU {"title": "título curto da próxima ação", "activity_type": "tarefa", "priority": "normal|alta|urgente", "prazo_dias": número inteiro de dias a partir de hoje, "justificativa": "1 frase citando a movimentação/estágio/documento que motiva essa ação"}}. ' +
        'Sugira proxima_atividade só se houver um próximo passo claro; senão use null. Retorne apenas o JSON.',
    },
  });
  if (error) return null;

  const raw = extractText(data).trim();
  if (!raw) return null;

  // Tenta parsear JSON (remove cercas de código se vierem)
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as {
      feedback?: string;
      proxima_atividade?: SuggestedActivity | null;
    };
    return {
      feedback: (parsed.feedback || '').trim(),
      suggestion: parsed.proxima_atividade && parsed.proxima_atividade.title ? parsed.proxima_atividade : null,
    };
  } catch {
    // IA não devolveu JSON — usa o texto como feedback
    return { feedback: raw, suggestion: null };
  }
}
