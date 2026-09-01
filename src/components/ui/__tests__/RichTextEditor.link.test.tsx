/**
 * Por que este teste existe:
 * o botão de link é o único da barra que abre um `window.prompt` no meio do
 * caminho. Depois do fix de foco no `ToolBtn` (01/09/2026), o caminho normal
 * está coberto — mas só um teste diz isso, porque o prompt é o tipo de coisa que
 * mexe com foco e o RichTextEditor só emite no blur.
 *
 * Contrato: inserir e remover link mantém o foco no editor, não emite nada
 * durante, e entrega o `<a href>` no blur seguinte.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { RichTextEditor } from '../RichTextEditor';

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Seleciona com Ctrl+A — gesto de gente, não seleção montada na mão. Faz
 * diferença: uma âncora do tipo `element` montada por `p.select(0, n)` deixa o
 * botão dizendo "Remover link" e o comando não remove nada; o Ctrl+A produz
 * âncora `text` dentro do LinkNode, que é o que o navegador entrega.
 */
async function editorComTudoSelecionado(valor: string, onChange: (v: string) => void) {
  const user = userEvent.setup();
  render(<RichTextEditor value={valor} onChange={onChange} />);
  const box = document.querySelector('.lexical-editor') as HTMLElement;
  await tick();
  await user.click(box);
  await user.keyboard('{Control>}a{/Control}');
  await tick();
  return { user, box };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RichTextEditor — botão de link', () => {
  it('o link chega ao formulário no blur seguinte', async () => {
    const onChange = vi.fn();
    const { user, box } = await editorComTudoSelecionado('<p>abrir o processo</p>', onChange);
    vi.spyOn(window, 'prompt').mockReturnValue('https://exemplo.com');
    onChange.mockClear();

    await user.click(screen.getByTitle('Inserir link'));
    await tick();

    expect(document.activeElement).toBe(box);
    expect(box.innerHTML).toContain('href="https://exemplo.com"');
    expect(onChange).not.toHaveBeenCalled();

    await user.tab();
    await tick();

    expect(onChange.mock.calls.at(-1)![0]).toContain('href="https://exemplo.com"');
  });

  it('cancelar o prompt não mexe no texto', async () => {
    const onChange = vi.fn();
    const { user, box } = await editorComTudoSelecionado('<p>abrir o processo</p>', onChange);
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    onChange.mockClear();

    await user.click(screen.getByTitle('Inserir link'));
    await tick();

    expect(box.innerHTML).not.toContain('<a ');
    expect(document.activeElement).toBe(box);
  });

  it('remover link também chega ao formulário', async () => {
    const onChange = vi.fn();
    const { user, box } = await editorComTudoSelecionado(
      '<p><a href="https://exemplo.com">abrir o processo</a></p>',
      onChange,
    );
    onChange.mockClear();

    await user.click(screen.getByTitle('Remover link'));
    await tick();

    expect(box.innerHTML).not.toContain('<a ');
    expect(document.activeElement).toBe(box);

    await user.tab();
    await tick();

    expect(onChange.mock.calls.at(-1)![0]).not.toContain('<a ');
    expect(onChange.mock.calls.at(-1)![0]).toContain('abrir o processo');
  });
});
