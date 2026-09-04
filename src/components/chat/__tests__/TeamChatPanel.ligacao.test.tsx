/**
 * Ligar por voz é ação do chat interno em QUALQUER ficha (lead, caso, processo,
 * contato, atividade, POP) — não só no Chat da Equipe. O botão da barra abre a
 * lista de quem ligar, com quem cuida do caso no topo, e o clique dispara a
 * mesma chamada do CallContext.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const startCall = vi.fn();

vi.mock('@/contexts/CallContext', () => ({
  useCallOptional: () => ({ status: 'idle', startCall }),
}));

vi.mock('@/hooks/useTeamChat', () => ({
  useTeamChat: () => ({
    messages: [
      {
        id: 'm1', entity_type: 'lead', entity_id: 'lead-1', entity_name: null,
        content: 'processo não está arquivado', sender_id: 'u-outro', sender_name: 'Zulmira Teixeira',
        reply_to_id: null, created_at: new Date().toISOString(), deleted_at: null,
      },
    ],
    loading: false,
    sendMessage: vi.fn(),
    updateMessage: vi.fn(),
    alertMessageAgain: vi.fn(),
  }),
  useTeamMembers: () => ([
    { user_id: 'u-resp', full_name: 'Crisley Costa de Oliveira', email: 'crisley@x.com' },
    { user_id: 'u-outro', full_name: 'Zulmira Teixeira', email: 'zulmira@x.com' },
    { user_id: 'u-me', full_name: 'Eu Mesmo', email: 'eu@x.com' },
  ]),
}));

vi.mock('@/hooks/useCaseOwners', () => ({
  useCaseOwners: () => ({
    owners: [
      { roles: ['responsavel'], userId: 'u-resp', name: 'Crisley Costa de Oliveira', detail: 'Cumprimento de sentença' },
    ],
    leadId: 'lead-1',
    leadName: 'PREV 279',
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => ({ user: { id: 'u-me', email: 'eu@x.com' } }),
}));

vi.mock('@/hooks/usePushNotifications', () => ({
  usePushNotifications: () => ({ supported: false, permission: 'default', subscribed: false, busy: false, enable: vi.fn() }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { storage: { from: () => ({ upload: vi.fn(), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) } },
}));

vi.mock('@/lib/lovableCloudFunctions', () => ({ cloudFunctions: { invoke: vi.fn() } }));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

vi.mock('../TeamChatEntityMention', () => ({
  TeamChatEntityMention: () => null,
  renderMessageWithMentions: (c: string) => [c],
  EntityMention: {},
  EntityMentionType: {},
}));

vi.mock('@/components/whatsapp/MediaLightbox', () => ({ MediaLightbox: () => null }));

import { TeamChatPanel } from '../TeamChatPanel';

describe('TeamChatPanel — ligar por voz', () => {
  beforeEach(() => startCall.mockClear());

  it('lista quem cuida do caso primeiro e liga sem sair da ficha', async () => {
    render(<TeamChatPanel entityType="process" entityId="proc-1" entityName="0002277-56" />);

    fireEvent.click(screen.getByTitle(/Ligar por voz para alguém da equipe/i));

    await waitFor(() => expect(screen.getByText(/Ligar por voz — a chamada abre aqui mesmo/i)).toBeTruthy());

    const alvos = screen.getAllByRole('button').filter(b => /^Ligar para /.test(b.getAttribute('title') || ''));
    expect(alvos[0].getAttribute('title')).toBe('Ligar para Crisley Costa de Oliveira');
    expect(alvos[0].textContent).toContain('Responsável');
    // quem escreveu no chat vem depois do dono do caso, e eu mesmo fico fora
    expect(alvos.some(b => (b.getAttribute('title') || '').includes('Zulmira'))).toBe(true);
    expect(alvos.some(b => (b.getAttribute('title') || '').includes('Eu Mesmo'))).toBe(false);

    fireEvent.click(alvos[0]);
    expect(startCall).toHaveBeenCalledWith('u-resp', 'Crisley Costa de Oliveira');
  });

  it('a busca filtra quem ligar e o Enter liga para o primeiro', async () => {
    render(<TeamChatPanel entityType="process" entityId="proc-1" />);

    fireEvent.click(screen.getByTitle(/Ligar por voz para alguém da equipe/i));
    const busca = await screen.findByPlaceholderText(/Buscar quem ligar/i);

    fireEvent.change(busca, { target: { value: 'zul' } });
    await waitFor(() => {
      const alvos = screen.getAllByRole('button').filter(b => /^Ligar para /.test(b.getAttribute('title') || ''));
      expect(alvos.length).toBe(1);
      expect(alvos[0].getAttribute('title')).toBe('Ligar para Zulmira Teixeira');
    });

    fireEvent.keyDown(busca, { key: 'Enter' });
    expect(startCall).toHaveBeenCalledWith('u-outro', 'Zulmira Teixeira');
  });

  it('busca sem resultado avisa em vez de mostrar lista vazia', async () => {
    render(<TeamChatPanel entityType="process" entityId="proc-1" />);

    fireEvent.click(screen.getByTitle(/Ligar por voz para alguém da equipe/i));
    const busca = await screen.findByPlaceholderText(/Buscar quem ligar/i);
    fireEvent.change(busca, { target: { value: 'ninguem-com-esse-nome' } });

    expect(await screen.findByText(/Ninguém com "ninguem-com-esse-nome" na equipe/i)).toBeTruthy();
  });

  it('a própria mensagem tem "ligar" para quem escreveu', () => {
    render(<TeamChatPanel entityType="process" entityId="proc-1" />);

    fireEvent.click(screen.getByTitle(/Ligar por voz para Zulmira Teixeira/i));
    expect(startCall).toHaveBeenCalledWith('u-outro', 'Zulmira Teixeira');
  });
});
