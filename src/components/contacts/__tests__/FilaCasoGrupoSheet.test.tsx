/**
 * A fila caso ↔ grupo (passo 1 de "o grupo é o caso").
 *
 * O que estes testes travam:
 *  1. a linha mostra os DOIS leads com a evidência (processos de cada um) —
 *     sem isso a pessoa escolhe no escuro;
 *  2. "Ligar ao lead do caso" chama resolver_caso_grupo com a decisão certa e
 *     a linha some (a view passa a devolvê-la como "casado", fora da fila);
 *  3. o lote pede segundo clique e chama casar_caso_grupo sem argumento;
 *  4. classe que a RPC não aceita não mostra botão — a tela nunca oferece
 *     um clique que o banco vai recusar;
 *  5. a recusa da RPC chega como frase.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const { dbMock, dados, rpcChamadas, rpcResposta } = vi.hoisted(() => {
  const dados: Record<string, unknown[]> = {};
  const rpcChamadas: { fn: string; args: Record<string, unknown> | undefined }[] = [];
  const rpcResposta: { data: unknown; error: { message: string } | null } = { data: { ok: true }, error: null };
  const from = (tabela: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'not', 'in', 'order', 'limit']) q[m] = () => q;
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: dados[tabela] || [], error: null }).then(res);
    return q;
  };
  return {
    dbMock: {
      from,
      rpc: async (fn: string, args?: Record<string, unknown>) => { rpcChamadas.push({ fn, args }); return rpcResposta; },
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

import { FilaCasoGrupoSheet } from '../FilaCasoGrupoSheet';

const JID = '120363410348021695';

const linha = (extra: Record<string, unknown>) => ({
  lado: 'grupo', group_jid: `${JID}@g.us`, chave: JID, group_name: 'Prev 11 Elismar', fam: 'PREV', numero: 11, chave_txt: 'PREV 11',
  caso_id: 'c1', case_number: 'PREV 11', n_casos: 1, n_leads_cadastrados: 1,
  lead_grupo_id: 'lX', lead_grupo_nome: 'PREV 399 Suzanny', lead_grupo_via: 'ponte', lead_grupo_case_number: '399', lead_grupo_processos: 1,
  lead_caso_id: 'lY', lead_caso_nome: 'PREV 11 Elismar', lead_caso_case_number: '11', lead_caso_processos: 2,
  classe: 'leads_diferentes', o_que_fazer: 'decida',
  ...extra,
});

beforeEach(() => {
  for (const k of Object.keys(dados)) delete dados[k];
  rpcChamadas.length = 0;
  rpcResposta.data = { ok: true, acao: 'grupo_ligado_ao_lead_do_caso', tinha_outro_lead: true };
  rpcResposta.error = null;
  toast.success.mockClear(); toast.error.mockClear();
  dados.vw_caso_grupo_conciliacao = [linha({})];
});

describe('FilaCasoGrupoSheet', () => {
  it('mostra os dois leads com os processos de cada um', async () => {
    render(<FilaCasoGrupoSheet open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getAllByTestId('conciliacao')).toHaveLength(1));
    expect(screen.getByText('PREV 399 Suzanny')).toBeInTheDocument();
    expect(screen.getByText('PREV 11 Elismar', { selector: 'span.font-medium' })).toBeInTheDocument();
    expect(screen.getByText(/1 processo/)).toBeInTheDocument();
    expect(screen.getByText(/2 processos/)).toBeInTheDocument();
    expect(screen.getByText(/Dois leads para o mesmo número/)).toBeInTheDocument();
  });

  it('"Ligar ao lead do caso" chama a RPC e a linha some', async () => {
    const onResolvido = vi.fn();
    render(<FilaCasoGrupoSheet open onOpenChange={() => {}} onResolvido={onResolvido} />);
    await waitFor(() => expect(screen.getAllByTestId('conciliacao')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /Ligar ao lead do caso/ }));
    await waitFor(() => expect(rpcChamadas).toHaveLength(1));
    expect(rpcChamadas[0]).toEqual({ fn: 'resolver_caso_grupo', args: { p_group_jid: JID, p_decisao: 'ligar_ao_lead_do_caso' } });
    await waitFor(() => expect(screen.queryAllByTestId('conciliacao')).toHaveLength(0));
    expect(onResolvido).toHaveBeenCalledWith(1);
    expect(toast.success.mock.calls[0][0]).toMatch(/lead antigo continua/);
  });

  it('o lote pede confirmação e chama casar_caso_grupo', async () => {
    dados.vw_caso_grupo_conciliacao = [
      linha({ classe: 'casavel_cadastro_bate', lead_grupo_id: null, lead_grupo_nome: null, lead_grupo_via: null }),
      linha({ chave: '1203', group_jid: '1203@g.us', numero: 12, chave_txt: 'PREV 12', classe: 'casavel_sem_cadastro', lead_grupo_id: null, lead_grupo_nome: null, lead_grupo_via: null }),
      linha({ chave: '1204', group_jid: '1204@g.us', numero: 13, chave_txt: 'PREV 13' }),
    ];
    rpcResposta.data = [{ pontes_criadas: 2, deixados_na_fila: 1 }];
    render(<FilaCasoGrupoSheet open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getAllByTestId('conciliacao')).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: /Ligar os 2/ }));
    expect(rpcChamadas).toHaveLength(0);
    fireEvent.click(screen.getByTestId('confirmar-lote'));
    await waitFor(() => expect(rpcChamadas).toHaveLength(1));
    expect(rpcChamadas[0].fn).toBe('casar_caso_grupo');
    expect(rpcChamadas[0].args).toBeUndefined();
    await waitFor(() => expect(screen.getAllByTestId('conciliacao')).toHaveLength(1));
    expect(toast.success.mock.calls[0][0]).toMatch(/2 pontes criadas/);
  });

  it('classe que a RPC recusa não mostra o botão', async () => {
    dados.vw_caso_grupo_conciliacao = [linha({ classe: 'caso_duplicado', n_casos: 2 })];
    render(<FilaCasoGrupoSheet open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getAllByTestId('conciliacao')).toHaveLength(1));
    expect(screen.queryByRole('button', { name: /Ligar ao lead do caso/ })).toBeNull();
    expect(screen.getByText(/2 casos com este número/)).toBeInTheDocument();
  });

  it('recusa da RPC vira frase para a pessoa', async () => {
    rpcResposta.error = { message: 'Não dá para ligar daqui: escolha o lead' };
    render(<FilaCasoGrupoSheet open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getAllByTestId('conciliacao')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /Ligar ao lead do caso/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error.mock.calls[0][0]).toMatch(/escolha o lead/);
    expect(screen.getAllByTestId('conciliacao')).toHaveLength(1);
  });
});
