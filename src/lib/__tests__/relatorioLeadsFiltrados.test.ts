import { describe, it, expect, vi } from 'vitest';

// O módulo do relatório importa o client do Externo por causa da busca de
// visitas; o que se testa aqui é a formatação, que é pura.
vi.mock('@/integrations/supabase', () => ({
  db: { from: vi.fn() },
  ensureExternalSession: vi.fn(async () => {}),
}));

const { montarRelatorioLeads, numeroDoLead, formatarLocal, formatarDataSimples, descreverFiltrosDoRelatorio } =
  await import('../relatorioLeadsFiltrados');
const { emptyFilters } = await import('@/components/kanban/LeadAdvancedFilters');

const board = {
  name: 'Acidente de Trabalho',
  stages: [
    { id: 'recepcao', name: 'Recepção', color: '#000' },
    { id: 'analise_viabilidade', name: 'Análise de viabilidade', color: '#111' },
  ],
};

const GERADO_EM = new Date('2026-09-14T15:32:00-03:00');

function lead(over: Record<string, any> = {}): any {
  return {
    id: 'l1',
    board_id: 'b1',
    status: 'recepcao',
    lead_status: null,
    lead_name: 'LEAD 330 César',
    lead_number: 2472,
    victim_name: 'César Alves Bilibio',
    victim_name_trim: 'César Alves Bilibio',
    victim_age: null,
    lead_phone: null,
    case_number: null,
    case_type: null,
    acolhedor: null,
    acolhedor_trim: null,
    accident_date: '2026-09-10',
    created_at: '2026-09-10T10:00:00Z',
    updated_at: '2026-09-10T10:00:00Z',
    visit_state: 'MS',
    visit_city: 'Campo Grande',
    visit_region: null,
    display_company: null,
    display_city: 'Campo Grande',
    display_state: 'MS',
    stage_entered_at: '2026-09-10T10:00:00Z',
    stage_position: 1,
    ...over,
  };
}

describe('montarRelatorioLeads', () => {
  it('escreve um bloco por lead com os cinco campos pedidos', () => {
    const texto = montarRelatorioLeads({
      board,
      rows: [lead()],
      visitasRealizadas: new Map([['l1', '2026-08-28']]),
      filtros: ['Estado: MS'],
      geradoEm: GERADO_EM,
    });

    expect(texto).toContain('RELATÓRIO DE LEADS — ACIDENTE DE TRABALHO');
    expect(texto).toContain('Gerado em 14/09/2026 15:32 · 1 lead');
    expect(texto).toContain('Filtros: Estado: MS');
    expect(texto).toContain('LEAD 2472 — César Alves Bilibio');
    expect(texto).toContain('  Cidade/UF: Campo Grande/MS');
    expect(texto).toContain('  Acidente: 10/09/2026');
    expect(texto).toContain('  Visita: 28/08/2026');
    expect(texto).toContain('  Etapa: Recepção');
  });

  it('marca com travessão o que o banco não tem, sem inventar valor', () => {
    const texto = montarRelatorioLeads({
      board,
      rows: [lead({ accident_date: null, display_city: null, display_state: null })],
      visitasRealizadas: new Map(),
      filtros: [],
      geradoEm: GERADO_EM,
    });

    expect(texto).toContain('  Cidade/UF: —');
    expect(texto).toContain('  Acidente: —');
    // Visita só aparece quando foi REALIZADA; agendada não conta.
    expect(texto).toContain('  Visita: —');
    expect(texto).toContain('Filtros: nenhum (funil inteiro)');
  });

  it('lead fechado mostra o status, não a etapa do funil', () => {
    const texto = montarRelatorioLeads({
      board,
      rows: [lead({ lead_status: 'closed' })],
      visitasRealizadas: new Map(),
      filtros: [],
      geradoEm: GERADO_EM,
    });
    expect(texto).toContain('  Etapa: Fechado');
  });

  it('etapa desconhecida cai no id do status em vez de sumir', () => {
    const texto = montarRelatorioLeads({
      board,
      rows: [lead({ status: 'etapa_removida' })],
      visitasRealizadas: new Map(),
      filtros: [],
      geradoEm: GERADO_EM,
    });
    expect(texto).toContain('  Etapa: etapa_removida');
  });

  it('avisa quando o filtro não deixou ninguém', () => {
    const texto = montarRelatorioLeads({
      board,
      rows: [],
      visitasRealizadas: new Map(),
      filtros: ['Estado: AC'],
      geradoEm: GERADO_EM,
    });
    expect(texto).toContain('· 0 leads');
    expect(texto).toContain('Nenhum lead corresponde ao filtro atual.');
  });
});

describe('numeroDoLead', () => {
  it('usa lead_number quando existe', () => {
    expect(numeroDoLead({ lead_number: 2472, case_number: 'C-9' })).toBe('LEAD 2472');
  });

  it('cai no número do caso e depois em marcador explícito', () => {
    expect(numeroDoLead({ lead_number: null, case_number: 'C-9' })).toBe('CASO C-9');
    expect(numeroDoLead({ lead_number: null, case_number: null })).toBe('(sem número)');
  });
});

describe('formatação de campos', () => {
  it('data pura não escorrega de dia por fuso', () => {
    expect(formatarDataSimples('2026-09-10')).toBe('10/09/2026');
    expect(formatarDataSimples(null)).toBe('—');
  });

  it('local aceita cidade sem UF e vice-versa', () => {
    expect(formatarLocal('Jaru', 'RO')).toBe('Jaru/RO');
    expect(formatarLocal(null, 'RO')).toBe('RO');
    expect(formatarLocal('Jaru', null)).toBe('Jaru');
    expect(formatarLocal('  ', null)).toBe('—');
  });
});

describe('descreverFiltrosDoRelatorio', () => {
  it('escreve data de filtro em dd/mm/aaaa e traz busca e acolhedor de fora', () => {
    const linhas = descreverFiltrosDoRelatorio(
      { ...emptyFilters, accidentDateFrom: '2026-08-01', visitState: ['MT', 'PA'] },
      { searchQuery: 'obra', acolhedorFilter: 'Israel' },
    );
    expect(linhas).toEqual([
      'Acolhedor: Israel',
      'Busca: "obra"',
      'Acidente de: 01/08/2026',
      'Estado: MT',
      'Estado: PA',
    ]);
  });

  it('sem filtro nenhum devolve lista vazia', () => {
    expect(descreverFiltrosDoRelatorio(emptyFilters)).toEqual([]);
  });
});
