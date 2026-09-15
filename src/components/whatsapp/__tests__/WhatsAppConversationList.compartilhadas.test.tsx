/**
 * O menu WhatsApp API (`/whatsapp-api`) é a mesma caixa de entrada travada no
 * canal Cloud (`lockInstanceName`). Ali não entra conversa compartilhada — e,
 * sem ela, o chip "Compartilhadas" da barra de filtros só marcaria zero.
 *
 * O selo "↓ de Fulano"/"↑ para Fulano" da linha seguia o mesmo caminho por
 * fora: uma conversa DO PRÓPRIO canal Cloud que também estivesse compartilhada
 * aparecia na caixa travada por ser do canal, e vinha com o selo junto. Como a
 * caixa não trata compartilhamento, o selo não tem o que fazer ali.
 *
 * No inbox normal (`/whatsapp`) chip e selo continuam onde sempre estiveram.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const estado = vi.hoisted(() => ({ marcas: new Map<string, any>() }));

const thenable = () => {
  const p: any = Promise.resolve({ data: [], error: null });
  for (const m of ['select', 'in', 'eq', 'order', 'limit', 'gte', 'lte', 'not', 'ilike']) {
    p[m] = () => p;
  }
  return p;
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: () => thenable(), channel: () => ({ on: () => ({ subscribe: () => ({}) }) }), removeChannel: () => {} },
}));
vi.mock('@/integrations/supabase/external-client', () => ({
  externalSupabase: { from: () => thenable() },
}));
vi.mock('@/lib/whatsappMessageActivities', () => ({
  loadPhonesWithPendingActivity: () => Promise.resolve(new Set<string>()),
  subscribeWhatsAppMessageActivityLinked: () => () => {},
}));
vi.mock('@/hooks/useProfileNames', () => ({
  useProfileNames: () => ({ getDisplayName: () => 'Fulano', fetchProfileNames: vi.fn(), profiles: {}, loading: false }),
}));
vi.mock('@/hooks/useSharedWithMe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useSharedWithMe')>()),
  useSharedWithMe: () => ({ items: [], sharedByMe: [], marksByKey: estado.marcas, loading: false, reload: vi.fn() }),
}));
vi.mock('../WhatsAppAvatar', () => ({
  WhatsAppAvatar: () => null,
}));

import { WhatsAppConversationList } from '../WhatsAppConversationList';
import { sharedConversationKey } from '@/hooks/useSharedWithMe';

const conversa = (phone: string, instance_name: string) => ({
  phone,
  contact_name: 'Contato',
  contact_id: null,
  lead_id: null,
  last_message: 'oi',
  last_message_at: '2026-09-14T12:00:00.000-03:00',
  unread_count: 0,
  messages: [],
  instance_name,
});

/** O share que ninguém tem hoje no banco: conversa da própria linha Cloud. */
const shareDaLinhaCloud = (phone: string) => {
  const key = sharedConversationKey(phone, 'abraci');
  const share = {
    id: 'share-1',
    phone,
    instance_name: 'abraci',
    shared_by: 'uuid-de-quem-compartilhou',
    shared_with: 'uuid-de-quem-recebeu',
    identify_sender: true,
    can_reshare: false,
    created_at: '2026-09-14T09:00:00.000-03:00',
    acknowledged_at: null,
  };
  return new Map<string, any>([[key, {
    key,
    phone,
    instance_name: 'abraci',
    incoming: [share],
    outgoing: [{ ...share, id: 'share-2' }],
    people: [share.shared_by, share.shared_with],
    unacknowledged: true,
  }]]);
};

const props = {
  conversations: [conversa('5511999990001', 'abraci'), conversa('5511999990002', 'Raym')] as any,
  loading: false,
  selectedPhone: null,
  onSelect: vi.fn(),
  boards: [] as any,
  selectedInstanceId: 'inst-1',
};

/** Os chips só existem com a barra de filtros aberta (botão "Filtros"). */
const abrirFiltros = () => fireEvent.click(screen.getByTitle('Filtros'));

const seloRecebido = () => screen.queryByTitle(/^Compartilhada com você em/);
const seloEnviado = () => screen.queryByTitle(/^Você compartilhou em/);

beforeEach(() => {
  estado.marcas = new Map();
});

describe('chip "Compartilhadas" da lista de conversas', () => {
  it('aparece no inbox normal', () => {
    render(<WhatsAppConversationList {...props} />);
    abrirFiltros();
    expect(screen.queryByText('Compartilhadas')).not.toBeNull();
  });

  it('some quando a caixa está travada num canal (menu WhatsApp API)', () => {
    render(<WhatsAppConversationList {...props} hideSharedUi />);
    abrirFiltros();
    expect(screen.queryByText('Grupos')).not.toBeNull();
    expect(screen.queryByText('Compartilhadas')).toBeNull();
  });
});

describe('selo de compartilhamento na linha', () => {
  it('aparece no inbox normal, nos dois sentidos', () => {
    estado.marcas = shareDaLinhaCloud('5511999990001');
    render(<WhatsAppConversationList {...props} />);
    expect(seloRecebido()).not.toBeNull();
    expect(seloEnviado()).not.toBeNull();
  });

  it('some na caixa travada, mesmo com a conversa sendo da própria linha do canal', () => {
    estado.marcas = shareDaLinhaCloud('5511999990001');
    render(<WhatsAppConversationList {...props} hideSharedUi />);
    expect(screen.queryAllByText('Contato').length).toBeGreaterThan(0); // a conversa continua listada
    expect(seloRecebido()).toBeNull();
    expect(seloEnviado()).toBeNull();
  });
});
