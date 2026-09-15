/**
 * O RASCUNHO QUE O TIME JÁ RESPONDEU SAI DA FILA — E CONTINUA À VISTA.
 *
 * Em 15/09/2026 a fila do atendente virtual tinha 449 cartões "esperando
 * revisão"; 417 eram de conversas em que um colega já tinha respondido o
 * cliente — o PREV 661 esperou cinco dias depois de já ter sido atendido.
 * Quem abria a tela via 449 pendências e uma delas era real a cada catorze.
 *
 * Quem marca é o banco (`dom_marcar_respondidas_por_humano`, migration
 * 20260915180000). Esta tela tem três obrigações, e é isto que está aqui:
 *
 *   1. não desenhar o respondido na fila — mas sem esconder: ele está na aba
 *      "Já respondidas", contado;
 *   2. mostrar a PROVA (quem falou, quando, o quê), senão "já respondida" é
 *      uma marca que ninguém consegue conferir;
 *   3. ter o caminho de volta: a varredura acha a fala do colega, não lê o que
 *      foi dito — quando ele falou de outro assunto, o rascunho volta à fila
 *      com um clique.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { dbMock, updates, selects } = vi.hoisted(() => {
  /** Toda consulta que saiu, com o filtro de status que a distingue. */
  const selects: { tabela: string; status: string[] }[] = [];
  /** O que a tela mandou gravar — é onde "devolver para a fila" se prova. */
  const updates: { tabela: string; dados: Record<string, unknown> }[] = [];

  const RESPONDIDA = {
    id: 'r-661', group_jid: '120363406537908571', instance_name: 'Atendimento Previdenciário 2',
    agendamento_id: null,
    audio_url: null, audio_voz: null, audio_erro: null,
    audio_velocidade: null, audio_estabilidade: null, audio_estilo: null, audio_pausa_ms: null,
    group_name: 'PREV 661 | nildoleonidodasilva', pergunta: 'Como é que tá os movimento por aí?',
    pergunta_autor: 'nildoleonidodasilva',
    resposta_sugerida: 'Seu processo está na fase de análise.', resposta_final: null,
    intencao: 'A1', motivo_revisao: 'prazo de contato', status: 'respondida_por_humano',
    criado_em: '2026-09-10T17:42:00Z', enviado_em: null, atendente_id: null, lead_id: null,
    contexto_usado: null,
    respondido_humano_em: '2026-09-11T12:41:00Z',
    respondido_humano_por: 'Atendimento Previdenciário 2',
    respondido_humano_texto: 'Oi senhor Nildo, bom dia. Seu processo tá em andamento, tá bom?',
    respondido_humano_msg_id: 'msg-1',
  };

  const from = (tabela: string) => {
    const q: Record<string, unknown> = { _status: [] as string[], _conta: false };
    q.select = (_colunas: string, opcoes?: { count?: string }) => {
      q._conta = opcoes?.count === 'exact';
      if (tabela === 'dom_respostas_pendentes') {
        selects.push({ tabela, status: q._status as string[] });
      }
      return q;
    };
    q.update = (dados: Record<string, unknown>) => {
      updates.push({ tabela, dados });
      return q;
    };
    for (const m of ['ilike', 'order', 'limit', 'gte', 'lte', 'is', 'not']) q[m] = () => q;
    q.in = (coluna: string, valores: string[]) => {
      if (coluna === 'status') (q._status as string[]).push(...valores);
      return q;
    };
    q.eq = (coluna: string, valor: unknown) => {
      if (coluna === 'status') (q._status as string[]).push(String(valor));
      return q;
    };
    q.maybeSingle = () => Promise.resolve({ data: null, error: null });
    q.then = (res: (v: unknown) => unknown) => {
      let data: unknown[] = [];
      let count = 0;
      if (tabela === 'dom_respostas_pendentes') {
        // O banco só devolve a respondida para quem pediu por ela. É assim que
        // a fila fica limpa sem a tela precisar filtrar nada na renderização.
        const pediuRespondida = (q._status as string[]).includes('respondida_por_humano');
        if (pediuRespondida) {
          count = 417;
          data = q._conta ? [{ intencao: 'A1' }] : [RESPONDIDA];
        }
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
    updates,
    selects,
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

beforeEach(() => { updates.length = 0; selects.length = 0; });

describe('Atendente virtual — o time já respondeu', () => {
  it('a fila NÃO pede o que já foi respondido, e a aba própria pede', async () => {
    render(<AtendenteVirtualPanel />);
    await waitFor(() => expect(selects.length).toBeGreaterThan(3));

    const daFila = selects.filter(s => s.status.includes('pendente'));
    expect(daFila.length).toBeGreaterThan(0);
    for (const s of daFila) expect(s.status).not.toContain('respondida_por_humano');

    expect(selects.some(s => s.status.length === 1
      && s.status[0] === 'respondida_por_humano')).toBe(true);
  });

  it('a aba conta as 417 e mostra QUEM respondeu, quando e o quê', async () => {
    const user = userEvent.setup();
    render(<AtendenteVirtualPanel />);

    const aba = await screen.findByRole('tab', { name: /Já respondidas/i });
    await waitFor(() => expect(aba).toHaveTextContent('417'));

    await user.click(aba);
    // A prova, no cartão: o nome de quem falou, o intervalo desde a pergunta e
    // o trecho do que foi dito. Sem isto a marca não dá para auditar.
    expect(await screen.findAllByText(/Atendimento Previdenciário 2 respondeu em/i))
      .not.toHaveLength(0);
    expect(screen.getAllByText(/19h depois/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Seu processo tá em andamento/i).length).toBeGreaterThan(0);
  });

  it('devolver para a fila volta o status e apaga a prova junto', async () => {
    const user = userEvent.setup();
    render(<AtendenteVirtualPanel />);

    await user.click(await screen.findByRole('tab', { name: /Já respondidas/i }));
    await user.click(await screen.findByText(/PREV 661/i));

    await user.click(await screen.findByRole('button', { name: /Devolver para a fila/i }));

    await waitFor(() => expect(updates.length).toBeGreaterThan(0));
    const u = updates.find(x => x.tabela === 'dom_respostas_pendentes');
    expect(u?.dados.status).toBe('pendente');
    // A evidência sai junto: mantê-la faria o cartão da fila continuar dizendo
    // "já respondida" para uma pendência que voltou a ser real.
    expect(u?.dados.respondido_humano_em).toBeNull();
    expect(u?.dados.respondido_humano_por).toBeNull();
    expect(u?.dados.respondido_humano_texto).toBeNull();
    expect(u?.dados.respondido_humano_msg_id).toBeNull();
  });
});
