/**
 * Sub-itens do passo (`docChecklist`) como CONDIÇÃO para concluir o passo —
 * não como mais um número no telão.
 *
 * Motivo (medido em 31/07/2026, Externo): dos 2.506 passos já marcados que têm
 * sub-itens, 1.690 (67%) foram concluídos sem NENHUM sub-item conferido. O POP
 * só vale se for lido; criar um critério novo no ranking premiaria o clique em
 * lote, não a leitura. Por isso a regra é: o passo não fecha enquanto sobrar
 * sub-item em aberto, e não existe "marcar todos" de sub-item.
 *
 * Duas exceções ficam fora da conta de pendência:
 *   - ESPELHO de resposta: item que repete o texto de uma resposta do passo.
 *     Quem marca (e desmarca) é a resposta escolhida — exigir marcação manual
 *     travaria o passo para sempre, já que os espelhos das respostas NÃO
 *     escolhidas ficam desmarcados por definição (ver src/lib/popAnswerMirror.ts).
 *   - "NÃO SE APLICA" (`notApplicable`): escape para o item que não cabe naquele
 *     caso. Sem ele o assessor marcaria tudo só para destravar — de volta ao
 *     problema que a regra tenta resolver.
 */

import { isMirrorOfAnswer, mirrorLabelsOf, type MirrorAnswer } from '@/lib/popAnswerMirror';

/**
 * Formas mínimas — sem index signature de propósito: cada tela declara o seu
 * próprio tipo de passo/sub-item, e exigir assinatura de índice quebraria a
 * atribuição de todos eles.
 */
export interface SubItemLike {
  id?: string;
  label?: string;
  checked?: boolean;
  /** Não se aplica a este caso: resolve o sub-item sem afirmar que foi feito. */
  notApplicable?: boolean;
}

export interface StepLike {
  id?: string;
  label?: string;
  answers?: { label?: string }[];
  docChecklist?: SubItemLike[] | null;
}

/** Sub-item deixou de travar o passo: foi feito ou foi marcado como não aplicável. */
export function isSubItemResolved(doc: SubItemLike): boolean {
  return !!doc.checked || !!doc.notApplicable;
}

/** Sub-itens que ainda seguram a conclusão do passo (já sem os espelhos de resposta). */
export function pendingSubItems(step: StepLike | null | undefined): SubItemLike[] {
  const docs = step?.docChecklist || [];
  if (docs.length === 0) return [];
  const mirrors = mirrorLabelsOf({ answers: (step?.answers || []) as MirrorAnswer[] });
  return docs.filter(d => !isSubItemResolved(d) && !isMirrorOfAnswer(d.label, mirrors));
}

/** O passo está travado por sub-item em aberto? */
export function isStepBlockedBySubItems(step: StepLike | null | undefined): boolean {
  return pendingSubItems(step).length > 0;
}

/** Aviso mostrado a quem tenta concluir o passo com sub-item em aberto. */
export function pendingSubItemsMessage(step: StepLike | null | undefined): string {
  const pending = pendingSubItems(step);
  const first = pending[0]?.label?.trim();
  if (pending.length === 1) {
    return first
      ? `Falta conferir "${first}" para concluir este passo`
      : 'Falta conferir 1 item do checklist para concluir este passo';
  }
  return first
    ? `Faltam ${pending.length} itens do checklist deste passo — comece por "${first}"`
    : `Faltam ${pending.length} itens do checklist para concluir este passo`;
}
