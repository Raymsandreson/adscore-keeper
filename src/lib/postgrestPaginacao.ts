// =============================================================================
// Ler TUDO do PostgREST, não as primeiras 1000 linhas.
//
// O corte é silencioso: a resposta chega com sucesso e a lista simplesmente
// termina. Já mordeu neste projeto em outras telas (ProcessesPage, enriquecimento
// de notícias), e mordeu de novo aqui: a agenda de um dia nunca via o problema
// (11 linhas), mas o seletor de período chega a 92 dias.
//
// Vive em `lib` porque quem lê tabela inteira não é uma tela só: `useHearings`
// carrega `hearings` sem janela de data (566 linhas vivas em 20/08/2026, criadas
// a 37-90 por mês) e `useEventosDaJanela` lê hearings + atividades por período.
// =============================================================================

/** Teto de linhas por request do PostgREST — o que passa disso vem paginado. */
export const PAGINA = 1000;

/**
 * Chama `montarQuery(de, ate)` quantas vezes for preciso e concatena.
 *
 * A query recebida precisa aplicar `.range(de, ate)` e ter ordenação estável
 * (`order`), senão a página 2 pode repetir ou pular linha da página 1.
 */
export async function buscarTudo<T>(
  montarQuery: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  tamanhoDaPagina = PAGINA,
): Promise<T[]> {
  const out: T[] = [];
  for (let pagina = 0; ; pagina++) {
    const de = pagina * tamanhoDaPagina;
    const { data, error } = await montarQuery(de, de + tamanhoDaPagina - 1);
    if (error) throw error;
    const lote = data || [];
    out.push(...lote);
    if (lote.length < tamanhoDaPagina) return out;
  }
}
