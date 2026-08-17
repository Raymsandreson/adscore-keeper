// =============================================================================
// Seleção múltipla de atividades — regras puras.
//
// A tela de Atividades tem duas visões e as duas selecionam para o mesmo lote:
// a Lista (cards) e os Blocos (painel do bloco aberto). "Marcar todas" precisa
// agir só sobre o que está na tela naquele momento, sem apagar o que já estava
// marcado em outro contexto — senão trocar de bloco perde a seleção anterior
// calado, que é o tipo de erro que só aparece depois do lote ser aplicado.
// =============================================================================

/**
 * Marca ou desmarca um conjunto visível, preservando o resto da seleção.
 *
 * Se TODOS do pool já estão marcados, o clique desmarca esse pool. Senão,
 * completa o pool. Pool vazio devolve o mesmo Set (nada a fazer).
 */
export function alternarSelecaoDoPool(atual: Set<string>, pool: string[]): Set<string> {
  if (pool.length === 0) return atual;
  const todosMarcados = pool.every(id => atual.has(id));
  const next = new Set(atual);
  if (todosMarcados) pool.forEach(id => next.delete(id));
  else pool.forEach(id => next.add(id));
  return next;
}

/**
 * Intervalo do shift+clique dentro de UMA lista visível.
 *
 * `ordem` é a lista de onde partiu o clique. Marcar/desmarcar o intervalo segue
 * o estado do item clicado: se ele ia ser marcado, o intervalo inteiro é
 * marcado; se ia ser desmarcado, o intervalo é desmarcado. Sem âncora, ou com
 * âncora fora da lista, cai no toggle simples do próprio id.
 */
export function alternarComShift(
  atual: Set<string>,
  id: string,
  ancora: string | null,
  ordem: string[],
): Set<string> {
  const next = new Set(atual);
  if (ancora && ancora !== id) {
    const i = ordem.indexOf(ancora);
    const j = ordem.indexOf(id);
    if (i >= 0 && j >= 0) {
      const [ini, fim] = i < j ? [i, j] : [j, i];
      const marcar = !next.has(id);
      for (let k = ini; k <= fim; k++) {
        if (marcar) next.add(ordem[k]);
        else next.delete(ordem[k]);
      }
      return next;
    }
  }
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Tira da seleção o que não está mais visível (troca de filtro, mês, busca).
 *
 * `visiveis` tem que ser o universo das DUAS visões (`displayedActivities`), e
 * não só o lote renderizado da Lista: o painel do bloco mostra o bloco inteiro,
 * sem o teto de renderização, e cortar pelo lote apagaria o que foi marcado lá.
 * Devolve o Set original quando nada muda, para não disparar re-render à toa.
 */
export function podarSelecao(atual: Set<string>, visiveis: Iterable<string>): Set<string> {
  const universo = new Set(visiveis);
  const next = new Set([...atual].filter(id => universo.has(id)));
  return next.size === atual.size ? atual : next;
}
