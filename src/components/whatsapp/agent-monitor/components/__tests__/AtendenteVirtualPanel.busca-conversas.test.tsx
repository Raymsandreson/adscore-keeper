/**
 * Busca por texto do painel do assessor — o campo único embaixo das abas.
 *
 * Ela responde a uma pergunta diferente da busca por nome de grupo que já
 * existia no painel: aquela procura um grupo para LIGAR o atendente, esta
 * procura o que foi DITO nos grupos que já estão na fila esperando revisão.
 *
 * O que os testes travam:
 *  1. o campo está sempre à mão, embaixo da fita de abas — não é preciso
 *     entrar numa aba de busca para procurar;
 *  2. a busca chama a RPC recortada pela fila (`buscar_nas_conversas_da_fila`),
 *     e não uma consulta solta em whatsapp_messages;
 *  3. abaixo de 3 letras não chama nada;
 *  4. UMA consulta por termo, não uma por tecla. Em 09/09/2026 digitar
 *     "imposto de renda" disparou 15 chamadas, todas estouraram o statement
 *     timeout, e a tela virou uma pilha de erros vermelhos. É o teste que
 *     impede a volta disso;
 *  5. clicar num resultado abre a conversa em painel por cima, sem redirecionar.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { dbMock, rpcSpy, abrirConversa } = vi.hoisted(() => {
  const rpcSpy = vi.fn(async (nome: string) => {
    if (nome !== 'buscar_nas_conversas_da_fila') return { data: [], error: null };
    return {
      data: [{
        group_jid: '120363429440654066',
        group_name: 'PREV 1802 Izolete Muller - AUX. ACIDENTE',
        quem_falou: 'Yzolete Muller',
        direcao: 'inbound',
        quando: '2026-09-05T12:00:00Z',
        trecho: 'tem aqui INSS, mas que eu saiba nao fazem pericia, so em rio pardo',
        message_id: '11111111-1111-1111-1111-111111111111',
        pendencia_id: '22222222-2222-2222-2222-222222222222',
        intencao: 'A3',
      }],
      error: null,
    };
  });
  const q: Record<string, unknown> = {};
  for (const m of ['select','eq','in','is','not','ilike','order','limit','update','insert','delete','gte','lte']) q[m] = () => q;
  q.maybeSingle = () => Promise.resolve({ data: null, error: null });
  q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(res);
  return { dbMock: { from: () => q, rpc: rpcSpy }, rpcSpy, abrirConversa: vi.fn() };
});

vi.mock('@/integrations/supabase', () => ({
  db: dbMock, externalSupabase: dbMock, supabase: dbMock, authClient: dbMock,
  ensureExternalSession: () => Promise.resolve(),
}));
vi.mock('@/lib/whatsappChatSheet', () => ({ openWhatsAppChatSheet: abrirConversa }));
vi.mock('@/components/whatsapp/ContagemAteEnvio', () => ({ ContagemAteEnvio: () => null }));

import { AtendenteVirtualPanel } from '../AtendenteVirtualPanel';

/** Sem clicar em aba nenhuma: o campo tem que estar na tela assim que ela abre. */
async function abrirPainel() {
  const user = userEvent.setup();
  render(<AtendenteVirtualPanel />);
  return { user, campo: await screen.findByPlaceholderText(/Procurar no que foi dito/i) };
}

/** A consulta só sai meio segundo depois da última tecla. */
const ESPERA = { timeout: 3000 };

describe('Painel do assessor - busca nas conversas', () => {
  beforeEach(() => { rpcSpy.mockClear(); abrirConversa.mockClear(); });

  it('o campo fica embaixo das abas, sem precisar entrar numa aba de busca', async () => {
    await abrirPainel();
    expect(screen.queryByRole('tab', { name: /Nas conversas/i })).not.toBeInTheDocument();
  });

  it('busca pela RPC recortada pelos grupos da fila', async () => {
    const { user, campo } = await abrirPainel();
    await user.type(campo, 'pericia');
    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith('buscar_nas_conversas_da_fila',
        expect.objectContaining({ p_termo: 'pericia' }));
    }, ESPERA);
    expect(await screen.findByText(/Izolete Muller/, {}, ESPERA)).toBeInTheDocument();
    expect(await screen.findByText(/nao fazem pericia/, {}, ESPERA)).toBeInTheDocument();
  });

  it('nao chama o banco com menos de 3 letras', async () => {
    const { user, campo } = await abrirPainel();
    await user.type(campo, 'pe');
    expect(rpcSpy).not.toHaveBeenCalledWith('buscar_nas_conversas_da_fila', expect.anything());
    expect(await screen.findByText(/ao menos 3 letras/i)).toBeInTheDocument();
  });

  it('uma consulta por termo, nao uma por tecla', async () => {
    const { user, campo } = await abrirPainel();
    await user.type(campo, 'imposto de renda');
    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith('buscar_nas_conversas_da_fila',
        expect.objectContaining({ p_termo: 'imposto de renda' }));
    }, ESPERA);
    const chamadas = rpcSpy.mock.calls.filter(c => c[0] === 'buscar_nas_conversas_da_fila');
    expect(chamadas).toHaveLength(1);
  });

  it('clicar no resultado abre a conversa em painel, sem redirecionar', async () => {
    const { user, campo } = await abrirPainel();
    await user.type(campo, 'pericia');
    const linha = await screen.findByText(/Izolete Muller/, {}, ESPERA);
    await user.click(linha);
    expect(abrirConversa).toHaveBeenCalledWith(expect.objectContaining({
      phone: '120363429440654066',
      forceSheet: true,
      direction: 'bottom',
    }));
  });
});
