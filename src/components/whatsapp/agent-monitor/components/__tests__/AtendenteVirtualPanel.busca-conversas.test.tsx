/**
 * Aba "Nas conversas" do painel do assessor.
 *
 * Ela responde a uma pergunta diferente da busca por nome de grupo que já
 * existia no painel: aquela procura um grupo para LIGAR o atendente, esta
 * procura o que foi DITO nos grupos que já estão na fila esperando revisão.
 *
 * O que os testes travam:
 *  1. a busca chama a RPC recortada pela fila (`buscar_nas_conversas_da_fila`),
 *     e não uma consulta solta em whatsapp_messages — o recorte é o que deixa
 *     a busca em 200 ms numa tabela de 1,7 milhão de linhas;
 *  2. abaixo de 3 letras não chama nada, para a digitação não virar uma
 *     varredura por tecla;
 *  3. clicar num resultado abre a conversa em painel por cima, sem redirecionar.
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

async function abrirAba() {
  const user = userEvent.setup();
  render(<AtendenteVirtualPanel />);
  await user.click(await screen.findByRole('tab', { name: /Nas conversas/i }));
  return { user, campo: await screen.findByPlaceholderText(/Procurar no que foi dito/i) };
}

describe('Painel do assessor - aba Nas conversas', () => {
  beforeEach(() => { rpcSpy.mockClear(); abrirConversa.mockClear(); });

  it('busca pela RPC recortada pelos grupos da fila', async () => {
    const { user, campo } = await abrirAba();
    await user.type(campo, 'pericia');
    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith('buscar_nas_conversas_da_fila',
        expect.objectContaining({ p_termo: 'pericia' }));
    });
    expect(await screen.findByText(/Izolete Muller/)).toBeInTheDocument();
    expect(await screen.findByText(/nao fazem pericia/)).toBeInTheDocument();
  });

  it('nao chama o banco com menos de 3 letras', async () => {
    const { user, campo } = await abrirAba();
    await user.type(campo, 'pe');
    expect(rpcSpy).not.toHaveBeenCalledWith('buscar_nas_conversas_da_fila', expect.anything());
    expect(await screen.findByText(/ao menos 3 letras/i)).toBeInTheDocument();
  });

  it('clicar no resultado abre a conversa em painel, sem redirecionar', async () => {
    const { user, campo } = await abrirAba();
    await user.type(campo, 'pericia');
    const linha = await screen.findByText(/Izolete Muller/);
    await user.click(linha);
    expect(abrirConversa).toHaveBeenCalledWith(expect.objectContaining({
      phone: '120363429440654066',
      forceSheet: true,
      direction: 'bottom',
    }));
  });
});
