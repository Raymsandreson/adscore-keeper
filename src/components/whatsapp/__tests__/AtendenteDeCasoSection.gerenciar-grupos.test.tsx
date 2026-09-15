/**
 * A TELA DE CONFIGURAÇÃO DO ATENDENTE, DEPOIS DE 1.149 GRUPOS.
 *
 * O que o Raym viu em 09/09/2026: abriu "Como ele trabalha" para cadastrar
 * quem recebe as pendências do financeiro e não achou o campo. Ele estava lá —
 * embaixo de **1.149 linhas de grupo**, todas dizendo a mesma coisa (rascunho,
 * ligado). Uma lista em que cada linha é idêntica à anterior não informa nada
 * e ainda enterra tudo o que vem depois dela.
 *
 * O que estes testes travam:
 *
 *  1. quem recebe as pendências vem ANTES dos grupos, na ordem do DOM —
 *     é a diferença entre achar o campo e desistir de rolar;
 *  2. a lista mostra só quem foge do padrão, e diz quantos são os outros;
 *  3. a busca acha grupo que ele AINDA NÃO atende (os de só varredura), que é
 *     a única forma de incluir um;
 *  4. "Tirar" não apaga: devolve o grupo para a varredura, que é o que faz
 *     processo citado pela equipe continuar entrando sozinho na ficha;
 *  5. voz clonada que ainda não está pronta aparece na lista, desabilitada e
 *     com o motivo — sumir calada faz quem clonou achar que a clonagem falhou.
 *
 * O teste também é a rede contra TDZ e quebra no primeiro paint, que `tsc` e
 * `npm run build` não pegam.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const { dbMock, updates, dados } = vi.hoisted(() => {
  const updates: { tabela: string; patch: Record<string, unknown> }[] = [];
  const dados: Record<string, unknown[]> = {};
  const from = (tabela: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'is', 'not', 'order', 'limit', 'insert', 'delete']) {
      q[m] = () => q;
    }
    // O mock filtra de verdade: a tela carrega `.eq('so_varredura', false)` e
    // ignorar isso faria o teste medir uma lista que a tela nunca vê.
    const iguais: [string, unknown][] = [];
    q.eq = (col: string, val: unknown) => { iguais.push([col, val]); return q; };
    // A busca de grupo filtra no banco: guarda o termo para a resposta imitar
    // o que o PostgREST faria.
    let termo: string | null = null;
    q.ilike = (_col: string, padrao: string) => { termo = padrao.replace(/%/g, ''); return q; };
    q.update = (patch: Record<string, unknown>) => { updates.push({ tabela, patch }); return q; };
    q.maybeSingle = () => Promise.resolve({ data: (dados[tabela] || [])[0] ?? null, error: null });
    q.then = (res: (v: unknown) => unknown) => {
      const todos = (dados[tabela] || []) as Record<string, unknown>[];
      let linhas = todos.filter(x => iguais.every(([c, v]) => x[c] === v || c === 'id'));
      if (termo) {
        linhas = linhas.filter(x => String(x.group_name || '').toLowerCase().includes(termo!.toLowerCase()));
      }
      return Promise.resolve({ data: linhas, error: null }).then(res);
    };
    return q;
  };
  return {
    dbMock: { from, rpc: async () => ({ data: null, error: null }), auth: { getSession: async () => ({ data: { session: null } }) } },
    updates,
    dados,
  };
});

vi.mock('@/integrations/supabase', () => ({
  db: dbMock,
  ensureExternalSession: () => Promise.resolve(),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: dbMock }));

import { AtendenteDeCasoSection } from '../AtendenteDeCasoSection';

const AGENTE = 'd6ad8eee-d6a3-452c-b852-b94ef8dd54bf';

/** Um grupo no padrão do piloto: rascunho e ligado. São 1.149 assim. */
const noPadrao = (nome: string) => ({
  group_jid: `jid-${nome}`, group_name: nome, modo: 'rascunho', ativo: true, so_varredura: false,
});

beforeEach(() => {
  updates.length = 0;
  for (const k of Object.keys(dados)) delete dados[k];
  dados.wjia_command_shortcuts = [{
    contexto_processual: true, nome_atendente: 'Dom',
    genero_voz: 'masculina', reply_voice_id: null,
  }];
  dados.custom_voices = [
    { id: 'v-raym', name: 'Raym', status: 'ready' },
    { id: 'v-kely', name: 'Kely', status: 'processing' },
  ];
  dados.dom_grupos_piloto = [
    noPadrao('Caso 163 Esperantina'),
    noPadrao('Caso 165 Raimundo Nonato'),
    // A exceção: este responde sozinho, e é o único que merece a tela.
    { group_jid: 'jid-auto', group_name: 'PREV 1028 Bianca', modo: 'automatico', ativo: true, so_varredura: false },
    // Só varredura: não entra na lista, mas a busca tem que alcançar.
    { group_jid: 'jid-var', group_name: 'Caso 900 Fulano', modo: 'rascunho', ativo: false, so_varredura: true },
  ];
  dados.dom_atendentes = [
    { id: 'a1', nome: 'Keliane', whatsapp: '5586999984355', escopo: 'geral', is_active: true, position: 0 },
  ];
});

describe('Atendente de caso — configurar sem rolar mil grupos', () => {
  it('quem recebe as pendencias vem ANTES dos grupos', async () => {
    const { container } = render(<AtendenteDeCasoSection agentId={AGENTE} />);

    const pendencias = await screen.findByText(/Quem recebe quando precisa de humano/i);
    const grupos = screen.getByText(/Grupos que ele atende/i);
    // compareDocumentPosition: FOLLOWING = 4. O campo do financeiro tem que
    // estar acima da lista, senão ele volta a ficar enterrado.
    expect(pendencias.compareDocumentPosition(grupos) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container).toBeTruthy();
  });

  it('a lista mostra so quem foge do padrao, e diz quantos sao os outros', async () => {
    render(<AtendenteDeCasoSection agentId={AGENTE} />);

    // O que responde sozinho aparece.
    expect(await screen.findByText('PREV 1028 Bianca')).toBeInTheDocument();
    // Os que estão no padrão, não — eram eles os 1.149 que enterravam a tela.
    expect(screen.queryByText('Caso 163 Esperantina')).toBeNull();
    expect(await screen.findByText(/Fora do padrão \(1 de 3\)/i)).toBeInTheDocument();
  });

  it('a busca acha grupo que ele ainda NAO atende, e da para incluir', async () => {
    render(<AtendenteDeCasoSection agentId={AGENTE} />);
    await screen.findByText('PREV 1028 Bianca');

    fireEvent.change(
      screen.getByPlaceholderText(/Procurar grupo pelo nome/i),
      { target: { value: 'Caso 900' } },
    );

    expect(await screen.findByText('Caso 900 Fulano', {}, { timeout: 3000 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Passar a atender/i }));

    await waitFor(() => {
      const u = updates.find(x => x.tabela === 'dom_grupos_piloto' && 'so_varredura' in x.patch);
      expect(u?.patch).toEqual({ so_varredura: false, ativo: true });
    });
  });

  it('"Tirar" devolve o grupo para a varredura, e nao apaga a linha', async () => {
    render(<AtendenteDeCasoSection agentId={AGENTE} />);
    await screen.findByText('PREV 1028 Bianca');

    fireEvent.click(screen.getByRole('button', { name: /Tirar/i }));

    await waitFor(() => {
      const u = updates.find(x => x.tabela === 'dom_grupos_piloto' && 'so_varredura' in x.patch);
      // Apagar a linha levaria a varredura junto — e é ela que faz processo
      // citado pela equipe entrar sozinho na ficha.
      expect(u?.patch).toEqual({ so_varredura: true, ativo: false });
    });
  });

  it('voz clonada que ainda nao esta pronta aparece, com o motivo', async () => {
    render(<AtendenteDeCasoSection agentId={AGENTE} />);
    fireEvent.click(await screen.findByText(/Escolha a voz/i));

    expect(await screen.findByText(/🎤 Raym/)).toBeInTheDocument();
    // Some calada, quem mandou clonar acha que a clonagem falhou.
    expect(screen.getByText(/🎤 Kely/)).toBeInTheDocument();
    expect(screen.getByText(/ainda não dá para usar \(processing\)/i)).toBeInTheDocument();
  });
});
