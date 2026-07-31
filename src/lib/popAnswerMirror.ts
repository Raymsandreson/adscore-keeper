/**
 * Espelho entre a RESPOSTA de um passo-pergunta e o ITEM do checklist do
 * mesmo passo.
 *
 * No POP o gerente costuma cadastrar a mesma coisa nos dois lugares — no
 * "Resultado do Requerimento Administrativo", por exemplo, existem as
 * respostas "Requerimento Deferido" / "Requerimento Indeferido" e, no
 * checklist de verificação do passo, itens com exatamente esses nomes. Na
 * ficha isso aparecia como dois lugares para dizer a mesma coisa — e só um
 * deles (a resposta) dispara a mudança de fase e o status do POP.
 *
 * Regra: o item que espelha uma resposta não é marcável; quem o marca (e
 * desmarca) é a resposta escolhida. O POP não guarda vínculo entre resposta e
 * item, então o casamento é por rótulo normalizado — sem acento, sem
 * diferença de caixa e sem espaço sobrando.
 */

export interface MirrorAnswer {
  label?: string;
  /** Demais campos da resposta (id, destino, status) não entram no casamento. */
  [key: string]: unknown;
}

const DIACRITICS = /[̀-ͯ]/g;

/** Rótulo comparável: sem acento, sem caixa, sem espaço duplicado. */
export function normalizeLabel(label?: string): string {
  return (label || '')
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Rótulos das respostas do passo — usados para achar os itens espelho. */
export function mirrorLabelsOf(step: { answers?: MirrorAnswer[] } | null | undefined): Set<string> {
  return new Set((step?.answers || []).map(a => normalizeLabel(a.label)).filter(Boolean));
}

/** O item do checklist repete uma das respostas do passo? */
export function isMirrorOfAnswer(docLabel: string | undefined, mirrors: Set<string>): boolean {
  const normalized = normalizeLabel(docLabel);
  return normalized.length > 0 && mirrors.has(normalized);
}
