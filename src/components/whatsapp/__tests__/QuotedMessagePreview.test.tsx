/**
 * O bloco de citação da bolha — o "responder" do WhatsApp dentro do sistema.
 *
 * Cobre o que o relato de 21/08/2026 pedia: a resposta que só tem um "." precisa
 * mostrar QUAL mensagem foi citada e ser clicável para levar até ela.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuotedMessagePreview } from '../QuotedMessagePreview';
import { extractQuotedMessage } from '@/lib/whatsappQuotedMessage';

const quotedDoPdf = extractQuotedMessage({
  message: {
    quoted: '3EB090047C770D94394B2C',
    content: {
      contextInfo: {
        stanzaID: '3EB090047C770D94394B2C',
        participant: '58570586476754@lid',
        quotedMessage: { documentMessage: { title: 'AcidenteTrabalho.pdf' } },
      },
    },
  },
})!;

describe('QuotedMessagePreview', () => {
  it('mostra autor e prévia do documento citado', () => {
    render(<QuotedMessagePreview quoted={quotedDoPdf} autor="Prudêncio Advogados" outbound={false} onClick={vi.fn()} />);
    expect(screen.getByText('Prudêncio Advogados')).toBeInTheDocument();
    expect(screen.getByText('Documento: AcidenteTrabalho.pdf')).toBeInTheDocument();
  });

  it('leva até a mensagem citada no clique', () => {
    const onClick = vi.fn();
    render(<QuotedMessagePreview quoted={quotedDoPdf} autor="Maria" outbound={false} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Maria/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('não deixa clicar enquanto busca a original', () => {
    const onClick = vi.fn();
    render(<QuotedMessagePreview quoted={quotedDoPdf} autor="Maria" outbound carregando onClick={onClick} />);
    const botao = screen.getByRole('button', { name: /Maria/ });
    expect(botao).toBeDisabled();
    fireEvent.click(botao);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('sem autor resolvido, ainda identifica o bloco como citação', () => {
    const semConteudo = extractQuotedMessage({ message: { quoted: 'ABC' } })!;
    render(<QuotedMessagePreview quoted={semConteudo} autor={null} outbound={false} />);
    expect(screen.getByText('Mensagem citada')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
