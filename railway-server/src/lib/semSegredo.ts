// Remove credencial de qualquer coisa que vá virar resposta HTTP ou log.
//
// POR QUE EXISTE (14/09/2026). Os modos de diagnostico do `meta-capi-dispatch`
// devolvem o JSON cru da Graph API, e a Meta embute o proprio token nas URLs de
// paginacao que ela mesma devolve:
//
//   paging.next = ".../stats?aggregation=event&access_token=EAAbUBvUtHmA..."
//
// Ou seja: pedir o dono de um conjunto de dados devolvia o token da CAPI de
// volta no corpo da resposta. Quem chamasse o endpoint recebia a credencial, e
// qualquer log dessa resposta a persistia em claro.
//
// O conserto NAO e limpar `paging` em cada modo: sao 25 saidas HTTP hoje, e o
// modo 26 nasceria vazando igual — foi exatamente assim que este defeito
// apareceu. Aqui a limpeza vale para a resposta inteira, seja qual for a forma
// dela, e por isso vale tambem para o modo que alguem escrever amanha.
//
// Nao substitui minimizacao: o certo continua sendo nao colocar segredo no
// corpo. Isto e a rede embaixo, para o caso em que o segredo vem de fora (a
// Meta devolvendo o proprio token) e ninguem reparou.

/** Formato do token da Meta: `EAA` + base64url longo. */
const TOKEN_DA_META = /\bEAA[A-Za-z0-9_-]{20,}\b/g;

/** Nome de campo que nunca pode sair, em qualquer profundidade. */
const CHAVE_SECRETA = /^(access_token|client_secret|app_secret|refresh_token|api_key|apikey|authorization|password|senha|token)$/i;

const OMITIDO = '<omitido>';

/**
 * Limpa uma string: primeiro o par `chave=valor` em querystring (que preserva o
 * resto da URL, util para saber QUAL borda foi chamada), depois qualquer token
 * solto que tenha sobrado no meio do texto — mensagem de erro da Meta as vezes
 * ecoa a URL inteira.
 */
function limpaTexto(s: string): string {
  return s
    .replace(/([?&](?:access_token|client_secret|app_secret|refresh_token)=)[^&\s"']+/gi, `$1${OMITIDO}`)
    .replace(TOKEN_DA_META, OMITIDO);
}

/**
 * Devolve uma copia sem credencial. Nao altera o original: o chamador pode
 * continuar usando o token de pagina que leu da Graph (`me/accounts` devolve um
 * token por pagina, e ele e necessario para ler `leadgen_forms`).
 *
 * `profundidade` existe porque resposta de API e dado de fora: estrutura
 * inesperadamente aninhada nao pode virar recursao infinita no servidor.
 */
export function semSegredo<T>(valor: T, profundidade = 0): T {
  if (profundidade > 12) return OMITIDO as unknown as T;

  if (typeof valor === 'string') return limpaTexto(valor) as unknown as T;
  if (valor === null || typeof valor !== 'object') return valor;

  if (Array.isArray(valor)) {
    return valor.map((v) => semSegredo(v, profundidade + 1)) as unknown as T;
  }

  const saida: Record<string, unknown> = {};
  for (const [chave, v] of Object.entries(valor as Record<string, unknown>)) {
    // Booleano derivado (`tem_token_de_pagina: true`) e informacao, nao segredo:
    // so o valor textual precisa sumir.
    if (CHAVE_SECRETA.test(chave) && typeof v !== 'boolean') {
      saida[chave] = OMITIDO;
      continue;
    }
    saida[chave] = semSegredo(v, profundidade + 1);
  }
  return saida as unknown as T;
}
