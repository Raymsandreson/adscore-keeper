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
  return [processNumber, title].map(trimSeparators).filter(Boolean).join(' - ');
}

/**
 * Tira espaços e hífens das bordas antes de juntar as partes do rótulo.
 *
 * 363 processos tinham o título gravado como "- ACIDENTE DE TRABALHO"
 * (12/08/2026), e o rótulo saía "0000384-82.2022.5.05.0371 - - ACIDENTE DE
 * TRABALHO". Os títulos foram limpos no banco; isto evita que o hífen duplo
 * reapareça se a origem gravar assim de novo. Só as bordas — hífen no meio do
 * texto ("CASO 17 e 17.1 - ACIDENTE") é parte do nome.
 */
function trimSeparators(value?: string | null): string {
  return (value || '').replace(/^[\s\-–—]+/, '').replace(/[\s\-–—]+$/, '');
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

/** Rótulo canônico de caso usado em atividades: "<nº do caso> - <título>". */
export function formatCaseLabel(
  caseNumber?: string | null,
  title?: string | null,
): string {
  return [caseNumber, title].map(trimSeparators).filter(Boolean).join(' - ');
}

/**
 * Rótulo a exibir para o caso vinculado a uma atividade.
 *
 * Mesma regra do processo: o `case_title` da atividade é snapshot e pode estar
 * nulo (atividade auto-criada), enquanto `case_id` está preenchido — nesse caso
 * a tela mostrava vínculo nenhum apesar de o vínculo existir.
 */
export function displayCaseLabel(
  legalCase: { case_number?: string | null; title?: string | null } | null | undefined,
  fallback?: string | null,
): string {
  const live = legalCase ? formatCaseLabel(legalCase.case_number, legalCase.title) : '';
  return live || (fallback || '');
}
