/**
 * Cobrança de urgência da menção: marcar alguém e ficar no vácuo não pode ser o
 * fim da linha. Quem marcou precisa de um botão que estoure um popup na tela do
 * outro — e o registro do que foi cobrado, com o "visto", igual ao Feedback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const nudgeMention = vi.fn().mockResolvedValue(undefined);

/** Menção que EU fiz, ninguém respondeu e ainda não foi cobrada. */
const aguardando = {
  id: 'sent:msg-1',
  message_id: 'msg-1',
  mentioned_user_id: 'u-me',
  entity_type: 'activity',
  entity_id: 'atv-1',
  entity_name: 'Criação de campanha',
  conversation_id: null,
  is_read: true,
  read_at: null,
  created_at: '2026-08-11T12:00:00.000Z',
  direction: 'out' as const,
  status: 'aguardando' as const,
  reply: null,
  targets: [{ user_id: 'u-luiz', name: 'Luiz Ricardo' }],
  nudge: null,
  message: {
    id: 'msg-1',
    entity_type: 'activity',
    entity_id: 'atv-1',
    entity_name: 'Criação de campanha',
    content: '@Luiz Ricardo cadê o retorno disso?',
    sender_id: 'u-me',
    sender_name: 'Eu Mesmo',
    reply_to_id: null,
    created_at: '2026-08-11T12:00:00.000Z',
    deleted_at: null,
  },
};

/** Mesma menção, já cobrada — o popup ainda não apareceu pro outro. */
const cobradaSemVisto = {
  ...aguardando,
  id: 'sent:msg-2',
  message_id: 'msg-2',
  message: { ...aguardando.message, id: 'msg-2', content: '@Luiz Ricardo preciso hoje.' },
  nudge: {
    level: 'urgente' as const,
    created_at: '2026-08-11T15:57:00.000Z',
    read_at: null,
    actor_name: 'Eu Mesmo',
    recipient_name: 'Luiz Ricardo',
  },
};

/** Cobrada e o popup já apareceu na tela dele. */
const cobradaComVisto = {
  ...cobradaSemVisto,
  id: 'sent:msg-3',
  message_id: 'msg-3',
  message: { ...aguardando.message, id: 'msg-3', content: '@Luiz Ricardo o cliente cobrou de novo.' },
  nudge: { ...cobradaSemVisto.nudge, read_at: '2026-08-11T17:14:00.000Z' },
};

/** Menção que EU recebi e que já foi cobrada por quem me marcou. */
const recebidaCobrada = {
  ...aguardando,
  id: 'm-4',
  message_id: 'msg-4',
  direction: 'in' as const,
  status: 'responder' as const,
  is_read: false,
  targets: [{ user_id: 'u-me', name: 'Eu Mesmo' }],
  nudge: {
    level: 'urgente' as const,
    created_at: '2026-08-11T18:00:00.000Z',
    read_at: '2026-08-11T18:02:00.000Z',
    actor_name: 'Gisele Borges',
    recipient_name: 'Eu Mesmo',
  },
  message: {
    ...aguardando.message,
    id: 'msg-4',
    content: '@Eu Mesmo esse processo tem prazo hoje',
    sender_id: 'u-gisele',
    sender_name: 'Gisele Borges',
  },
};

/** Já respondida: não há mais o que cobrar. */
const respondida = {
  ...aguardando,
  id: 'sent:msg-5',
  message_id: 'msg-5',
  status: 'respondido' as const,
  reply: { sender_name: 'Luiz Ricardo', content: 'Subi agora.', created_at: '2026-08-11T13:00:00.000Z' },
  message: { ...aguardando.message, id: 'msg-5', content: '@Luiz Ricardo subiu a campanha?' },
};

let mentions: any[] = [];

vi.mock('@/hooks/useTeamChat', () => ({
  useMyMentions: () => ({
    mentions,
    loading: false,
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
    nudgeMention,
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
  subscribeToTeamChatConversation: () => () => {},
}));

import { MentionsPanel } from '../MentionsPanel';

/** O painel abre na aba Chat — as menções ficam atrás do primeiro clique. */
function renderMentionsTab(list: any[]) {
  mentions = list;
  render(<MentionsPanel open onOpenChange={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /^Menções/ }));
}

describe('MentionsPanel — cobrar resposta urgente', () => {
  beforeEach(() => {
    nudgeMention.mockClear();
  });

  it('oferece cobrar quem você marcou e ainda não respondeu', () => {
    renderMentionsTab([aguardando]);

    fireEvent.click(screen.getByRole('button', { name: /🚨 Urgente/ }));

    expect(nudgeMention).toHaveBeenCalledTimes(1);
    expect(nudgeMention.mock.calls[0][0].message_id).toBe('msg-1');
    expect(nudgeMention.mock.calls[0][1]).toBe('urgente');
  });

  it('também deixa cobrar sem gritar (importante)', () => {
    renderMentionsTab([aguardando]);

    fireEvent.click(screen.getByRole('button', { name: /❗ Importante/ }));

    expect(nudgeMention.mock.calls[0][1]).toBe('importante');
  });

  it('não oferece cobrança em menção já respondida', () => {
    renderMentionsTab([respondida]);

    expect(screen.queryByRole('button', { name: /🚨 Urgente/ })).not.toBeInTheDocument();
  });

  it('não oferece cobrança na menção que você recebeu — quem cobra é quem marcou', () => {
    renderMentionsTab([recebidaCobrada]);

    expect(screen.queryByRole('button', { name: /🚨 Urgente/ })).not.toBeInTheDocument();
  });

  it('registra o histórico: cobrado quando, e ainda sem visualização', () => {
    renderMentionsTab([cobradaSemVisto]);

    expect(screen.getByText(/Cobrado 11\/08 15:57/)).toBeInTheDocument();
    expect(screen.getByText('aguardando visualização')).toBeInTheDocument();
  });

  it('mostra o "visto" quando o popup apareceu pra pessoa', () => {
    renderMentionsTab([cobradaComVisto]);

    expect(screen.getByText(/✓ visto 11\/08 17:14/)).toBeInTheDocument();
    expect(screen.queryByText('aguardando visualização')).not.toBeInTheDocument();
  });

  it('do lado de quem recebeu, diz quem pediu urgência', () => {
    renderMentionsTab([recebidaCobrada]);

    expect(screen.getByText(/Gisele Borges pediu resposta urgente/)).toBeInTheDocument();
  });
});
