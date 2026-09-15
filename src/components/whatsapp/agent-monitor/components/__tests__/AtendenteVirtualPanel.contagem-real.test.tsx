/**
 * O número da aba é do BANCO, não do pedaço que coube na tela.
 *
 * A tela carrega as 100 mais recentes de cada aba — desenhar 449 cartões de
 * conversa trava o navegador. O número da aba, porém, vinha do mesmo array
 * desenhado: com 449 na fila e 375 silenciadas, as duas abas escreviam "100".
 * Quem abria de manhã lia um dia sob controle e decidia em cima disso.
 *
 * Aqui o que trava é a separação: a lista pode parar em 100, o número não pode.
 *   1. a aba mostra o total do banco, não o tamanho da lista carregada;
 *   2. a lista diz em voz alta que está mostrando um pedaço;
 *   3. o chip de intenção conta sobre TODAS as linhas, não sobre as 100;
 *   4. a consulta que conta pede só `intencao` — não arrasta pergunta e
 *      resposta de centenas de linhas para desenhar um número.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const { dbMock, selects, TABELAS_DA_FILA } = vi.hoisted(() => {
  /** Cada select que saiu, por tabela — para conferir o peso da contagem. */
  const selects: { tabela: string; colunas: string; contando: boolean }[] = [];
  /** As tabelas de onde saem os números das abas. `dom_grupos_piloto` também
   *  pede `count`, mas é o total de grupos do piloto — outro assunto. */
  const TABELAS_DA_FILA = ['dom_respostas_pendentes', 'dom_decisoes'];

  const NA_FILA_NO_BANCO = 449;
  const SILENCIADAS_NO_BANCO = 375;
  const CARREGADAS = 100;

  const linha = (i: number, intencao: string) => ({
    id: `r${i}`, group_jid: '1203634', instance_name: 'c9', agendamento_id: null,
    audio_url: null, audio_voz: null, audio_erro: null,
    audio_velocidade: null, audio_estabilidade: null, audio_estilo: null, audio_pausa_ms: null,
    group_name: `GRUPO ${i}`, pergunta: 'e a perícia?', pergunta_autor: 'Cliente',
    resposta_sugerida: 'A perícia já foi marcada.', resposta_final: null,
    intencao, motivo_revisao: null, status: 'pendente',
    criado_em: '2026-09-10T17:42:00Z', enviado_em: null, atendente_id: null,
    contexto_usado: null,
  });

  // Das 449 na fila, 40 são desistência (E20) — e só 5 delas estão entre as
  // 100 carregadas. É a diferença que o chip tem que enxergar.
  const intencaoDaFila = (i: number) => (i < 40 ? 'E20' : 'A1');

  const from = (tabela: string) => {
    const q: Record<string, unknown> = { _colunas: '', _conta: false, _aba: '' };
    q.select = (colunas: string, opcoes?: { count?: string }) => {
      q._colunas = colunas;
      q._conta = opcoes?.count === 'exact';
      selects.push({ tabela, colunas, contando: q._conta as boolean });
      return q;
    };
    for (const m of ['in', 'ilike', 'order', 'limit', 'gte', 'lte']) {
      q[m] = () => q;
    }
    // As três consultas em `dom_respostas_pendentes` se distinguem pelo
    // filtro, não pela tabela — o mock precisa saber qual é qual para devolver
    // a contagem de cada aba.
    q.is = (coluna: string) => { if (coluna === 'atendente_id') q._aba = 'fila'; return q; };
    q.not = (coluna: string) => { if (coluna === 'atendente_id') q._aba = 'humano'; return q; };
    q.eq = (coluna: string, valor: unknown) => {
      if (coluna === 'status' && valor === 'enviada') q._aba = 'enviadas';
      return q;
    };
    q.maybeSingle = () => Promise.resolve({ data: null, error: null });
    q.then = (res: (v: unknown) => unknown) => {
      let data: unknown[] = [];
      let count = 0;
      if (tabela === 'dom_respostas_pendentes') {
        // Só a fila tem volume: enviadas e com-humano ficam vazias, para o
        // chip de desistência poder ser conferido contra um número só.
        count = q._aba === 'fila' ? NA_FILA_NO_BANCO : 0;
        data = q._aba !== 'fila' ? [] : q._conta
          // A consulta leve traz TODAS as linhas, mas só a coluna `intencao`.
          ? Array.from({ length: NA_FILA_NO_BANCO }, (_, i) => ({ intencao: intencaoDaFila(i) }))
          : Array.from({ length: CARREGADAS }, (_, i) => linha(i + 1, intencaoDaFila(i + 400)));
      } else if (tabela === 'dom_decisoes') {
        count = SILENCIADAS_NO_BANCO;
        data = q._conta
          ? Array.from({ length: SILENCIADAS_NO_BANCO }, () => ({ intencao: 'D1' }))
          : Array.from({ length: CARREGADAS }, (_, i) => ({
              id: `d${i}`, group_name: `GRUPO ${i}`, group_jid: '1203634',
              intencao: 'D1', decisao: 'silencio', motivo: 'ninguém perguntou nada',
              pergunta: 'bom dia', criado_em: '2026-09-10T17:32:00Z',
            }));
      }
      return Promise.resolve({ data, error: null, count }).then(res);
    };
    return q;
  };

  return {
    dbMock: {
      from,
      rpc: async () => ({ data: [], error: null }),
      auth: { getSession: async () => ({ data: { session: null } }) },
    },
    selects,
    TABELAS_DA_FILA,
  };
});

vi.mock('@/integrations/supabase', () => ({
  db: dbMock, externalSupabase: dbMock, supabase: dbMock, authClient: dbMock,
  ensureExternalSession: () => Promise.resolve(),
  externalFunctionUrl: (n: string) => `https://exemplo/${n}`,
}));
vi.mock('@/lib/whatsappChatSheet', () => ({ openWhatsAppChatSheet: vi.fn() }));
vi.mock('@/components/whatsapp/ContagemAteEnvio', () => ({ ContagemAteEnvio: () => null }));

import { AtendenteVirtualPanel } from '../AtendenteVirtualPanel';

beforeEach(() => { selects.length = 0; });

describe('Atendente virtual — o número da aba é o do banco', () => {
  it('a aba conta o banco inteiro, não as 100 que couberam', async () => {
    render(<AtendenteVirtualPanel />);
    const fila = await screen.findByRole('tab', { name: /Na fila/i });
    await waitFor(() => expect(fila).toHaveTextContent('449'));
    expect(fila).not.toHaveTextContent('100');

    const silencio = screen.getByRole('tab', { name: /Silenciadas/i });
    expect(silencio).toHaveTextContent('375');
  });

  it('a lista avisa que está mostrando um pedaço', async () => {
    render(<AtendenteVirtualPanel />);
    expect(await screen.findByText(/Mostrando as 100 mais recentes de 449/i)).toBeInTheDocument();
  });

  it('o chip de intenção enxerga as 40 desistências, não as 5 carregadas', async () => {
    render(<AtendenteVirtualPanel />);
    const chip = await screen.findByRole('button', { name: /Desistência/i });
    await waitFor(() => expect(chip).toHaveTextContent('40'));
  });

  it('contar não arrasta pergunta e resposta: a consulta pede só a intenção', async () => {
    render(<AtendenteVirtualPanel />);
    await waitFor(() => expect(selects.some(s => s.contando)).toBe(true));
    const contagens = selects.filter(x => x.contando && TABELAS_DA_FILA.includes(x.tabela));
    expect(contagens.length).toBe(4);
    for (const s of contagens) expect(s.colunas).toBe('intencao');
  });
});
