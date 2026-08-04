/**
 * Reconciliação entre o que a IA devolve (áudio da ligação / documento anexado)
 * e o que o usuário já escreveu no formulário da atividade.
 *
 * Por que existe: `transcribe-activity-call` e `extract-activity-from-document`
 * declaram os 6 campos de detalhe como `required` no schema — a IA é OBRIGADA a
 * devolver todos em toda chamada, mesmo quando o áudio/documento não fala deles.
 * Aplicar a resposta direto no form substituía o texto digitado pelo usuário sem
 * aviso nenhum ("o conteúdo mudou sozinho"), a mesma sobrescrita silenciosa que o
 * "Concluir e criar próxima" fazia com o assunto até 03/08/2026.
 *
 * Regra: campo vazio a IA preenche à vontade (não há o que perder). Campo já
 * preenchido vira conflito — só muda com o usuário confirmando no diálogo de
 * revisão. Metadados objetivos (prazo, prioridade, situação, assessor, tipo)
 * seguem o comportamento antigo: são aplicados direto e ficam visíveis no form.
 */

/** Campos de texto que o usuário escreve à mão e a IA pode querer reescrever. */
export const AI_REVIEWED_FIELDS = [
  'title',
  'what_was_done',
  'current_status',
  'next_steps',
  'solicitacao',
  'resposta_juizo',
  'notes',
] as const;

export type AIReviewedField = (typeof AI_REVIEWED_FIELDS)[number];

export const AI_FIELD_LABELS: Record<AIReviewedField, string> = {
  title: 'Assunto',
  what_was_done: 'O que foi feito',
  current_status: 'Como está',
  next_steps: 'Próximo passo',
  solicitacao: 'Solicitação',
  resposta_juizo: 'Resposta do juízo',
  notes: 'Observações',
};

export interface AIFieldConflict {
  key: AIReviewedField;
  label: string;
  /** Texto atual do formulário, já sem HTML. */
  current: string;
  /** Sugestão da IA. String vazia = a IA pediu para APAGAR o campo. */
  incoming: string;
  /** Marcado por padrão no diálogo. Apagar campo e trocar assunto vêm desmarcados. */
  defaultChecked: boolean;
}

export interface AIFieldSplit<T> {
  /** Campos seguros de aplicar sem perguntar (campo vazio + todos os metadados). */
  autoApply: T;
  /** Substituições que precisam do aval do usuário. */
  conflicts: AIFieldConflict[];
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Separa a resposta da IA entre o que pode ser aplicado direto e o que
 * sobrescreveria trabalho do usuário.
 *
 * @param incoming campos devolvidos pela IA (shape do ActivityCallFields)
 * @param current  texto ATUAL de cada campo revisado, já convertido para texto puro
 */
export function splitAIFields<T extends Partial<Record<AIReviewedField, string>>>(
  incoming: T,
  current: Partial<Record<AIReviewedField, string>>,
): AIFieldSplit<T> {
  const autoApply = {} as T;
  const conflicts: AIFieldConflict[] = [];

  for (const [key, value] of Object.entries(incoming)) {
    const field = key as AIReviewedField;
    if (!AI_REVIEWED_FIELDS.includes(field)) {
      // Metadado (deadline, priority, status, assessor_names, activity_type...):
      // comportamento inalterado.
      (autoApply as Record<string, unknown>)[key] = value;
      continue;
    }

    const nextText = typeof value === 'string' ? value : '';
    const currentText = (current[field] || '').trim();

    // Campo vazio no form: a IA preenche sem perguntar.
    if (!currentText) {
      if (nextText.trim()) (autoApply as Record<string, unknown>)[key] = nextText;
      continue;
    }

    // Mesmo conteúdo: nada a decidir.
    if (normalize(nextText) === normalize(currentText)) continue;

    conflicts.push({
      key: field,
      label: AI_FIELD_LABELS[field],
      current: currentText,
      incoming: nextText,
      // Apagar conteúdo e trocar o assunto são os dois casos que mais irritam
      // quando acontecem sem querer — exigem marcar na mão.
      defaultChecked: nextText.trim().length > 0 && field !== 'title',
    });
  }

  return { autoApply, conflicts };
}
