/**
 * A barra "Relacionamento conosco" no topo da conversa.
 *
 * Regra que ela existe para cumprir: pedir confirmação SÓ quando o
 * relacionamento é indício (lido do nome ou pela IA). Relacionamento já
 * gravado na ficha não ocupa espaço nenhum na conversa.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RelacionamentoBar } from '../RelacionamentoBar';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const base = {
  rotulos: ['Cliente'],
  slugs: ['client'],
  motivo: 'fala em parcelas do empréstimo que pegou',
  opcoes: [
    { name: 'client', label: 'Cliente' },
    { name: 'partner', label: 'Parceiro' },
  ],
  onConfirmar: vi.fn(),
  onDefinir: vi.fn(),
};

describe('RelacionamentoBar', () => {
  it('não aparece quando o relacionamento já está gravado na ficha', () => {
    const { container } = render(<RelacionamentoBar {...base} origem="salvo" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('não aparece quando não se sabe nada e nada está sendo lido', () => {
    const { container } = render(<RelacionamentoBar {...base} origem="desconhecido" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('pede confirmação quando foi a IA que leu, dizendo o porquê', () => {
    render(<RelacionamentoBar {...base} origem="ia" />);
    expect(screen.getByText('Cliente')).toBeTruthy();
    expect(screen.getByText(/lido pela IA na conversa/)).toBeTruthy();
    expect(screen.getByText(/fala em parcelas do empréstimo/)).toBeTruthy();
    expect(screen.getByText('Confirmar')).toBeTruthy();
  });

  it('confirmar grava o que está na tela', async () => {
    const onConfirmar = vi.fn().mockResolvedValue(undefined);
    render(<RelacionamentoBar {...base} origem="nome" onConfirmar={onConfirmar} />);
    fireEvent.click(screen.getByText('Confirmar'));
    await waitFor(() => expect(onConfirmar).toHaveBeenCalledTimes(1));
  });

  it('enquanto a IA lê, mostra o aviso e não oferece confirmar', () => {
    render(<RelacionamentoBar {...base} rotulos={[]} slugs={[]} origem="desconhecido" lendo />);
    expect(screen.getByText(/vendo quem é esse contato/)).toBeTruthy();
    expect(screen.queryByText('Confirmar')).toBeNull();
  });
});
