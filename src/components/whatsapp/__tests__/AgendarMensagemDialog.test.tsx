/**
 * A janela de agendar mensagem.
 *
 * Cobre o que faz o agendamento ser confiável: o que a pré-visualização promete
 * é o texto que vai para o banco (com a assinatura `*Nome:*` já pronta), a data
 * escolhida vira o instante certo em horário de Brasília, e a fila da conversa
 * pode ser desfeita ali mesmo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgendarMensagemDialog } from '../AgendarMensagemDialog';

const agendar = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'novo' }));
const cancelar = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const pendentes = vi.hoisted(() => ({ atual: [] as any[] }));

vi.mock('@/hooks/useMensagensAgendadas', () => ({
  useMensagensAgendadas: () => ({
    itens: pendentes.atual,
    pendentes: pendentes.atual,
    encerradas: [],
    loading: false,
    salvando: false,
    agendar,
    cancelar,
    recarregar: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const conversa = {
  phone: '5511999990000',
  chatId: null,
  instanceName: 'atendimento',
  contactId: 'contato-1',
  leadId: 'lead-1',
  contactName: 'Danilo Saboia',
};

const abrir = (props: Partial<React.ComponentProps<typeof AgendarMensagemDialog>> = {}) =>
  render(
    <AgendarMensagemDialog
      open
      onOpenChange={vi.fn()}
      conversa={conversa}
      texto="Bom dia, conseguiu ver o documento?"
      textoFinal={'*Raym Andreson:*\nBom dia, conseguiu ver o documento?'}
      criadoPor="user-1"
      criadoPorNome="Raym Andreson"
      {...props}
    />,
  );

beforeEach(() => {
  agendar.mockClear();
  cancelar.mockClear();
  pendentes.atual = [];
});

describe('AgendarMensagemDialog', () => {
  it('mostra o texto do jeito que vai sair, com a assinatura', () => {
    abrir();
    expect(screen.getByText(/Vai sair assim/i)).toBeInTheDocument();
    expect(screen.getByText(/\*Raym Andreson:\*/)).toBeInTheDocument();
  });

  it('agenda o envio único com a data e a hora escolhidas', async () => {
    abrir();
    fireEvent.change(screen.getByLabelText('Dia'), { target: { value: '2026-09-10' } });
    fireEvent.change(screen.getByLabelText('Hora'), { target: { value: '08:30' } });

    fireEvent.click(screen.getByRole('button', { name: /^Agendar$/ }));

    await waitFor(() => expect(agendar).toHaveBeenCalledTimes(1));
    const payload = agendar.mock.calls[0][0];
    expect(payload.quando).toEqual(new Date(2026, 8, 10, 8, 30));
    expect(payload.repeticao).toBe('nenhuma');
    expect(payload.mensagem).toBe('*Raym Andreson:*\nBom dia, conseguiu ver o documento?');
    expect(payload.mensagemOriginal).toBe('Bom dia, conseguiu ver o documento?');
    expect(payload.phone).toBe('5511999990000');
    expect(payload.instanceName).toBe('atendimento');
  });

  it('sem texto no campo, não deixa agendar e diz por quê', () => {
    abrir({ texto: '', textoFinal: '' });
    expect(screen.getByText(/Escreva a mensagem antes de agendar/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Agendar$/ })).toBeDisabled();
  });

  it('data no passado não agenda', () => {
    abrir();
    fireEvent.change(screen.getByLabelText('Dia'), { target: { value: '2020-01-01' } });
    expect(screen.getByText(/já passou/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Agendar$/ })).toBeDisabled();
  });

  it('a fila da conversa aparece e dá para tirar dela', async () => {
    pendentes.atual = [{
      id: 'ag-1',
      phone: conversa.phone,
      instance_name: 'atendimento',
      mensagem: '*Raym:*\nLembrete da perícia',
      mensagem_original: 'Lembrete da perícia',
      proximo_envio_at: new Date(2026, 8, 10, 8, 0).toISOString(),
      repeticao: 'semanal',
      intervalo: 1,
      unidade: 'semanas',
      dias_da_semana: [1, 4],
      repetir_ate: null,
      max_envios: null,
      ativo: true,
      total_enviado: 0,
      criado_por_nome: 'Raym Andreson',
      ultimo_erro: null,
    }];

    abrir();
    expect(screen.getByText('Lembrete da perícia')).toBeInTheDocument();
    expect(screen.getByText(/Toda segunda e quinta/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Tirar da fila'));
    await waitFor(() => expect(cancelar).toHaveBeenCalledWith('ag-1', 'Raym Andreson'));
  });

  it('mensagem que já falhou mostra o erro do último envio', () => {
    pendentes.atual = [{
      id: 'ag-2',
      phone: conversa.phone,
      instance_name: 'atendimento',
      mensagem: 'oi',
      mensagem_original: 'oi',
      proximo_envio_at: new Date(2026, 8, 11, 8, 0).toISOString(),
      repeticao: 'diaria',
      intervalo: 1,
      unidade: 'dias',
      dias_da_semana: null,
      repetir_ate: null,
      max_envios: null,
      ativo: true,
      total_enviado: 3,
      criado_por_nome: null,
      ultimo_erro: 'WhatsApp instance is disconnected.',
    }];

    abrir();
    expect(screen.getByText(/último envio falhou: WhatsApp instance is disconnected\./i)).toBeInTheDocument();
  });
});
