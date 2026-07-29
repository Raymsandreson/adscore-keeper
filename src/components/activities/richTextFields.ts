/**
 * Conversões entre o texto puro que a IA devolve e o HTML que o
 * RichTextEditor (Lexical) espera nos campos longos da atividade.
 *
 * Módulo sem dependência de componente de propósito: o `ActivityCallRecorder`
 * reexporta as duas primeiras para não mexer em quem já importava de lá.
 */

/** Remove tags HTML para enviar texto limpo como contexto para a IA. */
export function stripHtmlToText(html: string): string {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Converte o texto puro retornado pela IA em HTML válido para o RichTextEditor. */
export function callFieldTextToHtml(text: string): string {
  const clean = (text || '').trim();
  if (!clean) return '';
  return clean
    .split(/\n+/)
    .map((line) => {
      const esc = line.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return esc ? `<p>${esc}</p>` : '';
    })
    .filter(Boolean)
    .join('');
}

/**
 * Normaliza um campo longo vindo de rascunho (IA do chat, da movimentação, do
 * documento) antes de jogar no RichTextEditor. Texto puro tem que virar bloco:
 * o Lexical só aceita nós de bloco na raiz, então texto sem tag é DESCARTADO e
 * a caixa aparece vazia mesmo com o conteúdo no state. Quem já manda HTML passa direto.
 */
export function draftRichText(value?: string): string {
  const text = (value || '').trim();
  if (!text) return '';
  return /<[a-z][^>]*>/i.test(text) ? text : callFieldTextToHtml(text);
}
