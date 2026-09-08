/**
 * O painel do assessor dentro da FICHA do cliente.
 *
 * A aba nova mostra o mesmo painel da tela de operação, recortado nos grupos
 * daquele lead. O que estes testes travam é justamente o recorte, porque errar
 * aqui não dá erro — dá vazamento silencioso: a fila do escritório inteiro
 * aparecendo dentro de um cliente, ou a fila daquele cliente sumindo por
 * comparação de jid em formatos diferentes.
 *
 *  1. os grupos da ficha vêm das DUAS fontes (ponte e cadastro) e são
 *     normalizados para a forma curta — as tabelas do Dom guardam sem '@g.us',
 *     as do lead guardam misturado;
 *  2. TODA consulta do Dom sai filtrada por esses grupos;
 *  3. ficha sem grupo não consulta nada e diz por quê, em vez de mostrar lista
 *     vazia (que se leria como "o assessor nunca falou com este cliente");
 *  4. as duas abas que não cabem numa ficha somem — "Nas conversas" procura em
 *     todos os grupos da fila, "Sem ficha" é a lista dos grupos órfãos;
 *  5. sem `leadId` o painel continua o de antes: nenhum filtro por grupo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const { dbMock, chamadas, dados } = vi.hoisted(() => {
  const chamadas: { tabela: string; filtros: [string, unknown][] }[] = [];
  const dados: Record<string, unknown[]> = {};
  const from = (tabela: string) => {
    const registro = { tabela, filtros: [] as [string, unknown][] };
    chamadas.push(registro);
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'not', 'ilike', 'order', 'limit', 'gte', 'lte', 'update', 'insert', 'delete']) {
      q[m] = () => q;
    }
    q.in = (coluna: string, valores: unknown) => { registro.filtros.push([coluna, valores]); return q; };
    q.maybeSingle = () => Promise.resolve({ data: (dados[tabela] || [])[0] ?? null, error: null });
    q.then = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: dados[tabela] || [], error: null, count: 0 }).then(res);
    return q;
  };
  return {
    dbMock: {
      from,
      rpc: async () => ({ data: [], error: null }),
      auth: { getSession: async () => ({ data: { session: null } }) },
    },
    chamadas,
    dados,
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

const LEAD = 'bfa75f67-e6a5-4a7f-8b1d-486b604c600f';
const JID = '120363426415223194';

/** As consultas às tabelas do Dom e o filtro de grupo que cada uma levou. */
const consultasDoDom = () =>
  chamadas.filter(c => c.tabela.startsWith('dom_') || c.tabela.startsWith('vw_dom_'));

const filtroDeGrupo = (c: { filtros: [string, unknown][] }) =>
  c.filtros.find(([coluna]) => coluna === 'group_jid')?.[1];

beforeEach(() => {
  chamadas.length = 0;
  for (const k of Object.keys(dados)) delete dados[k];
  // A ponte guarda com '@g.us', o cadastro guarda sem — os dois formatos que
  // existem de verdade no banco externo, no mesmo grupo.
  dados.lead_whatsapp_groups = [{ group_jid: `${JID}@g.us` }];
  dados.leads = [{ whatsapp_group_id: JID }];
  dados.dom_grupos_piloto = [{ group_jid: JID, group_name: 'PREV 1416 Angelica', modo: 'rascunho', ativo: true }];
  dados.dom_decisoes = [];
  dados.dom_respostas_pendentes = [{
    id: 'r1', group_jid: JID, instance_name: 'c9', agendamento_id: null,
    audio_url: null, audio_voz: null, audio_erro: null,
    audio_velocidade: null, audio_estabilidade: null, audio_estilo: null, audio_pausa_ms: null,
    group_name: 'PREV 1416 Angelica', pergunta: 'e a perícia?', pergunta_autor: 'Angélica',
    resposta_sugerida: 'A perícia já foi marcada.', resposta_final: null,
    intencao: 'A1', motivo_revisao: null, status: 'pendente',
    criado_em: '2026-09-08T17:00:00Z', enviado_em: null, atendente_id: null,
    contexto_usado: { processos: [{ numero: '0001723-93.2025.5.17.0191' }] },
  }];
});

describe('Atendente virtual dentro da ficha', () => {
  it('resolve os grupos nas duas fontes e normaliza o jid', async () => {
    render(<AtendenteVirtualPanel leadId={LEAD} />);
    await waitFor(() => expect(consultasDoDom().length).toBeGreaterThan(0));

    expect(chamadas.map(c => c.tabela)).toEqual(
      expect.arrayContaining(['lead_whatsapp_groups', 'leads']));
    // O mesmo grupo veio nos dois formatos e vira UM jid curto — é assim que as
    // tabelas do Dom guardam, e é a comparação que faz o recorte achar algo.
    for (const c of consultasDoDom()) expect(filtroDeGrupo(c)).toEqual([JID]);
  });

  it('nao vaza: toda consulta do Dom sai filtrada pelos grupos da ficha', async () => {
    render(<AtendenteVirtualPanel leadId={LEAD} />);
    await waitFor(() => expect(consultasDoDom().length).toBeGreaterThan(0));

    const semFiltro = consultasDoDom().filter(c => filtroDeGrupo(c) === undefined);
    expect(semFiltro.map(c => c.tabela)).toEqual([]);
    // A view dos grupos órfãos não é nem consultada: esta ficha existe.
    expect(chamadas.map(c => c.tabela)).not.toContain('vw_dom_grupo_sem_ficha');
  });

  it('mostra de qual processo a resposta falava', async () => {
    render(<AtendenteVirtualPanel leadId={LEAD} />);
    expect(await screen.findByText(/0001723-93\.2025\.5\.17\.0191/)).toBeInTheDocument();
  });

  it('some com as duas abas que nao cabem numa ficha', async () => {
    render(<AtendenteVirtualPanel leadId={LEAD} />);
    expect(await screen.findByRole('tab', { name: /Na fila/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Nas conversas/i })).toBeNull();
    expect(screen.queryByRole('tab', { name: /Sem ficha/i })).toBeNull();
  });

  it('ficha sem grupo diz por que esta vazia, e nao consulta o Dom', async () => {
    dados.lead_whatsapp_groups = [];
    dados.leads = [{ whatsapp_group_id: null }];
    render(<AtendenteVirtualPanel leadId={LEAD} />);
    expect(await screen.findByText(/não tem grupo de WhatsApp ligado/i)).toBeInTheDocument();
    expect(consultasDoDom()).toEqual([]);
  });

  it('sem leadId o painel continua o de antes, sem recorte por grupo', async () => {
    render(<AtendenteVirtualPanel />);
    await waitFor(() => expect(consultasDoDom().length).toBeGreaterThan(0));
    for (const c of consultasDoDom()) expect(filtroDeGrupo(c)).toBeUndefined();
    expect(chamadas.map(c => c.tabela)).toContain('vw_dom_grupo_sem_ficha');
  });
});
