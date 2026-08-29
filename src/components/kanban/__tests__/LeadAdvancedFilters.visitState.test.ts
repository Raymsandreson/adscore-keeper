import { describe, it, expect } from 'vitest';
import {
  applyLeadFilters,
  emptyFilters,
  hasAnyLeadFilter,
  normalizeLeadFilters,
} from '../LeadAdvancedFilters';

const leads = [
  { id: '1', visit_state: 'SP' },
  { id: '2', visit_state: 'RJ' },
  { id: '3', visit_state: 'MG' },
  { id: '4', visit_state: null },
];

const ids = (rows: any[]) => rows.map(r => r.id);

describe('filtro de Estado multi-seleção', () => {
  it('lista vazia não filtra nada', () => {
    expect(ids(applyLeadFilters(leads, { ...emptyFilters, visitState: [] }))).toEqual(['1', '2', '3', '4']);
    expect(hasAnyLeadFilter({ ...emptyFilters, visitState: [] })).toBe(false);
  });

  it('uma UF filtra como antes', () => {
    expect(ids(applyLeadFilters(leads, { ...emptyFilters, visitState: ['SP'] }))).toEqual(['1']);
  });

  it('várias UFs somam os leads dos estados escolhidos', () => {
    expect(ids(applyLeadFilters(leads, { ...emptyFilters, visitState: ['SP', 'MG'] }))).toEqual(['1', '3']);
    expect(hasAnyLeadFilter({ ...emptyFilters, visitState: ['SP', 'MG'] })).toBe(true);
  });

  it('estado persistido no formato antigo (string) continua valendo', () => {
    const legacy = { ...emptyFilters, visitState: 'RJ' } as any;
    expect(ids(applyLeadFilters(leads, legacy))).toEqual(['2']);
    expect(normalizeLeadFilters(legacy).visitState).toEqual(['RJ']);
    expect(normalizeLeadFilters({ ...emptyFilters, visitState: '' }).visitState).toEqual([]);
    expect(normalizeLeadFilters(null).visitState).toEqual([]);
  });
});
