/**
 * Por que este teste existe:
 * os botões da barra (Negrito, Itálico, Sublinhado, Tachado, link) roubavam o
 * foco do editor no `mousedown`. A ordem que saía disso perdia a formatação:
 *
 *   1. mousedown  → editor sofre blur → handleBlur flusha o HTML de ANTES da
 *                   formatação e zera o dirtyRef
 *   2. click      → dispatchCommand aplica o negrito (o Lexical guarda a seleção)
 *   3. o dirtyRef sobe de novo, mas o foco já está no botão: não existe um
 *      segundo blur, então o resultado NUNCA é emitido
 *
 * Ficava permanente — tela em negrito, estado do formulário sem. Quem clicava de
 * volta no campo antes de sair sincronizava e não via nada; quem formatava e ia
 * direto no Copiar / Enviar ao Grupo / Salvar perdia a formatação (no Salvar,
 * gravava sem ela). É o mesmo buraco de [ai-apply] e [voice-input], por outro
 * caminho: o RichTextEditor só emite no blur, e aqui o blur vinha cedo demais.
 *
 * O contrato travado: clicar na barra NÃO tira o foco do editor, e o que sai no
 * blur seguinte já tem a formatação.
 */
import { describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { $getRoot, $isElementNode, type LexicalEditor } from 'lexical';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { RichTextEditor } from '../RichTextEditor';

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Renderiza, foca o editor e seleciona o parágrafo inteiro. */
async function editorComTextoSelecionado(onChange: (v: string) => void) {
  const user = userEvent.setup();
  render(<RichTextEditor value="<p>texto simples</p>" onChange={onChange} />);

  const box = document.querySelector('.lexical-editor') as HTMLElement & {
    __lexicalEditor?: LexicalEditor;
  };
  await tick();
  const editor = box.__lexicalEditor!;

  await user.click(box);
  editor.update(() => {
    const p = $getRoot().getFirstChild();
    if ($isElementNode(p)) p.select(0, p.getChildrenSize());
  });
  await tick();

  return { user, box };
}

describe('RichTextEditor — barra de formatação e foco', () => {
  it('clicar em Negrito não tira o foco do editor', async () => {
    const { user, box } = await editorComTextoSelecionado(vi.fn());

    await user.click(screen.getByTitle('Negrito'));
    await tick();

    expect(document.activeElement).toBe(box);
  });

  it('o negrito chega ao formulário no blur seguinte', async () => {
    const onChange = vi.fn();
    const { user, box } = await editorComTextoSelecionado(onChange);

    onChange.mockClear();
    await user.click(screen.getByTitle('Negrito'));
    await tick();

    // A tela mostra o negrito…
    expect(box.innerHTML).toContain('lexical-bold');

    // …e sair do campo entrega o mesmo ao formulário.
    await user.tab();
    await tick();

    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0]).toContain('<strong');
  });

  it('vale para os outros botões de formatação', async () => {
    for (const titulo of ['Itálico', 'Sublinhado', 'Tachado']) {
      const onChange = vi.fn();
      const { user, box } = await editorComTextoSelecionado(onChange);

      await user.click(screen.getByTitle(titulo));
      await tick();
      expect(document.activeElement, titulo).toBe(box);

      await user.tab();
      await tick();
      expect(onChange.mock.calls.at(-1)![0], titulo).toMatch(/<em|<u|<s>|text-decoration/);

      cleanup();
    }
  });
});
