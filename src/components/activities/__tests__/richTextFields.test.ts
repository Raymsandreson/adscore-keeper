/**
 * Por que este teste existe:
 * o "Criar atividade a partir do chat" preenchia só o título — os campos longos
 * (COMO ESTÁ / O QUE FOI FEITO / PRÓXIMO PASSO) abriam vazios mesmo com o texto
 * da IA no state. Causa: o RichTextEditor injeta o valor via `$generateNodesFromDOM`
 * e faz `root.append(node)`; texto puro gera TextNode, e a raiz do Lexical só
 * aceita nós de bloco → o conteúdo é descartado em silêncio.
 *
 * O teste replica esse caminho e trava o contrato: rascunho passa por draftRichText.
 */
import { describe, it, expect } from 'vitest';
import { createEditor, $getRoot } from 'lexical';
import { $generateNodesFromDOM } from '@lexical/html';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListNode, ListItemNode } from '@lexical/list';
import { LinkNode } from '@lexical/link';
import { draftRichText, callFieldTextToHtml, stripHtmlToText } from '../richTextFields';

/** Mesmo caminho do SyncPlugin de RichTextEditor.tsx (valor externo → editor). */
function renderThroughLexical(value: string): { text: string; failed: boolean } {
  let failed = false;
  const editor = createEditor({
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode],
    onError: () => { failed = true; },
  });
  try {
    editor.update(() => {
      const root = $getRoot();
      const parser = new DOMParser();
      const dom = parser.parseFromString(value, 'text/html');
      const nodes = $generateNodesFromDOM(editor, dom);
      root.clear();
      nodes.forEach((node) => root.append(node));
    }, { discrete: true });
  } catch {
    failed = true;
  }
  let text = '';
  try {
    editor.getEditorState().read(() => { text = $getRoot().getTextContent(); });
  } catch {
    failed = true;
  }
  return { text, failed };
}

const PLAIN = 'Luana questionou o andamento do caso 38 com a Oriz.';

describe('richTextFields', () => {
  it('reproduz o bug: texto puro não sobrevive ao RichTextEditor', () => {
    const { text, failed } = renderThroughLexical(PLAIN);
    expect(failed || text === '').toBe(true);
    expect(text).not.toContain('caso 38');
  });

  it('draftRichText faz o texto da IA aparecer no editor', () => {
    const { text, failed } = renderThroughLexical(draftRichText(PLAIN));
    expect(failed).toBe(false);
    expect(text).toContain('caso 38');
    expect(text).toContain('Oriz');
  });

  it('preserva as quebras de linha do rascunho como parágrafos', () => {
    const html = draftRichText('Primeira linha\n\nSegunda linha');
    expect(html).toBe('<p>Primeira linha</p><p>Segunda linha</p>');
    const { text } = renderThroughLexical(html);
    expect(text).toContain('Primeira linha');
    expect(text).toContain('Segunda linha');
  });

  it('deixa HTML passar sem reescrever (rascunho que já vem formatado)', () => {
    const html = '<p>Já <strong>formatado</strong></p>';
    expect(draftRichText(html)).toBe(html);
    expect(renderThroughLexical(html).text).toContain('Já formatado');
  });

  it('vazio continua vazio e o escape de HTML se mantém', () => {
    expect(draftRichText('')).toBe('');
    expect(draftRichText(undefined)).toBe('');
    expect(draftRichText('   ')).toBe('');
    expect(callFieldTextToHtml('a & b')).toBe('<p>a &amp; b</p>');
    expect(stripHtmlToText('<p>oi</p><p>tudo bem</p>')).toBe('oi tudo bem');
  });
});
