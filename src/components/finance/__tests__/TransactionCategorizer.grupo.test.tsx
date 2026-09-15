/**
 * "De qual CASO é esta despesa?" — no diálogo de categorizar.
 *
 * O grupo de WhatsApp é o caso. Antes dava para escolhê-lo aqui, mas só por
 * dentro da aba Lead: era preciso achar o lead certo ANTES. Quem olha um Pix de
 * R$ 48 reconhece o nome do grupo ("LEAD 2313 - JOELMA - BPC/LOAS"), não
 * necessariamente qual lead do CRM é aquele. Daí a aba própria.
 *
 * O que estes testes prendem — as quatro regras que o código promete:
 *  1. escolher o grupo grava `group_jid` E o `lead_id` DELE. Gravar só o jid
 *     sumiria com a despesa de todo relatório que soma por lead;
 *  2. escolher CONTATO larga o grupo. O grupo é do lead; contato de uma pessoa
 *     com o caso de outra é vínculo cruzado que ninguém vê;
 *  3. override que já tem `group_jid` abre direto na aba Grupo — foi a escolha
 *     mais específica que alguém fez;
 *  4. grupo sem lead vinculado é DITO na tela, e a despesa entra assim mesmo:
 *     o conserto é vincular o grupo ao lead na ficha, não adivinhar o lead.
 *
 * A busca de grupos roda de verdade contra o `db` falso: são 2.429 jids na
 * base, e o teste também prende que o filtro vai ao SERVIDOR (`or(...ilike...)`)
 * em vez de carregar a tabela para filtrar no navegador.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

interface GrupoFixture {
  group_jid: string;
  group_name: string | null;
  lead_id: string | null;
}

const { gravados, buscasNoServidor, GRUPOS, overrideAtual } = vi.hoisted(() => ({
  /** Cada chamada de `setTransactionOverride`, na ordem dos argumentos reais. */
  gravados: [] as unknown[][],
  /** Filtros `or(...)` que saíram para o PostgREST. */
  buscasNoServidor: [] as string[],
  GRUPOS: [
    { group_jid: 'jid-joelma@g.us', group_name: 'LEAD 2313 - JOELMA - BPC/LOAS', lead_id: 'lead-joelma' },
    { group_jid: 'jid-marcio@g.us', group_name: 'LEAD 2320 - MÁRCIO - AUX. ACIDENTE', lead_id: 'lead-marcio' },
    { group_jid: 'jid-orfao@g.us', group_name: 'GRUPO SEM LEAD NA FICHA', lead_id: null },
  ] as GrupoFixture[],
  /** O override que o diálogo encontra ao abrir. null = transação virgem. */
  overrideAtual: { valor: null as Record<string, unknown> | null },
}));

/**
 * `db` mínimo, mas com a cadeia REAL que `SeletorGrupoCaso` usa:
 * `.from().select().limit()` e depois `.or()` (busca) ou `.order()` (lista
 * inicial); `.eq().limit(1)` para resolver um jid já gravado.
 */
function consultaFalsa(tabela: string) {
  let jidPedido: string | null = null;
  const consulta = {
    select: () => consulta,
    limit: () => consulta,
    order: () => consulta,
    in: () => consulta,
    or: (filtro: string) => { buscasNoServidor.push(filtro); return consulta; },
    eq: (_coluna: string, valor: string) => { jidPedido = valor; return consulta; },
    then: (resolver: (r: { data: unknown; error: null }) => unknown) => {
      // `whatsapp_groups_index` só é consultada para grupo sem nome; as fixtures
      // têm nome, então aqui ela nunca devolve linha.
      const linhas = tabela === 'lead_whatsapp_groups'
        ? GRUPOS.filter(g => !jidPedido || g.group_jid === jidPedido)
        : [];
      return Promise.resolve({ data: linhas, error: null }).then(resolver);
    },
  };
  return consulta;
}

vi.mock('@/integrations/supabase', () => ({
  db: { from: (tabela: string) => consultaFalsa(tabela) },
}));

vi.mock('@/hooks/useExpenseCategories', () => ({
  useExpenseCategories: () => ({
    categories: [{ id: 'cat-1', name: 'Alimentação', icon: 'utensils', color: 'bg-orange-500', parent_id: null }],
    setTransactionOverride: vi.fn(async (...args: unknown[]) => { gravados.push(args); }),
    getTransactionOverride: () => overrideAtual.valor,
    getCategoryById: (id: string) => (id === 'cat-1' ? { id: 'cat-1', name: 'Alimentação' } : undefined),
    checkLimitViolation: () => null,
    getParentCategories: () => [
      { id: 'cat-1', name: 'Alimentação', icon: 'utensils', color: 'bg-orange-500', parent_id: null },
    ],
    getSubcategories: () => [],
    addCategory: vi.fn(),
    fetchCategories: vi.fn(),
  }),
}));

vi.mock('@/hooks/useContacts', () => ({
  useContacts: () => ({ contacts: [{ id: 'contato-1', full_name: 'Raquele Ingrid', city: 'Teresina', state: 'PI' }] }),
}));

vi.mock('@/hooks/useLeads', () => ({
  useLeads: () => ({
    leads: [
      { id: 'lead-joelma', lead_name: 'Joelma', lead_email: null, instagram_username: null, city: 'Teresina', state: 'PI' },
      { id: 'lead-marcio', lead_name: 'Márcio', lead_email: null, instagram_username: null, city: null, state: null },
    ],
  }),
}));

// `fetchCities` FORA da fábrica, de propósito: o hook real devolve identidade
// estável (useCallback) e o efeito que zera o formulário do diálogo tem essa
// função nas dependências. Um `vi.fn()` novo a cada render reproduziria aqui o
// bug que o hook tinha — o formulário se apagando sozinho — e o teste estaria
// medindo o mock, não o componente.
const buscarCidades = vi.fn();
vi.mock('@/hooks/useBrazilianLocations', () => ({
  useBrazilianLocations: () => ({
    states: [{ sigla: 'PI', nome: 'Piauí' }], cities: [], loadingCities: false, fetchCities: buscarCidades,
  }),
}));

vi.mock('@/hooks/useAccountCategoryLinks', () => ({
  useAccountCategoryLinks: () => ({ getCategoryIdsForAccount: () => null, addLinkForAccount: vi.fn() }),
}));

// O grupo POR DENTRO do lead continua existindo (aba Lead). Aqui não é o alvo.
vi.mock('@/hooks/useVinculoDespesas', () => ({
  useGruposDoLead: () => ({ grupos: [], carregando: false }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// O ScrollArea do Radix (listas de lead e contato) observa o tamanho do
// viewport, e o jsdom não tem ResizeObserver.
if (!(globalThis as { ResizeObserver?: unknown }).ResizeObserver) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import { TransactionCategorizer } from '../TransactionCategorizer';

const TRANSACAO = {
  id: 'tx-1',
  description: 'Pix enviado - Raquele Ingrid',
  amount: -48,
  category: null,
  merchant_name: null,
  merchant_cnpj: null,
  merchant_city: null,
  merchant_state: null,
  card_last_digits: null,
  transaction_date: '2026-09-10',
  transaction_time: '22:12',
};

/** Os argumentos de `setTransactionOverride`, com nome — a ordem é posicional. */
function ultimaGravacao() {
  const a = gravados[gravados.length - 1];
  return {
    transacao: a[0], categoria: a[1], contato: a[2], lead: a[3],
    linkAcknowledged: a[7],
    extras: a[9] as { group_jid?: string | null } | undefined,
  };
}

/** O Dialog do Radix põe `pointer-events: none` no body; sem isso o userEvent recusa o clique. */
const novoUsuario = () => userEvent.setup({ pointerEventsCheck: 0 });

function abrir() {
  return render(
    <TransactionCategorizer transaction={TRANSACAO} open onOpenChange={vi.fn()} />,
  );
}

/**
 * O gatilho do seletor de grupo. `getByRole('combobox')` sozinho não serve: a
 * mesma tela tem os selects de UF e cidade, com o mesmo papel.
 */
function comboboxDoGrupo() {
  return screen.getAllByRole('combobox')
    .find(el => /grupo do caso|LEAD |GRUPO SEM LEAD/i.test(el.textContent || '')) as HTMLElement;
}

/** Abre o combobox de grupo e escolhe pelo nome. */
async function escolherGrupo(usuario: ReturnType<typeof novoUsuario>, nome: string | RegExp) {
  await usuario.click(comboboxDoGrupo());
  const opcao = await screen.findByText(nome);
  await usuario.click(opcao);
}

describe('TransactionCategorizer — aba Grupo (o caso)', () => {
  beforeEach(() => {
    gravados.length = 0;
    buscasNoServidor.length = 0;
    overrideAtual.valor = null;
  });

  it('escolher o grupo grava o jid E o lead dele', async () => {
    const usuario = novoUsuario();
    abrir();

    await usuario.click(screen.getByRole('tab', { name: /Grupo \(caso\)/ }));
    await usuario.click(screen.getByRole('button', { name: /Alimentação/ }));
    await escolherGrupo(usuario, 'LEAD 2313 - JOELMA - BPC/LOAS');

    // O lead do caso aparece na tela: quem vincula ao caso está vinculando ao
    // cliente, e isso não pode acontecer escondido.
    expect(await screen.findByText(/Lead do caso: Joelma/)).toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: /^Salvar$/ }));

    await waitFor(() => expect(gravados).toHaveLength(1));
    const g = ultimaGravacao();
    expect(g.extras?.group_jid).toBe('jid-joelma@g.us');
    expect(g.lead).toBe('lead-joelma');
    expect(g.contato).toBeUndefined();
    // Vínculo feito NÃO é "olhei e não vinculei".
    expect(g.linkAcknowledged).toBe(false);
  });

  it('a busca do grupo vai ao servidor, não filtra a tabela no navegador', async () => {
    const usuario = novoUsuario();
    abrir();

    await usuario.click(screen.getByRole('tab', { name: /Grupo \(caso\)/ }));
    await usuario.click(comboboxDoGrupo());
    await usuario.type(screen.getByPlaceholderText(/Nome do grupo/), 'JOELMA');

    await waitFor(() => expect(buscasNoServidor.length).toBeGreaterThan(0));
    expect(buscasNoServidor[buscasNoServidor.length - 1]).toContain('ilike.%JOELMA%');
  });

  it('escolher contato LARGA o grupo — nada de contato com o caso de outro', async () => {
    const usuario = novoUsuario();
    abrir();

    await usuario.click(screen.getByRole('tab', { name: /Grupo \(caso\)/ }));
    await usuario.click(screen.getByRole('button', { name: /Alimentação/ }));
    await escolherGrupo(usuario, 'LEAD 2313 - JOELMA - BPC/LOAS');
    await screen.findByText(/Lead do caso: Joelma/);

    // Mudou de ideia: era do contato, não do caso.
    await usuario.click(screen.getByRole('tab', { name: /Contato/ }));
    await usuario.click(await screen.findByRole('button', { name: /Raquele Ingrid/ }));
    await usuario.click(screen.getByRole('button', { name: /^Salvar$/ }));

    await waitFor(() => expect(gravados).toHaveLength(1));
    const g = ultimaGravacao();
    expect(g.contato).toBe('contato-1');
    // As duas pontas do vínculo antigo têm de cair juntas.
    expect(g.extras?.group_jid).toBeNull();
    expect(g.lead).toBeUndefined();
  });

  it('override que já tem grupo abre direto na aba Grupo, com o nome na tela', async () => {
    overrideAtual.valor = {
      category_id: 'cat-1',
      lead_id: 'lead-marcio',
      contact_id: null,
      group_jid: 'jid-marcio@g.us',
      notes: 'táxi para a audiência',
      manual_city: null,
      manual_state: null,
    };
    abrir();

    const abaGrupo = screen.getByRole('tab', { name: /Grupo \(caso\)/ });
    await waitFor(() => expect(abaGrupo).toHaveAttribute('aria-selected', 'true'));
    // E diz QUAL grupo — jid cru na tela não é resposta para ninguém.
    expect(await screen.findByText(/LEAD 2320 - MÁRCIO/)).toBeInTheDocument();
  });

  it('grupo sem lead vinculado é dito na tela, e a despesa entra assim mesmo', async () => {
    const usuario = novoUsuario();
    abrir();

    await usuario.click(screen.getByRole('tab', { name: /Grupo \(caso\)/ }));
    await usuario.click(screen.getByRole('button', { name: /Alimentação/ }));
    await escolherGrupo(usuario, 'GRUPO SEM LEAD NA FICHA');

    expect(await screen.findByText(/não tem lead vinculado/i)).toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: /^Salvar$/ }));

    await waitFor(() => expect(gravados).toHaveLength(1));
    const g = ultimaGravacao();
    // O caso é gravado; o lead fica em branco porque NINGUÉM sabe qual é —
    // chutar aqui seria inventar vínculo.
    expect(g.extras?.group_jid).toBe('jid-orfao@g.us');
    expect(g.lead).toBeUndefined();
  });
});

describe('TransactionCategorizer — as outras abas seguem inteiras', () => {
  beforeEach(() => {
    gravados.length = 0;
    overrideAtual.valor = null;
  });

  it('vincular só ao lead continua gravando lead sem grupo', async () => {
    const usuario = novoUsuario();
    abrir();

    await usuario.click(screen.getByRole('button', { name: /Alimentação/ }));
    const listaLeads = screen.getByRole('tabpanel');
    await usuario.click(within(listaLeads).getByRole('button', { name: /Joelma/ }));
    await usuario.click(screen.getByRole('button', { name: /^Salvar$/ }));

    await waitFor(() => expect(gravados).toHaveLength(1));
    const g = ultimaGravacao();
    expect(g.lead).toBe('lead-joelma');
    expect(g.extras?.group_jid).toBeNull();
  });
});
