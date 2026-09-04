// Funções puras da planilha de Lead Ads. Módulo separado de propósito: o
// `bpc-sheet-sync` importa o cliente Supabase, e teste que só quer checar
// formato de string não deveria precisar de credencial para rodar. Mesmo
// padrão de `metaCapiNormalize`.

/**
 * Id do lead na Meta, como a Conversion Leads API espera: número puro.
 *
 * A exportação de Lead Ads escreve `l:1009263962139850` — com prefixo. Em
 * 04/09/2026 gravei 131 linhas assim e só percebi olhando o dado no banco:
 * `length = 18` em vez dos 15-17 dígitos do spec. Id com prefixo é o mesmo que
 * id nenhum, e falha lá na Meta, calada — nada estoura deste lado.
 */
export function normalizaLeadIdMeta(bruto: string | undefined | null): string {
  const digitos = String(bruto || '').replace(/\D/g, '');
  return digitos.length >= 10 ? digitos : '';
}
