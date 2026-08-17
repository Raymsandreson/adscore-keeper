/**
 * A lista de protocolos precisa responder "quantos protocolos saíram entre o
 * PREV 1200 e o PREV 1400". Três coisas têm que valer ao mesmo tempo:
 *
 *  1. o número do caso não está no protocolo — vem do caso vinculado e, quando
 *     não há caso, do lead;
 *  2. a faixa não pode ser truncada pelo período que estava na tela;
 *  3. protocolo sem caso tem que oferecer o botão de vincular.
 *
 * Os dados do fake espelham o formato real do Externo (case_number sujo,
 * protocolo sem data, protocolo órfão).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const protocolos = [
  {
    id: 'p-1', requerimento_number: '1702770958', nome_segurado: 'ANA MARIA SOUZA',
    cpf_segurado: null, servico: 'Auxílio-Doença', benefit_type: null, benefit_number: null,
    current_status: 'Em análise', resultado: null, protocol_date: '2026-08-05',
    created_at: '2026-08-06T10:00:00.000Z', case_id: 'c-1206', lead_id: 'l-1',
  },
  {
    id: 'p-2', requerimento_number: '1368200196', nome_segurado: 'JOAO DA SILVA',
    cpf_segurado: null, servico: 'BPC', benefit_type: null, benefit_number: null,
    current_status: 'Exigência', resultado: null, protocol_date: '2026-07-22',
    created_at: '2026-07-23T10:00:00.000Z', case_id: 'c-1394', lead_id: 'l-2',
  },
  {
    // Fora da faixa: PREV 2050.
    id: 'p-3', requerimento_number: '952124262', nome_segurado: 'MARIA DAS DORES',
    cpf_segurado: null, servico: null, benefit_type: null, benefit_number: null,
    current_status: 'Protocolado', resultado: null, protocol_date: '2026-08-17',
    created_at: '2026-08-17T10:00:00.000Z', case_id: 'c-2050', lead_id: 'l-3',
  },
  {
    // Sem caso, número vindo do lead (leads.case_number = "1298") e SEM data
    // de protocolo — só entra quando o filtro por caso desliga o período.
    id: 'p-4', requerimento_number: '72704902', nome_segurado: 'PEDRO ALVES',
    cpf_segurado: null, servico: null, benefit_type: null, benefit_number: null,
    current_status: 'Em análise', resultado: null, protocol_date: null,
    created_at: '2026-07-28T10:00:00.000Z', case_id: null, lead_id: 'l-4',
  },
  {
    // Órfão puro: sem caso e sem lead, não tem número para comparar.
    id: 'p-5', requerimento_number: '999999999', nome_segurado: 'SEM DONO',
    cpf_segurado: null, servico: null, benefit_type: null, benefit_number: null,
    current_status: 'Em análise', resultado: null, protocol_date: '2026-08-10',
    created_at: '2026-08-10T10:00:00.000Z', case_id: null, lead_id: null,
  },
];

const casos = [
  { id: 'c-1206', case_number: 'PREV 1206' },
  { id: 'c-1394', case_number: '✅PREV 1394' },
  { id: 'c-2050', case_number: '✅prev 2050' },
];

const leads = [
  { id: 'l-1', lead_name: 'Ana Maria', case_number: 'PREV 1206' },
  { id: 'l-2', lead_name: 'João Silva', case_number: null },
  { id: 'l-3', lead_name: 'Maria Dores', case_number: null },
  { id: 'l-4', lead_name: 'Pedro Alves', case_number: '1298' },
];

/** Query builder mínimo: encadeia tudo e resolve na hora do await. */
function fakeQuery(linhas: any[]) {
  const q: any = {
    _rows: linhas,
    select: () => q,
    is: () => q,
    not: () => q,
    gte: () => q,
    lte: () => q,
    order: () => q,
    range: () => q,
    limit: () => q,
    in: (_col: string, ids: string[]) => {
      q._rows = q._rows.filter((r: any) => ids.includes(r.id));
      return q;
    },
    then: (resolve: any) => resolve({ data: q._rows, error: null }),
  };
  return q;
}

const dbFrom = vi.fn((tabela: string) => {
  if (tabela === 'inss_admin_processes') return fakeQuery([...protocolos]);
  if (tabela === 'legal_cases') return fakeQuery([...casos]);
  if (tabela === 'leads') return fakeQuery([...leads]);
  return fakeQuery([]);
});

vi.mock('@/integrations/supabase', () => ({
  db: { from: (t: string) => dbFrom(t) },
  authClient: { auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) } },
  ensureExternalSession: async () => {},
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/functionRouter', () => ({ cloudFunctions: { invoke: vi.fn() } }));

import ProtocolosListaSheet from '../ProtocolosListaSheet';

const abrir = () => render(<ProtocolosListaSheet open onOpenChange={() => {}} />);

describe('ProtocolosListaSheet — filtro por nº do caso/PREV', () => {
  beforeEach(() => {
    dbFrom.mockClear();
  });

  it('mostra o nº do caso de cada protocolo, inclusive o que vem do lead', async () => {
    abrir();
    // Vem do caso, com o emoji do banco limpo na exibição.
    expect(await screen.findByText('PREV 1394')).toBeInTheDocument();
    // Vem do lead (leads.case_number = "1298"), porque o protocolo não tem caso.
    expect(await screen.findByText('nº 1298')).toBeInTheDocument();
  });

  it('conta só os protocolos da faixa pedida', async () => {
    abrir();
    await screen.findByText('PREV 1206');

    fireEvent.change(screen.getByLabelText('Número de caso inicial'), { target: { value: 'PREV 1200' } });
    fireEvent.change(screen.getByLabelText('Número de caso final'), { target: { value: '1400' } });

    await waitFor(() => {
      expect(screen.getByText(/1–2 de 2 protocolo\(s\) de PREV 1200 até PREV 1400/)).toBeInTheDocument();
    });
    expect(screen.getByText('PREV 1206')).toBeInTheDocument();
    expect(screen.getByText('PREV 1394')).toBeInTheDocument();
    // PREV 2050 está fora da faixa; o órfão sem número também sai.
    expect(screen.queryByText('PREV 2050')).not.toBeInTheDocument();
    expect(screen.queryByText('SEM DONO')).not.toBeInTheDocument();
  });

  it('faixa sem prefixo não mistura PREV com número solto', async () => {
    abrir();
    await screen.findByText('PREV 1206');

    // Só o lead "1298" é da família sem prefixo.
    fireEvent.change(screen.getByLabelText('Número de caso inicial'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Número de caso final'), { target: { value: '9999' } });
    fireEvent.click(screen.getByLabelText('Sequência do número de caso'));
    fireEvent.click(await screen.findByRole('option', { name: 'Sem prefixo' }));

    await waitFor(() => {
      expect(screen.getByText('nº 1298')).toBeInTheDocument();
    });
    expect(screen.queryByText('PREV 1206')).not.toBeInTheDocument();
  });

  it('filtro por caso traz também o protocolo sem data de protocolo', async () => {
    abrir();
    await screen.findByText('PREV 1206');
    // No período padrão (30 dias) a linha sem data nem apareceria como tal.
    fireEvent.change(screen.getByLabelText('Número de caso inicial'), { target: { value: '1' } });

    await waitFor(() => {
      expect(screen.getByText('sem data de protocolo')).toBeInTheDocument();
    });
    expect(screen.getByText(/Filtro por caso ignora o período/)).toBeInTheDocument();
  });

  it('oferece vincular caso só para quem não tem caso', async () => {
    abrir();
    await screen.findByText('PREV 1206');

    // p-4 (lead sem caso) e p-5 (órfão) — dois botões, nada nos três com caso.
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Vincular caso/ })).toHaveLength(2);
    });
    expect(screen.getByText(/2 sem caso vinculado \(1 sem nem lead\)/)).toBeInTheDocument();
  });
});
