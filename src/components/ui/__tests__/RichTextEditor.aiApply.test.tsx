/**
 * Por que este teste existe:
 * uma colega gravou a tela (31/08/2026) mostrando que, ao usar a IA do campo
 * ("Mudar tom → Formal") e clicar na sugestão, o texto novo aparecia no editor
 * mas o WhatsApp recebia a versão ANTERIOR ("Em resposta à nossa cobrança" no
 * lugar de "Em atenção à nossa cobrança").
 *
 * Causa: o RichTextEditor não propaga HTML a cada digitação — só marca
 * `dirtyRef` e gera o HTML no blur/expandir, por performance. O
 * `handleSelectOption` trocava o conteúdo do Lexical sem dar flush, e como o
 * clique é no card da sugestão o editor nunca perde o foco → `onChange` nunca
 * disparava. Copiar, Enviar ao Grupo, TTS e Salvar liam o estado pré-IA.
 *
 * O teste trava o contrato: aplicar a sugestão emite `onChange` NA HORA, sem
 * blur, sem desmontar e sem expandir.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const invoke = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { RichTextEditor } from '../RichTextEditor';

const ANTIGO = 'Em resposta à nossa cobrança, o processo segue sem movimentação.';
const NOVO = 'Em atenção à nossa cobrança, o processo segue sem movimentação.';

describe('RichTextEditor — aplicar sugestão da IA', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({ data: { options: [NOVO] }, error: null });
  });

  it('propaga o texto da IA sem depender de blur', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<RichTextEditor value={`<p>${ANTIGO}</p>`} onChange={onChange} />);

    await waitFor(() => expect(screen.getByText(ANTIGO)).toBeInTheDocument());
    onChange.mockClear();

    await user.click(screen.getByTitle('AI Edition'));
    await user.click(await screen.findByText('Corrigir erros'));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('ai-text-editor', expect.anything()));
    const opcao = await screen.findByText(/Opção 1:/);

    // Este clique é o do vídeo: o foco está no card, o editor não sofre blur.
    await user.click(opcao.closest('button')!);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const emitido = onChange.mock.calls.at(-1)![0] as string;
    expect(emitido).toContain(NOVO);
    expect(emitido).not.toContain(ANTIGO);
  });

  it('tela e estado ficam iguais depois de aplicar', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<RichTextEditor value={`<p>${ANTIGO}</p>`} onChange={onChange} />);
    await waitFor(() => expect(screen.getByText(ANTIGO)).toBeInTheDocument());
    onChange.mockClear();

    await user.click(screen.getByTitle('AI Edition'));
    await user.click(await screen.findByText('Corrigir erros'));
    await screen.findByText(/Opção 1:/);

    // Só pedir a sugestão não pode mexer no valor do formulário.
    expect(onChange).not.toHaveBeenCalled();

    await user.click(screen.getByText(/Opção 1:/).closest('button')!);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const box = document.querySelector('.lexical-editor') as HTMLElement;
    expect(box.textContent).toContain(NOVO);
    expect(onChange.mock.calls.at(-1)![0]).toContain(NOVO);
  });
});
