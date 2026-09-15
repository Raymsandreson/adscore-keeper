/**
 * O relatório de intenções nasce dobrado, e o número leva às conversas.
 *
 * A versão anterior despejava as 23 intenções abertas, em seis colunas e sete
 * cores — e nenhuma delas era clicável. Quem lia "Dinheiro ou prazo: 18" não
 * tinha como ver QUAIS 18 sem ir garimpar na fila ao lado.
 *
 * Três coisas travadas aqui:
 *   1. só as famílias em que demorar custa cliente abrem sozinhas; o resto
 *      mostra o total e guarda o detalhe;
 *   2. clicar numa intenção abre a aba lateral com as decisões DAQUELA
 *      intenção — e a consulta filtra no banco, não na memória;
 *   3. clicar numa decisão abre a conversa por cima, sem redirecionar
 *      (skill `ui-sem-redirecionar`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { dbMock, filtros, abrirConversa } = vi.hoisted(() => {
  /** Os filtros que a aba lateral mandou ao banco. */
  const filtros: { coluna: string; valor: unknown; tipo: 'eq' | 'is' }[] = [];
  const abrirConversa = vi.fn();

  const RESUMO = [
    // precisa de gente (nasce aberta)
    { intencao: 'E17', total: 18, respondeu: 0, precisou_gente: 18, calou: 0, pulou: 0, virou_fila: 18, grupos: 13, ultima: null },
    { intencao: 'E20', total: 9, respondeu: 0, precisou_gente: 9, calou: 0, pulou: 0, virou_fila: 9, grupos: 6, ultima: null },
    // não pede resposta (nasce dobrada, e é a maior de todas)
    { intencao: 'D13', total: 158, respondeu: 0, precisou_gente: 0, calou: 158, pulou: 0, virou_fila: 0, grupos: 136, ultima: null },
    // perguntou algo (nasce dobrada)
    { intencao: 'A1', total: 60, respondeu: 60, precisou_gente: 0, calou: 0, pulou: 0, virou_fila: 0, grupos: 49, ultima: null },
  ];

  const DECISOES_E17 = [
    {
      id: 'd1', group_jid: '120363@g.us', group_name: 'CASO MARIA',
      decisao: 'humano', motivo: 'fala em dinheiro', pergunta: 'quando cai o valor?',
      pendente_id: 'p1', criado_em: '2026-09-14T17:42:00Z',
    },
  ];

  const from = (tabela: string) => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.gte = () => q;
    q.eq = (coluna: string, valor: unknown) => { filtros.push({ coluna, valor, tipo: 'eq' }); return q; };
    q.is = (coluna: string, valor: unknown) => { filtros.push({ coluna, valor, tipo: 'is' }); return q; };
    q.order = () => q;
    q.limit = () => q;
    q.then = (res: (v: unknown) => unknown) => {
      const data = tabela === 'dom_decisoes' ? DECISOES_E17 : [];
      return Promise.resolve({ data, error: null, count: data.length }).then(res);
    };
    return q;
  };

  return {
    dbMock: {
      from,
      rpc: async (fn: string) => ({
        data: fn === 'dom_intencoes_resumo' ? RESUMO : [],
        error: null,
      }),
      auth: { getSession: async () => ({ data: { session: null } }) },
    },
    filtros,
    abrirConversa,
  };
});

vi.mock('@/integrations/supabase', () => ({
  db: dbMock, externalSupabase: dbMock, supabase: dbMock, authClient: dbMock,
  ensureExternalSession: () => Promise.resolve(),
  externalFunctionUrl: (n: string) => `https://exemplo/${n}`,
}));
vi.mock('@/lib/whatsappChatSheet', () => ({ openWhatsAppChatSheet: abrirConversa }));

/**
 * O gráfico não é o assunto do teste, e o `ResponsiveContainer` mede zero em
 * jsdom — desenharia nada e ainda pediria paciência a cada render.
 */
vi.mock('recharts', () => {
  const Nada = () => null;
  return {
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Bar: Nada, CartesianGrid: Nada, Legend: Nada, Tooltip: Nada, XAxis: Nada, YAxis: Nada,
  };
});

import { RelatorioDeIntencoes } from '../RelatorioDeIntencoes';

beforeEach(() => { filtros.length = 0; abrirConversa.mockClear(); });

describe('Relatório de intenções — dobrado por padrão, detalhe ao lado', () => {
  it('abre só o que exige gente; o resto mostra o total e guarda o detalhe', async () => {
    render(<RelatorioDeIntencoes />);

    // A família que custa cliente vem aberta, com as intenções à vista.
    expect(await screen.findByText('Dinheiro ou prazo')).toBeInTheDocument();
    expect(screen.getByText('Fala em desistir')).toBeInTheDocument();

    // A maior de todas em volume continua dobrada: o cabeçalho da família
    // aparece, a intenção dentro dela não.
    expect(screen.getByText('não pede resposta')).toBeInTheDocument();
    expect(screen.queryByText('Agradecimento, fechamento')).not.toBeInTheDocument();
    expect(screen.queryByText('Andamento do processo')).not.toBeInTheDocument();
  });

  it('o cabeçalho da família abre e fecha o que está dentro', async () => {
    const user = userEvent.setup();
    render(<RelatorioDeIntencoes />);

    await user.click(await screen.findByText('não pede resposta'));
    expect(await screen.findByText('Agradecimento, fechamento')).toBeInTheDocument();

    await user.click(screen.getByText('não pede resposta'));
    await waitFor(() =>
      expect(screen.queryByText('Agradecimento, fechamento')).not.toBeInTheDocument());
  });

  it('clicar no pedido abre a aba lateral e filtra AQUELA intenção no banco', async () => {
    const user = userEvent.setup();
    render(<RelatorioDeIntencoes />);

    await user.click(await screen.findByText('Dinheiro ou prazo'));

    // A conversa daquela intenção aparece ao lado…
    expect(await screen.findByText('CASO MARIA')).toBeInTheDocument();
    expect(screen.getByText('quando cai o valor?')).toBeInTheDocument();

    // …e o recorte foi feito pelo banco, não filtrando o que já estava na tela.
    await waitFor(() =>
      expect(filtros.some(f => f.tipo === 'eq' && f.coluna === 'intencao' && f.valor === 'E17')).toBe(true));
  });

  it('da aba lateral, a conversa abre por cima — nunca por redirecionamento', async () => {
    const user = userEvent.setup();
    render(<RelatorioDeIntencoes />);

    await user.click(await screen.findByText('Dinheiro ou prazo'));
    await user.click(await screen.findByText('CASO MARIA'));

    expect(abrirConversa).toHaveBeenCalledWith(expect.objectContaining({
      phone: '120363@g.us',
      contactName: 'CASO MARIA',
      forceSheet: true,
    }));
  });
});
