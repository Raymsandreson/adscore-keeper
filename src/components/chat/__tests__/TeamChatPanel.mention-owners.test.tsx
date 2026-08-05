/**
 * O "@" do chat interno tem que abrir com quem cuida do caso no topo e rotulado
 * (Responsável / Acolhedor) — o objetivo é identificar sem abrir a ficha.
 * Acolhedor sem usuário no sistema aparece como informação, não como menção.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('@/hooks/useTeamChat', () => ({
  useTeamChat: () => ({ messages: [], loading: false, sendMessage: vi.fn(), updateMessage: vi.fn() }),
  useTeamMembers: () => ([
    { user_id: 'u-resp', full_name: 'Crisley Costa de Oliveira', email: 'crisley@x.com' },
    { user_id: 'u-resp2', full_name: 'João Pedro Alvarenga Pereira de Sá', email: 'jp@x.com' },
    { user_id: 'u-outro', full_name: 'Zulmira Teixeira', email: 'zulmira@x.com' },
    { user_id: 'u-me', full_name: 'Eu Mesmo', email: 'eu@x.com' },
  ]),
}));

// Caso com dois processos, cada um com o seu responsável, mais o acolhedor.
vi.mock('@/hooks/useCaseOwners', () => ({
  useCaseOwners: () => ({
    owners: [
      { roles: ['responsavel'], userId: 'u-resp', name: 'Crisley Costa de Oliveira', detail: 'Cumprimento de sentença' },
      { roles: ['responsavel'], userId: 'u-resp2', name: 'João Pedro Alvarenga Pereira de Sá', detail: 'Seguro de vida judicial' },
      { roles: ['acolhedor'], userId: null, name: 'Atendimento Previdenciário' },
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

describe('TeamChatPanel — lista do @', () => {
  it('mostra um responsável por processo e o acolhedor, antes da equipe', async () => {
    render(<TeamChatPanel entityType="lead" entityId="lead-1" entityName="Caso 35" />);

    const input = screen.getByPlaceholderText(/use @nome/i);
    fireEvent.change(input, { target: { value: '@' } });

    await waitFor(() => expect(screen.getByText('Quem cuida deste caso')).toBeTruthy());

    const options = screen.getAllByRole('button').filter(b => /Crisley|João Pedro|Atendimento Previdenci|Zulmira|@todos/.test(b.textContent || ''));
    expect(options[0].textContent).toContain('Crisley Costa de Oliveira');
    expect(options[0].textContent).toContain('Responsável');
    // qual processo é dele fica ao lado do nome
    expect(within(options[0]).getByText(/Cumprimento de sentença/i)).toBeTruthy();

    expect(options[1].textContent).toContain('João Pedro Alvarenga Pereira de Sá');
    expect(within(options[1]).getByText(/Seguro de vida judicial/i)).toBeTruthy();

    expect(options[2].textContent).toContain('Atendimento Previdenciário');
    expect(options[2].textContent).toContain('Acolhedor');
    // o resto da equipe vem depois
    expect(options.slice(3).some(o => (o.textContent || '').includes('Zulmira'))).toBe(true);

    // Acolhedor sem usuário não vira menção.
    expect((options[2] as HTMLButtonElement).disabled).toBe(true);
    expect(within(options[2]).getByText(/sem usuário no sistema/i)).toBeTruthy();

    // Clicar no responsável escreve a menção no campo.
    fireEvent.click(options[0]);
    expect((input as HTMLTextAreaElement).value).toContain('@Crisley Costa de Oliveira');
  });

  it('não repete o responsável na lista geral da equipe', async () => {
    render(<TeamChatPanel entityType="process" entityId="proc-1" />);
    const input = screen.getByPlaceholderText(/use @nome/i);
    fireEvent.change(input, { target: { value: '@cris' } });

    await waitFor(() => expect(screen.getAllByText('Crisley Costa de Oliveira').length).toBe(1));
  });
});
