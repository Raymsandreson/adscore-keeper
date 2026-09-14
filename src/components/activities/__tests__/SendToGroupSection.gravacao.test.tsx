/**
 * A gravação da ligação feita DEPOIS de abrir a atividade tem que ir junto com o
 * texto enviado ao grupo.
 *
 * Defeito de origem (14/09/2026): a busca da gravação vivia num
 * `useEffect [activityId]`, que roda quando a atividade abre — antes de a pessoa
 * gravar. Sem `recordingUrl`, a caixa "Incluir gravação da ligação" nem era
 * renderizada, e o texto saía sozinho. Medido no Externo: das 87 atividades com
 * gravação que notificaram o grupo em 30 dias, 87 gravaram antes do envio (73 a
 * menos de 30 min) — ou seja, o caminho normal era justamente o que não
 * funcionava.
 *
 * O que este teste trava: a leitura acontece NO CLIQUE de "Enviar", não na
 * montagem.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { fakeClient, estado } = vi.hoisted(() => {
  const estado = { temGravacao: false };
  const resultado = (table: string) => {
    if (table === 'activity_attachments') {
      return estado.temGravacao
        ? {
            data: [{
              file_url: 'https://exemplo.local/gravacao.webm',
              file_name: 'Gravação da ligação.webm',
              created_at: '2026-09-14T15:00:00.000Z',
            }],
            error: null,
          }
        : { data: [], error: null };
    }
    if (table === 'leads') return { data: { whatsapp_group_id: '120363000000000000@g.us', board_id: null }, error: null };
    if (table === 'profiles') return { data: null, error: null };
    return { data: [], error: null };
  };
  const chain = (table: string): any => new Proxy(function () {} as any, {
    get(_t, prop) {
      if (prop === 'then') return (ok: any, no: any) => Promise.resolve(resultado(table)).then(ok, no);
      if (prop === 'catch') return (no: any) => Promise.resolve(resultado(table)).catch(no);
      if (prop === 'finally') return (fn: any) => Promise.resolve(resultado(table)).finally(fn);
      return () => chain(table);
    },
    apply: () => chain(table),
  });
  return {
    estado,
    fakeClient: {
      from: (table: string) => chain(table),
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1' } } }),
        getSession: async () => ({ data: { session: null } }),
      },
      functions: { invoke: async () => ({ data: { success: true }, error: null }) },
      rpc: () => chain('rpc'),
    },
  };
});

vi.mock('@/integrations/supabase/client', () => ({ supabase: fakeClient }));
vi.mock('@/integrations/supabase/external-client', () => ({
  externalSupabase: fakeClient,
  ensureExternalSession: async () => {},
}));
vi.mock('@/lib/lovableCloudFunctions', () => ({
  cloudFunctions: { invoke: async () => ({ data: { success: true }, error: null }) },
}));
vi.mock('@/integrations/supabase/permissions', () => ({ getMyAllowedInstanceIds: async () => [] }));
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => ({ isAdmin: true }) }));
vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuthContext: () => ({ user: { id: 'u1' }, isAuthenticated: true, loading: false }),
}));
// Componentes vizinhos na barra: irrelevantes aqui e cada um abre suas queries.
vi.mock('@/components/voice/ActivityTTSButton', () => ({ ActivityTTSButton: () => null }));
vi.mock('@/components/activities/ActivityFieldSettingsDialog', () => ({ ActivityFieldSettingsDialog: () => null }));
vi.mock('@/components/activities/ActivityMessageTemplateSettings', () => ({ ActivityMessageTemplateSettings: () => null }));

import { SendToGroupSection } from '../ActivityFormCompact';

const renderSection = () =>
  render(
    <SendToGroupSection
      buildMsg={() => 'mensagem da atividade'}
      leadId="lead-1"
      activityId="atv-1"
      fieldSettings={[]}
      updateFieldSetting={() => {}}
      reorderFields={() => {}}
      compactLabel
    />,
  );

describe('SendToGroupSection — gravação junto do texto', () => {
  beforeEach(() => { estado.temGravacao = false; });

  it('oferece a gravação feita depois de a atividade abrir, já marcada', async () => {
    renderSection();
    const enviar = await screen.findByRole('button', { name: /^Enviar$/i });

    // A gravação nasce agora: quando a tela montou, a atividade não tinha áudio.
    estado.temGravacao = true;
    fireEvent.click(enviar);

    const caixa = await screen.findByRole('checkbox', { name: /Incluir gravação da ligação/i });
    expect(caixa.getAttribute('data-state')).toBe('checked');
  });

  it('não mostra a caixa quando a atividade não tem gravação', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: /^Enviar$/i }));

    await waitFor(() => expect(screen.getByText(/Revisar e enviar mensagem/i)).toBeTruthy());
    expect(screen.queryByText(/Incluir gravação da ligação/i)).toBeNull();
  });
});
