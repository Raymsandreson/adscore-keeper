/**
 * O painel de Menções não serve só pra ver quem te marcou: ele é a lista de
 * cobranças do chat interno das fichas. Quem marca alguém numa atividade ou
 * processo precisa achar isso depois em "Aguardando", e ver a resposta quando
 * ela chega — senão a marcação vira notificação solta, sem registro.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mentions = [
  {
    id: 'm-1',
    message_id: 'msg-1',
    mentioned_user_id: 'u-me',
    entity_type: 'activity',
    entity_id: 'atv-1',
    entity_name: 'Protocolar petição inicial',
    conversation_id: null,
    is_read: false,
    read_at: null,
    created_at: '2026-08-10T18:00:00.000Z',
    direction: 'in' as const,
    status: 'responder' as const,
    reply: null,
    message: {
      id: 'msg-1',
      entity_type: 'activity',
      entity_id: 'atv-1',
      entity_name: 'Protocolar petição inicial',
      content: '@Eu Mesmo consegue olhar isso hoje?',
      sender_id: 'u-outro',
      sender_name: 'Abderaman Rafael',
      reply_to_id: null,
      created_at: '2026-08-10T18:00:00.000Z',
      deleted_at: null,
    },
  },
  {
    id: 'sent:msg-2',
    message_id: 'msg-2',
    mentioned_user_id: 'u-me',
    entity_type: 'process',
    entity_id: 'proc-1',
    entity_name: '0800123-45.2026',
    conversation_id: null,
    is_read: true,
    read_at: null,
    created_at: '2026-08-11T12:00:00.000Z',
    direction: 'out' as const,
    status: 'aguardando' as const,
    reply: null,
    message: {
      id: 'msg-2',
      entity_type: 'process',
      entity_id: 'proc-1',
      entity_name: '0800123-45.2026',
      content: '@Zulmira Teixeira cadê a certidão?',
      sender_id: 'u-me',
      sender_name: 'Eu Mesmo',
      reply_to_id: null,
      created_at: '2026-08-11T12:00:00.000Z',
      deleted_at: null,
    },
  },
  {
    id: 'sent:msg-3',
    message_id: 'msg-3',
    mentioned_user_id: 'u-me',
    entity_type: 'activity',
    entity_id: 'atv-2',
    entity_name: 'Consultar JV',
    conversation_id: null,
    is_read: true,
    read_at: null,
    created_at: '2026-08-09T09:00:00.000Z',
    direction: 'out' as const,
    status: 'respondido' as const,
    reply: {
      sender_name: 'Luana Barros',
      content: 'Já protocolei, segue o número.',
      created_at: '2026-08-09T10:00:00.000Z',
    },
    message: {
      id: 'msg-3',
      entity_type: 'activity',
      entity_id: 'atv-2',
      entity_name: 'Consultar JV',
      content: '@Luana Barros protocolou?',
      sender_id: 'u-me',
      sender_name: 'Eu Mesmo',
      reply_to_id: null,
      created_at: '2026-08-09T09:00:00.000Z',
      deleted_at: null,
    },
  },
];

const profilesMock = [
  { id: 'p1', user_id: 'keliane', full_name: 'Keliane Souza', email: 'keliane@rp.adv' },
  { id: 'p2', user_id: 'me', full_name: 'Eu Mesmo', email: 'eu@rp.adv' },
];

vi.mock('@/hooks/useTeamChat', () => ({
  useMyMentions: () => ({
    mentions,
    loading: false,
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
    reload: vi.fn(),
  }),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: vi.fn() } }));
vi.mock('@/integrations/supabase/external-client', () => ({
  externalSupabase: { from: vi.fn() },
  ensureExternalSession: vi.fn(),
}));
vi.mock('../TeamDirectChatPanel', () => ({ TeamDirectChatPanel: () => null }));
vi.mock('@/lib/teamChatPanelEvents', () => ({
  openTeamChatConversation: vi.fn(),
  openTeamChatNewConversation: vi.fn(),
  subscribeToTeamChatConversation: () => () => {},
}));
// A busca do painel também procura PESSOA (abrir conversa direta) — daí o
// painel precisar de perfis, de quem está ativo e de quem é você.
vi.mock('@/lib/teamDirectMessages', () => ({ startDirectConversationWith: vi.fn() }));
vi.mock('@/hooks/useProfilesList', () => ({ useProfilesList: () => profilesMock }));
vi.mock('@/hooks/useInactiveUserIds', () => ({ useInactiveUserIds: () => new Set<string>() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 'me' } }) }));

import { MentionsPanel } from '../MentionsPanel';
import { startDirectConversationWith } from '@/lib/teamDirectMessages';
import { openTeamChatConversation } from '@/lib/teamChatPanelEvents';

/** O painel abre nas Conversas — as menções ficam atrás do clique na aba. */
function renderMentionsTab() {
  render(<MentionsPanel open onOpenChange={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /^Menções/ }));
}

describe('MentionsPanel — cobrança do chat interno', () => {
  it('registra a menção que você fez, não só as que recebeu', () => {
    renderMentionsTab();

    expect(screen.getByText('@Zulmira Teixeira cadê a certidão?')).toBeInTheDocument();
    expect(screen.getByText('Aguardando resposta')).toBeInTheDocument();
  });

  it('mostra a resposta que fechou a cobrança', () => {
    renderMentionsTab();

    expect(screen.getByText(/Já protocolei, segue o número\./)).toBeInTheDocument();
    expect(screen.getByText('Luana Barros:')).toBeInTheDocument();
  });

  it('separa "Responder" (bola com você) de "Aguardando" (bola com o outro)', () => {
    renderMentionsTab();

    fireEvent.click(screen.getByRole('button', { name: /^Aguardando \(1\)$/ }));
    expect(screen.getByText('@Zulmira Teixeira cadê a certidão?')).toBeInTheDocument();
    expect(screen.queryByText('@Eu Mesmo consegue olhar isso hoje?')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Responder \(1\)$/ }));
    expect(screen.getByText('@Eu Mesmo consegue olhar isso hoje?')).toBeInTheDocument();
    expect(screen.queryByText('@Zulmira Teixeira cadê a certidão?')).not.toBeInTheDocument();
  });

  it('"Não lidas" continua contando só o que chegou pra você', () => {
    renderMentionsTab();

    fireEvent.click(screen.getByRole('button', { name: /^Não lidas \(1\)$/ }));
    expect(screen.getByText('@Eu Mesmo consegue olhar isso hoje?')).toBeInTheDocument();
    expect(screen.queryByText('@Zulmira Teixeira cadê a certidão?')).not.toBeInTheDocument();
  });
});

/**
 * Sem aba "Chat", a caixa de busca virou a porta de entrada da conversa: quem
 * nunca te marcou não tem menção nenhuma, e antes o nome dela não devolvia nada.
 */
describe('MentionsPanel — a busca acha gente, não só menção', () => {
  it('oferece abrir conversa direta com quem não aparece nas menções', async () => {
    (startDirectConversationWith as any).mockResolvedValue('conv-nova');
    renderMentionsTab();

    fireEvent.change(screen.getByPlaceholderText(/Buscar por pessoa/), {
      target: { value: 'keliane' },
    });

    fireEvent.click(await screen.findByRole('button', { name: /Keliane Souza/ }));

    await waitFor(() =>
      expect(startDirectConversationWith).toHaveBeenCalledWith('keliane', 'me')
    );
    await waitFor(() =>
      expect(openTeamChatConversation).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: 'conv-nova' })
      )
    );
  });

  it('não oferece você mesmo na lista de pessoas', () => {
    renderMentionsTab();

    fireEvent.change(screen.getByPlaceholderText(/Buscar por pessoa/), {
      target: { value: 'eu mesmo' },
    });

    expect(screen.queryByText('Abrir conversa direta')).not.toBeInTheDocument();
  });
});
