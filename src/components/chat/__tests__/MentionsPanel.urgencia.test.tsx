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
  // Horários com offset explícito (-03:00, o fuso fixado no vitest.config):
  // o painel imprime em hora local, então fixture e expectativa precisam falar
  // a mesma língua. Com `Z` o teste só passava em máquina rodando em UTC.
  nudge: {
    level: 'urgente' as const,
    created_at: '2026-08-11T15:57:00-03:00',
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
  nudge: { ...cobradaSemVisto.nudge, read_at: '2026-08-11T17:14:00-03:00' },
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
let followedThreads = new Set<string>();
const leaveMentionThread = vi.fn().mockResolvedValue(undefined);

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
    nudgeMention,
    followedThreads,
    leaveMentionThread,
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

/** O painel abre direto nas menções — a aba "Chat" não existe mais. */
function renderMentionsTab(list: any[], seguindo: string[] = []) {
  mentions = list;
  followedThreads = new Set(seguindo);
  render(<MentionsPanel open onOpenChange={() => {}} />);
}

describe('MentionsPanel — cobrar resposta urgente', () => {
  beforeEach(() => {
    nudgeMention.mockClear();
    leaveMentionThread.mockClear();
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

describe('MentionsPanel — filtros de onde e de como te chamaram', () => {
  /** Mesma menção em três lugares diferentes, pra separar por escopo. */
  const noPrivado = {
    ...recebidaCobrada,
    id: 'm-p', message_id: 'msg-p', scope: 'privado' as const, mentionKind: 'nome' as const,
    nudge: null, entity_type: null, entity_id: null, conversation_id: 'conv-1',
    message: { ...recebidaCobrada.message, id: 'msg-p', entity_id: '', content: '@Eu Mesmo me chama no privado' },
  };
  const noGrupo = {
    ...recebidaCobrada,
    id: 'm-g', message_id: 'msg-g', scope: 'grupo' as const, mentionKind: 'todos' as const,
    nudge: null, entity_type: null, entity_id: null, conversation_id: 'conv-2',
    message: { ...recebidaCobrada.message, id: 'msg-g', entity_id: '', content: '@todos reunião às 9h' },
  };
  const naFicha = {
    ...recebidaCobrada,
    id: 'm-f', message_id: 'msg-f', scope: 'ficha' as const, mentionKind: 'nome' as const, nudge: null,
    message: { ...recebidaCobrada.message, id: 'msg-f', content: '@Eu Mesmo prazo hoje nessa atividade' },
  };
  const todas = [noPrivado, noGrupo, naFicha];

  it('separa privado, grupo e ficha', () => {
    renderMentionsTab(todas);

    fireEvent.click(screen.getByRole('button', { name: /^Privado/ }));
    expect(screen.getByText('@Eu Mesmo me chama no privado')).toBeInTheDocument();
    expect(screen.queryByText('@todos reunião às 9h')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Ficha/ }));
    expect(screen.getByText('@Eu Mesmo prazo hoje nessa atividade')).toBeInTheDocument();
    expect(screen.queryByText('@Eu Mesmo me chama no privado')).not.toBeInTheDocument();
  });

  it('separa quem te chamou pelo nome de quem disparou @todos', () => {
    renderMentionsTab(todas);

    fireEvent.click(screen.getByRole('button', { name: /^@todos/ }));
    expect(screen.getByText('@todos reunião às 9h')).toBeInTheDocument();
    expect(screen.queryByText('@Eu Mesmo prazo hoje nessa atividade')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Pelo nome/ }));
    expect(screen.getByText('@Eu Mesmo prazo hoje nessa atividade')).toBeInTheDocument();
    expect(screen.queryByText('@todos reunião às 9h')).not.toBeInTheDocument();
  });

  /**
   * O número do chip é promessa: "clica aqui e vem tanto". Contando sobre a
   * lista inteira ele mentia — dizia "Aguardando (27)" com a lista vazia,
   * porque o 27 era de outro recorte.
   */
  it('o número do chip conta dentro do filtro que já está ligado', () => {
    renderMentionsTab(todas);

    expect(screen.getByRole('button', { name: /^Pelo nome \(2\)$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^@todos \(1\)$/ })).toBeInTheDocument();

    // Ligou "Ficha": sobra só a menção da ficha, que é "pelo nome".
    fireEvent.click(screen.getByRole('button', { name: /^Ficha/ }));

    expect(screen.getByRole('button', { name: /^Pelo nome \(1\)$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^@todos$/ })).toBeInTheDocument();
    // A dimensão do próprio chip não se filtra: escopo continua contando tudo.
    expect(screen.getByRole('button', { name: /^Privado \(1\)$/ })).toBeInTheDocument();
  });

  it('cruza as duas dimensões: grupo + pelo nome não devolve o @todos do grupo', () => {
    renderMentionsTab(todas);

    fireEvent.click(screen.getByRole('button', { name: /^Grupo/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Pelo nome/ }));

    expect(screen.queryByText('@todos reunião às 9h')).not.toBeInTheDocument();
    expect(screen.getByText(/Nada com essa combinação de filtros/)).toBeInTheDocument();
  });
});

describe('MentionsPanel — participação no chat da ficha', () => {
  beforeEach(() => {
    leaveMentionThread.mockClear();
  });

  it('quem acompanha o chat pode finalizar a participação', () => {
    renderMentionsTab([recebidaCobrada], ['activity:atv-1']);

    fireEvent.click(screen.getByRole('button', { name: /Finalizar participação/ }));

    expect(leaveMentionThread).toHaveBeenCalledTimes(1);
    expect(leaveMentionThread.mock.calls[0][0].message_id).toBe('msg-4');
  });

  it('não oferece finalizar em chat que a pessoa não acompanha', () => {
    renderMentionsTab([recebidaCobrada], []);

    expect(screen.queryByRole('button', { name: /Finalizar participação/ })).not.toBeInTheDocument();
  });
});
