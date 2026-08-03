/**
 * Rótulo canônico de processo usado em atividades: "<número> - <título>".
 *
 * O sistema tinha dois formatos convivendo: o formulário de atividade grava
 * "<número> - <título>", mas o criador automático de "Dar andamento" gravava só
 * o título — daí a atividade auto-criada mostrar "INDENIZAÇÃO" no lugar do nº do
 * processo. Centralizado aqui para não divergir de novo.
 */
export function formatProcessLabel(
  processNumber?: string | null,
  title?: string | null,
): string {
  return [processNumber?.trim(), title?.trim()].filter(Boolean).join(' - ');
}

/**
 * Rótulo a exibir para o processo vinculado a uma atividade.
 *
 * Prefere sempre o dado vivo de `lead_processes`: o `process_title` da atividade
 * é um snapshot do momento da criação e fica desatualizado quando o número do
 * processo é preenchido depois (ou quando nasceu sem número).
 */
export function displayProcessLabel(
  process: { process_number?: string | null; title?: string | null } | null | undefined,
  fallback?: string | null,
): string {
  const live = process ? formatProcessLabel(process.process_number, process.title) : '';
  return live || (fallback || '');
}
