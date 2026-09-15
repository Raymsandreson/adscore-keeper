/**
 * Aba vazia PELO FILTRO tem que dizer onde a coisa está.
 *
 * O relato foi "não está filtrando": chip "Não pede resposta" marcado com 371,
 * aba "Na fila" aberta escrevendo "Nada esperando revisão". O filtro estava
 * certo — toda intenção D vira silêncio, e a fila nunca teve nenhuma —, mas a
 * tela não contava isso. Um número grande no chip e um vazio embaixo leem como
 * clique que não funcionou.
 *
 * O que trava aqui:
 *   1. a aba esvaziada pelo filtro nomeia as abas onde as linhas estão, com o
 *      número de cada uma;
 *   2. o botão leva para lá, sem tirar ninguém da tela;
 *   3. sem filtro, o vazio continua sendo a frase seca de sempre — aba vazia
 *      é aba vazia, e inventar caminho onde não há é pior que não dizer nada.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { dbMock } = vi.hoisted(() => {
  /** O recorte real medido em 15/09/2026 no Externo: 449 rascunhos na fila,
   *  NENHUM deles "não pede resposta", e 371 decisões de silêncio que são
   *  todas D. É exatamente o caso do relato. */
  const NA_FILA = 449;
  const SILENCIADAS = 371;
  const CARREGADAS = 100;

  const linha = (i: number) => ({
    id: `r${i}`, group_jid: '1203634', instance_name: 'c9', agendamento_id: null,
    audio_url: null, audio_voz: null, audio_erro: null,
    audio_velocidade: null, audio_estabilidade: null, audio_estilo: null, audio_pausa_ms: null,
    group_name: `GRUPO ${i}`, pergunta: 'e a perícia?', pergunta_autor: 'Cliente',
    resposta_sugerida: 'A perícia já foi marcada.', resposta_final: null,
    intencao: 'A1', motivo_revisao: null, status: 'pendente',
    criado_em: '2026-09-10T17:42:00Z', enviado_em: null, atendente_id: null,
    contexto_usado: null,
  });

  const from = (tabela: string) => {
    const q: Record<string, unknown> = { _conta: false, _aba: '' };
    q.select = (_colunas: string, opcoes?: { count?: string }) => {
      q._conta = opcoes?.count === 'exact';
      return q;
    };
    for (const m of ['in', 'ilike', 'order', 'limit', 'gte', 'lte']) {
      q[m] = () => q;
    }
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
        count = q._aba === 'fila' ? NA_FILA : 0;
        data = q._aba !== 'fila' ? [] : q._conta
          ? Array.from({ length: NA_FILA }, () => ({ intencao: 'A1' }))
          : Array.from({ length: CARREGADAS }, (_, i) => linha(i + 1));
      } else if (tabela === 'dom_decisoes') {
        count = SILENCIADAS;
        data = q._conta
          ? Array.from({ length: SILENCIADAS }, () => ({ intencao: 'D1' }))
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

/** Marca o chip "Não pede resposta" e devolve a tela já filtrada. */
async function filtrarPorNaoPedeResposta() {
  const user = userEvent.setup();
  render(<AtendenteVirtualPanel />);
  const chip = await screen.findByRole('button', { name: /Não pede resposta/i });
  await waitFor(() => expect(chip).toHaveTextContent('371'));
  await user.click(chip);
  return user;
}

describe('Atendente virtual — a aba vazia diz onde as conversas estão', () => {
  it('com o filtro que a fila não tem, a aba aponta para Silenciadas e mostra o número', async () => {
    await filtrarPorNaoPedeResposta();

    expect(await screen.findByText(/O filtro está\s+valendo/i)).toBeInTheDocument();
    const atalho = screen.getByRole('button', { name: /Silenciadas\s*371/i });
    expect(atalho).toBeInTheDocument();
  });

  it('o atalho leva para a aba onde elas estão, sem sair da tela', async () => {
    const user = await filtrarPorNaoPedeResposta();

    await user.click(await screen.findByRole('button', { name: /Silenciadas\s*371/i }));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Silenciadas/i })).toHaveAttribute('aria-selected', 'true');
    });
    // E a lista de silenciadas apareceu: o motivo é o texto do cartão.
    expect(await screen.findAllByText(/ninguém perguntou nada/i)).not.toHaveLength(0);
  });

  it('sem filtro, o vazio continua seco — não inventa caminho', async () => {
    const user = userEvent.setup();
    render(<AtendenteVirtualPanel />);
    // "Enviadas" está vazia no banco inteiro, e nada foi filtrado.
    await user.click(await screen.findByRole('tab', { name: /Enviadas/i }));

    expect(await screen.findByText(/Nenhuma mensagem chegou ao cliente ainda\./i)).toBeInTheDocument();
    expect(screen.queryByText(/O filtro está\s+valendo/i)).not.toBeInTheDocument();
  });
});
