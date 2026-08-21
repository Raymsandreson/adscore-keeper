/**
 * Onde termina o "cromo" fixo da esquerda e começa o conteúdo da tela.
 *
 * O menu lateral é `fixed`, então qualquer flutuante colado em `left: 0/4`
 * pousa POR CIMA dos itens dele (Contatos, Chat, Configurações…). Todo
 * elemento flutuante da esquerda usa esta medida como limite — de clamp, de
 * snap ou de `collisionPadding.left`. (skill: ui-sem-sobreposicao)
 *
 * Extraído do ActivityTimerOverlay em 19/08/2026, quando o "?" do tour de
 * funcionalidades precisou da mesma conta.
 */

/** Folga entre o flutuante e a borda da área livre. */
export const EDGE_GUTTER = 8;

/**
 * Borda esquerda da área livre = borda direita do MENU LATERAL.
 * O menu é `fixed z-10` e o badge é `fixed z-[9990]`: colar em `left: 4` punha o
 * cronômetro POR CIMA dos itens do menu (Contatos, Chat…). Medimos a cada uso
 * porque o menu muda de largura (16rem ↔ 3rem no modo ícone) e some no mobile.
 * O menu mobile (Sheet, `data-mobile`) é ignorado — é temporário e cobre a tela
 * inteira. (skill: ui-sem-sobreposicao)
 */
export function contentLeftEdge(): number {
  if (typeof document === 'undefined') return EDGE_GUTTER;
  let edge = EDGE_GUTTER;
  const el = document.querySelector('[data-sidebar="sidebar"]:not([data-mobile])');
  if (el) {
    const r = el.getBoundingClientRect();
    // Offcanvas/escondido: o menu sai da tela (right <= 0) e não atrapalha.
    if (r.width > 0 && r.right > 0) edge = Math.round(r.right) + EDGE_GUTTER;
  }
  // Sheet/diálogo ANCORADO na borda esquerda (ex.: a atividade aberta ao lado do
  // Relatório de Atividades) é parede como o menu: a aba mora depois dele, senão
  // cai por cima do conteúdo e dos botões do cabeçalho (fechar, Tela cheia).
  // Só conta o que encosta na borda (left <= 1): diálogo centralizado não empurra
  // a aba pro meio da tela. (skill: ui-sem-sobreposicao)
  for (const d of document.querySelectorAll('[role="dialog"][data-state="open"]')) {
    const r = d.getBoundingClientRect();
    if (r.width > 0 && r.left <= 1 && r.right > edge) edge = Math.round(r.right) + EDGE_GUTTER;
  }
  return edge;
}
