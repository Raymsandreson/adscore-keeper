// =============================================================================
// Quem é o responsável por um passo do POP.
//
// O usuário pode designar responsável em vários níveis, e o mais específico
// vence:
//
//   passo → objetivo → fase → responsável do lead → responsável de
//   notificações do POP → ninguém
//
// Definir na FASE alcança todos os objetivos e passos dela; definir no OBJETIVO
// alcança todos os seus passos. Quem quiser fugir da regra define no passo.
//
// O degrau do POP entrou em 12/08/2026, depois do responsável do lead: dos 314
// leads que apareciam no sino, 97 não tinham responsável processual, e para
// esses a cascata terminava em silêncio. Vem DEPOIS do lead de propósito —
// quem cuida daquele caso é mais específico do que quem cuida do POP inteiro,
// e inverter faria uma pessoa só receber tudo enquanto o dono certo não
// recebia nada.
//
// Quem chama decide o que fazer com origem 'nenhum'. No sino, é avisar todo
// mundo: como fundo de poço, depois de cinco degraus falharem, é melhor a
// equipe inteira ver do que a movimentação morrer calada.
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
  /** Quem cuida do processo (leads.processual_responsible_id). */
  processo?: string | null;
  /**
   * Último recurso nomeado: quem recebe as notificações dos processos deste POP
   * (kanban_boards.notificacoes_assignee_id). Só entra quando nem o lead tem
   * responsável — é o que evita que a movimentação fique sem destinatário.
   */
  pop?: string | null;
}

export type OrigemResponsavel = 'passo' | 'objetivo' | 'fase' | 'processo' | 'pop' | 'nenhum';

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

  const pop = limpo(niveis.pop);
  if (pop) return { assigneeId: pop, origem: 'pop' };

  return { assigneeId: null, origem: 'nenhum' };
}

export const ORIGEM_LABEL: Record<OrigemResponsavel, string> = {
  passo: 'definido neste passo',
  objetivo: 'herdado do objetivo',
  fase: 'herdado da fase',
  processo: 'responsável do processo',
  pop: 'responsável de notificações do POP',
  nenhum: 'sem responsável',
};
