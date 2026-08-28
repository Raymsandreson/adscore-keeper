/**
 * Sugestão automática no popup de aviso do WhatsApp.
 *
 * O popup deixou de esperar o clique no ✨: assim que aparece, a IA já escreve
 * a resposta sugerida — o mesmo hook e a mesma preferência do campo do chat.
 * Cobre: a sugestão nasce sozinha quando o cliente falou por último; um toque
 * a leva pro campo (onApply); quando a última fala é nossa, nada é pedido à IA.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { WhatsAppSugestaoAutomatica } from '../WhatsAppToastActions';
import type { MensagemDaConversa } from '@/lib/whatsappQuickReply';

// Vizinhos do mesmo arquivo que arrastariam supabase/diálogo de IA pro teste.
vi.mock('@/components/ui/AISuggestReply', () => ({ AISuggestReply: () => null }));
vi.mock('@/components/whatsapp/WhatsAppAgentToggle', () => ({ WhatsAppAgentToggle: () => null }));

const historicoDaConversa = vi.hoisted(() => vi.fn());
vi.mock('@/lib/whatsappQuickReply', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/whatsappQuickReply')>()),
  historicoDaConversa,
}));

const gerarSugestaoDeResposta = vi.hoisted(() => vi.fn());
vi.mock('@/lib/sugestaoDeResposta', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sugestaoDeResposta')>()),
  gerarSugestaoDeResposta,
}));

const msg = (direction: string, text: string, at: string): MensagemDaConversa => ({
  direction,
  message_text: text,
  instance_name: 'atendimento previdenciario',
  created_at: at,
});

const props = {
  phone: '5543999990000',
  instanceName: 'atendimento previdenciario',
  contactName: 'Giovanni',
  onApply: vi.fn(),
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  props.onApply = vi.fn();
  historicoDaConversa.mockReset();
  gerarSugestaoDeResposta.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Deixa o histórico chegar, o hook esperar os 900ms e a IA responder. */
async function esperarSugestao() {
  await act(async () => { await Promise.resolve(); }); // histórico
  await act(async () => { vi.advanceTimersByTime(1_000); }); // espera do hook
  await act(async () => { await Promise.resolve(); }); // resposta da IA
}

describe('WhatsAppSugestaoAutomatica', () => {
  it('a sugestão nasce sozinha e um toque a leva pro campo', async () => {
    historicoDaConversa.mockResolvedValue([
      msg('outbound', 'Boa noite!', '2026-08-28T20:00:00Z'),
      msg('inbound', 'Pode me mandar os documentos?', '2026-08-28T21:00:00Z'),
    ]);
    gerarSugestaoDeResposta.mockResolvedValue(['Claro, mando já os documentos.']);

    render(<WhatsAppSugestaoAutomatica {...props} />);
    await esperarSugestao();

    const texto = screen.getByText('Claro, mando já os documentos.');
    fireEvent.click(texto);
    expect(props.onApply).toHaveBeenCalledWith('Claro, mando já os documentos.');
  });

  it('última fala é nossa: não há o que responder, a IA nem é chamada', async () => {
    historicoDaConversa.mockResolvedValue([
      msg('inbound', 'Obrigado!', '2026-08-28T20:00:00Z'),
      msg('outbound', 'Por nada, precisando é só chamar.', '2026-08-28T21:00:00Z'),
    ]);

    const { container } = render(<WhatsAppSugestaoAutomatica {...props} />);
    await esperarSugestao();

    expect(gerarSugestaoDeResposta).not.toHaveBeenCalled();
    expect(container.firstChild).toBeNull();
  });

  it('preferência desligada no chat desliga aqui também', async () => {
    localStorage.setItem('wa-sugestao-automatica', 'false');
    historicoDaConversa.mockResolvedValue([
      msg('inbound', 'Oi, tudo bem?', '2026-08-28T21:00:00Z'),
    ]);

    const { container } = render(<WhatsAppSugestaoAutomatica {...props} />);
    await esperarSugestao();

    expect(gerarSugestaoDeResposta).not.toHaveBeenCalled();
    expect(container.firstChild).toBeNull();
  });
});
