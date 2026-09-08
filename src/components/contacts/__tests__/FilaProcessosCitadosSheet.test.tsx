/**
 * A fila de processos citados com os dois botões.
 *
 * O que estes testes travam:
 *  1. a linha diz de quem é o processo E qual é o lead do grupo — sem isso a
 *     pessoa decide no escuro, que é o que a fila existe para evitar;
 *  2. "É deste grupo" e "Não é" chamam a MESMA RPC com a decisão certa, e a
 *     linha some depois — a view não a devolve mais, e recarregar tudo a cada
 *     clique seria uma consulta pesada por decisão;
 *  3. a recusa da RPC ("ligue o grupo a um lead primeiro") chega à pessoa
 *     como frase, não engolida.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const { dbMock, dados, rpcChamadas, rpcResposta } = vi.hoisted(() => {
  const dados: Record<string, unknown[]> = {};
  const rpcChamadas: { fn: string; args: Record<string, unknown> }[] = [];
  const rpcResposta: { data: unknown; error: { message: string } | null } = { data: { ok: true, acao: 'processo_do_grupo' }, error: null };
  const from = (tabela: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'not', 'in', 'order', 'limit']) q[m] = () => q;
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: dados[tabela] || [], error: null }).then(res);
    return q;
  };
  return {
    dbMock: {
      from,
      rpc: async (fn: string, args: Record<string, unknown>) => { rpcChamadas.push({ fn, args }); return rpcResposta; },
    },
    dados, rpcChamadas, rpcResposta,
  };
});

vi.mock('@/integrations/supabase', () => ({
  db: dbMock, externalSupabase: dbMock, supabase: dbMock, authClient: dbMock,
  ensureExternalSession: () => Promise.resolve(),
}));
vi.mock('@/integrations/supabase/group-lead-links', () => ({ invalidateGroupLeadCache: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { FilaProcessosCitadosSheet } from '../FilaProcessosCitadosSheet';

const JID = '120363410348021695';

beforeEach(() => {
  for (const k of Object.keys(dados)) delete dados[k];
  rpcChamadas.length = 0;
  rpcResposta.data = { ok: true, acao: 'processo_do_grupo' };
  rpcResposta.error = null;
  toast.success.mockClear(); toast.error.mockClear();
  dados.vw_grupo_processo_desalinhado = [{
    group_jid: JID, group_name: 'Caso 188 - Elias', processo: '0000123-45.2024.5.16.0001', cnj: '00001234520245160001',
    dono_do_processo: 'Caso 29 - Ivanilde', leads_donos: ['l1'], ocorrencias: 7, ultima_em: '2026-09-01T10:00:00Z',
    classe: 'caso_diferente', o_que_fazer: 'conferir',
  }];
  dados.lead_whatsapp_groups = [{ group_jid: `${JID}@g.us`, lead_id: 'l9', created_at: '2026-08-01' }];
  dados.leads = [{ id: 'l9', lead_name: 'Elias Teixeira' }];
});

describe('FilaProcessosCitadosSheet', () => {
  it('mostra de quem é o processo e qual é o lead do grupo', async () => {
    render(<FilaProcessosCitadosSheet open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByText('Caso 188 - Elias')).toBeInTheDocument());
    expect(screen.getByText('Caso 29 - Ivanilde')).toBeInTheDocument();
    expect(screen.getByText('Elias Teixeira')).toBeInTheDocument();
    expect(screen.getByText('número do caso não bate')).toBeInTheDocument();
  });

  it('"É deste grupo" chama a RPC com e_do_grupo e tira a linha', async () => {
    const onResolvido = vi.fn();
    render(<FilaProcessosCitadosSheet open onOpenChange={() => {}} onResolvido={onResolvido} />);
    await waitFor(() => expect(screen.getByText('É deste grupo')).toBeInTheDocument());
    fireEvent.click(screen.getByText('É deste grupo'));
    await waitFor(() => expect(rpcChamadas).toHaveLength(1));
    expect(rpcChamadas[0]).toEqual({
      fn: 'resolver_processo_citado',
      args: { p_group_jid: JID, p_cnj: '00001234520245160001', p_decisao: 'e_do_grupo' },
    });
    await waitFor(() => expect(screen.queryByTestId('citacao')).toBeNull());
    expect(onResolvido).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Marcado como processo do grupo.');
  });

  it('"Não é" manda nao_e_do_grupo', async () => {
    rpcResposta.data = { ok: true, acao: 'nao_e_do_grupo' };
    render(<FilaProcessosCitadosSheet open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByText('Não é')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Não é'));
    await waitFor(() => expect(rpcChamadas[0]?.args.p_decisao).toBe('nao_e_do_grupo'));
  });

  it('a recusa da RPC chega como frase e a linha fica', async () => {
    rpcResposta.data = null;
    rpcResposta.error = { message: 'O grupo não tem lead e o processo está em 2 leads. Escolha o lead do grupo primeiro (botão Vincular).' };
    render(<FilaProcessosCitadosSheet open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByText('É deste grupo')).toBeInTheDocument());
    fireEvent.click(screen.getByText('É deste grupo'));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(toast.error.mock.calls[0][0])).toContain('Escolha o lead do grupo primeiro');
    expect(screen.getByTestId('citacao')).toBeInTheDocument();
  });
});
