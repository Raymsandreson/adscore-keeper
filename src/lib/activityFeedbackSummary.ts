import { externalSupabase } from '@/integrations/supabase/external-client';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface SummarizeParams {
  activityId: string;
  whatWasDone?: string | null;
  currentStatus?: string | null;
  nextSteps?: string | null;
}

/**
 * Resume a conversa interna da equipe (team_chat_messages) + os campos da
 * atividade num texto curto pronto para o campo `feedback`.
 *
 * Reaproveita a edge function genérica `ai-text-editor` (action: 'custom') —
 * não cria função nova. Retorna `null` quando não há nada para resumir ou a IA
 * falha (o chamador decide se bloqueia ou não).
 */
export async function summarizeActivityConversation({
  activityId,
  whatWasDone,
  currentStatus,
  nextSteps,
}: SummarizeParams): Promise<string | null> {
  if (!activityId) return null;

  // 1. Conversa da equipe vinculada a esta atividade
  const { data: msgs } = await externalSupabase
    .from('team_chat_messages')
    .select('sender_name, content')
    .eq('entity_type', 'activity')
    .eq('entity_id', activityId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(200);

  const conversa = (msgs || [])
    .map((m) => `${m.sender_name || 'Membro'}: ${m.content}`)
    .join('\n')
    .trim();

  // 2. O que já está registrado nos campos da atividade
  const feito = [
    whatWasDone && `O que foi feito: ${whatWasDone}`,
    currentStatus && `Situação atual: ${currentStatus}`,
    nextSteps && `Próximo passo: ${nextSteps}`,
  ]
    .filter(Boolean)
    .join('\n')
    .trim();

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

  let summary = '';
  if (data?.options?.[0]) summary = data.options[0];
  else if (data?.result) summary = data.result;
  else if (data?.text) summary = data.text;
  else if (typeof data === 'string') summary = data;

  return summary.trim() || null;
}
