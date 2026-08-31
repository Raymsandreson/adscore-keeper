// =============================================================================
// Aviso de "os passos do POP deste lead mudaram".
//
// A barra de progresso (LeadFunnelProgressBar) e o contexto de passo da
// atividade (useActivityStepContext) leem a MESMA tabela por caminhos
// separados: a barra guarda as instâncias no próprio estado e o contexto faz
// uma leitura só, na montagem. Sem aviso entre os dois, marcar um passo na
// barra não chegava ao contexto — e a mensagem enviada ao cliente saía com o
// estado de quando a ficha abriu ("0% concluído", passo da primeira fase) num
// caso que a pessoa acabara de marcar até a fase de contestação.
//
// É o mesmo padrão de evento já usado no app (adscore:lead-stage-changed,
// adscore:lead-deleted).
// =============================================================================

export const POP_STEPS_CHANGED_EVENT = 'adscore:pop-steps-changed';

export interface PopStepsChangedDetail {
  leadId: string;
  boardId: string | null;
}

export function notifyPopStepsChanged(detail: PopStepsChangedDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<PopStepsChangedDetail>(POP_STEPS_CHANGED_EVENT, { detail }));
}

/** Assina o aviso. Devolve a função de cancelar (usar no cleanup do efeito). */
export function onPopStepsChanged(cb: (detail: PopStepsChangedDetail) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => cb((e as CustomEvent<PopStepsChangedDetail>).detail);
  window.addEventListener(POP_STEPS_CHANGED_EVENT, handler);
  return () => window.removeEventListener(POP_STEPS_CHANGED_EVENT, handler);
}
