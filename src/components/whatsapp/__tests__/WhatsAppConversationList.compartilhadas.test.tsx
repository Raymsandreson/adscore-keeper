/**
 * O menu WhatsApp API (`/whatsapp-api`) é a mesma caixa de entrada travada no
 * canal Cloud (`lockInstanceName`). Ali não entra conversa compartilhada — e,
 * sem ela, o chip "Compartilhadas" da barra de filtros só marcaria zero.
 *
 * No inbox normal (`/whatsapp`) o chip continua onde sempre esteve.
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
vi.mock('@/hooks/useProfileNames', () => ({
  useProfileNames: () => ({ getDisplayName: () => 'Fulano', fetchProfileNames: vi.fn(), profiles: {}, loading: false }),
}));
vi.mock('@/hooks/useSharedWithMe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useSharedWithMe')>()),
  useSharedWithMe: () => ({ items: [], sharedByMe: [], marksByKey: new Map(), loading: false, reload: vi.fn() }),
}));
vi.mock('../WhatsAppAvatar', () => ({
  WhatsAppAvatar: () => null,
}));

import { WhatsAppConversationList } from '../WhatsAppConversationList';

const conversa = (phone: string, instance_name: string) => ({
  phone,
  contact_name: 'Contato',
  contact_id: null,
  lead_id: null,
  last_message: 'oi',
  last_message_at: '2026-09-14T12:00:00.000Z',
  unread_count: 0,
  messages: [],
  instance_name,
});

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

describe('chip "Compartilhadas" da lista de conversas', () => {
  it('aparece no inbox normal', () => {
    render(<WhatsAppConversationList {...props} />);
    abrirFiltros();
    expect(screen.queryByText('Compartilhadas')).not.toBeNull();
  });

  it('some quando a caixa está travada num canal (menu WhatsApp API)', () => {
    render(<WhatsAppConversationList {...props} hideSharedFilter />);
    abrirFiltros();
    expect(screen.queryByText('Grupos')).not.toBeNull();
    expect(screen.queryByText('Compartilhadas')).toBeNull();
  });
});
