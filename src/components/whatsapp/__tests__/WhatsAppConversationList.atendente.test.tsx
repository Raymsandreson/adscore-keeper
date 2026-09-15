/**
 * Filtro "Atendente" da lista de conversas (WhatsApp API).
 *
 * "Meus" só responde pelo próprio usuário logado: quem supervisiona a linha não
 * tinha como abrir a fila de UM atendente — ou via tudo junto, ou conferia
 * conversa por conversa pelo badge de dono. O seletor sai das conversas
 * carregadas, então só aparece para quem enxerga atribuição alheia
 * (`canSeeAllAssignments`).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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

const NOMES: Record<string, string> = {
  'u-israel': 'Israel de Jesus Carvalho Filho',
  'u-mateus': 'Mateus Santos Saraiva',
  'u-karol': 'Maria Karolyne de Aguiar Nunes',
};
vi.mock('@/hooks/useProfileNames', () => ({
  useProfileNames: () => ({
    getDisplayName: (id: string) => NOMES[id] ?? null,
    fetchProfileNames: vi.fn(),
    profiles: {},
    loading: false,
  }),
}));
vi.mock('@/hooks/useSharedWithMe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useSharedWithMe')>()),
  useSharedWithMe: () => ({ items: [], sharedByMe: [], marksByKey: new Map(), loading: false, reload: vi.fn() }),
}));
vi.mock('../WhatsAppAvatar', () => ({
  WhatsAppAvatar: () => null,
}));

import { WhatsAppConversationList } from '../WhatsAppConversationList';

const conversa = (phone: string, contact_name: string) => ({
  phone,
  contact_name,
  contact_id: null,
  lead_id: null,
  last_message: 'oi',
  last_message_at: '2026-09-14T12:00:00.000Z',
  unread_count: 0,
  messages: [],
  instance_name: 'abraci',
});

const props = {
  conversations: [
    conversa('5511900000001', 'Cliente do Israel'),
    conversa('5511900000002', 'Cliente do Mateus'),
    conversa('5511900000003', 'Cliente da Karolyne'),
    conversa('5511900000004', 'Cliente sem dono'),
  ] as any,
  loading: false,
  selectedPhone: null,
  onSelect: vi.fn(),
  boards: [] as any,
  selectedInstanceId: 'inst-1',
  cloudAssignees: new Map([
    ['5511900000001', 'u-israel'],
    ['5511900000002', 'u-mateus'],
    ['5511900000003', 'u-karol'],
  ]),
  currentUserId: 'u-israel',
  hideSharedUi: true,
};

/** Os filtros só existem com a barra aberta (botão "Filtros"). */
const abrirFiltros = () => fireEvent.click(screen.getByTitle('Filtros'));

/** Radix Select abre no pointerDown do trigger. */
const abrirSelect = (trigger: HTMLElement) => {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
};

describe('filtro por atendente da lista de conversas', () => {
  it('não aparece para quem não vê atribuição alheia', () => {
    render(<WhatsAppConversationList {...props} canSeeAllAssignments={false} />);
    abrirFiltros();
    expect(screen.queryByText('Todos os atendentes')).toBeNull();
  });

  it('lista os donos das conversas carregadas, com a contagem de cada um', () => {
    render(<WhatsAppConversationList {...props} canSeeAllAssignments />);
    abrirFiltros();
    abrirSelect(screen.getByText('Todos os atendentes').closest('button')!);
    expect(screen.queryByText('Israel de Jesus Carvalho Filho (1)')).not.toBeNull();
    expect(screen.queryByText('Mateus Santos Saraiva (1)')).not.toBeNull();
    expect(screen.queryByText('Maria Karolyne de Aguiar Nunes (1)')).not.toBeNull();
  });

  it('escolher um atendente deixa na lista só as conversas dele', () => {
    render(<WhatsAppConversationList {...props} canSeeAllAssignments />);
    abrirFiltros();
    abrirSelect(screen.getByText('Todos os atendentes').closest('button')!);
    fireEvent.click(screen.getByText('Maria Karolyne de Aguiar Nunes (1)'));

    expect(screen.queryByText('Cliente da Karolyne')).not.toBeNull();
    expect(screen.queryByText('Cliente do Israel')).toBeNull();
    expect(screen.queryByText('Cliente do Mateus')).toBeNull();
    expect(screen.queryByText('Cliente sem dono')).toBeNull();
  });
});
