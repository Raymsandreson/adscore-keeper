// =============================================================================
// Quem é o responsável por um passo do POP.
//
// O usuário pode designar responsável em três níveis (08/08/2026), e o mais
// específico vence:
//
//   passo → objetivo → fase → responsável processual do lead
//
// Definir na FASE alcança todos os objetivos e passos dela; definir no OBJETIVO
// alcança todos os seus passos. Quem quiser fugir da regra define no passo.
//
// Por que a herança em vez de preencher tudo: um POP trabalhista tem 24 fases e
// ~200 passos. Exigir responsável passo a passo garantiria que ninguém
// preencheria, e a atividade cairia sem dono — que é o problema que isto
// resolve. Com herança, uma escolha na fase cobre dezenas de passos.
//
// Módulo puro: sem I/O, testável isolado.
// =============================================================================

export interface ResponsavelNiveis {
  /** assigneeId gravado no próprio passo (checklist_templates.items[].assigneeId). */
  passo?: string | null;
  /** assignee_id do objetivo naquela fase (checklist_stage_links.assignee_id). */
  objetivo?: string | null;
  /** assigneeId da fase (kanban_boards.stages[].assigneeId). */
  fase?: string | null;
  /** Último recurso: quem cuida do processo (leads.processual_responsible_id). */
  processo?: string | null;
}

export type OrigemResponsavel = 'passo' | 'objetivo' | 'fase' | 'processo' | 'nenhum';

export interface ResponsavelResolvido {
  assigneeId: string | null;
  origem: OrigemResponsavel;
}

function limpo(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  return s.length > 0 ? s : null;
}

/**
 * Resolve o responsável de um passo pela cascata, dizendo TAMBÉM de onde veio.
 *
 * A origem importa na tela: mostrar "herdado da fase" em cinza deixa claro que
 * aquele nome não foi escolhido ali, e evita que alguém troque o responsável do
 * passo achando que está trocando o da fase inteira.
 */
export function resolverResponsavel(niveis: ResponsavelNiveis): ResponsavelResolvido {
  const passo = limpo(niveis.passo);
  if (passo) return { assigneeId: passo, origem: 'passo' };

  const objetivo = limpo(niveis.objetivo);
  if (objetivo) return { assigneeId: objetivo, origem: 'objetivo' };

  const fase = limpo(niveis.fase);
  if (fase) return { assigneeId: fase, origem: 'fase' };

  const processo = limpo(niveis.processo);
  if (processo) return { assigneeId: processo, origem: 'processo' };

  return { assigneeId: null, origem: 'nenhum' };
}

export const ORIGEM_LABEL: Record<OrigemResponsavel, string> = {
  passo: 'definido neste passo',
  objetivo: 'herdado do objetivo',
  fase: 'herdado da fase',
  processo: 'responsável do processo',
  nenhum: 'sem responsável',
};
