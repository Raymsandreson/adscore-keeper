/**
 * Vínculo de lead no dialog "Editar Caso".
 *
 * Contexto: casos criados sem lead (ou com o lead errado) só tinham conserto
 * apagando e recriando o caso inteiro — foi assim que o CASO 118 virou dois
 * registros, um deles "COM ERRO" com 4 atividades órfãs.
 *
 * O invariante que este teste protege é o do banco: o trigger
 * `trg_legal_cases_no_unlink` recusa `lead_id` indo para NULL, porque isso
 * deixa o caso órfão e invisível para a equipe. A tela nunca pode tentar.
 */
import { describe, it, expect } from 'vitest';
import { buildCaseUpdatePayload } from '@/pages/CasesPage';

const base = {
  caseNumber: 'CASO 118',
  title: 'Caso 118- Flávio (MT-MA)',
  description: '',
  notes: '',
};

describe('buildCaseUpdatePayload — vínculo de lead', () => {
  it('vincula um lead a caso órfão', () => {
    const { leadChanged, payload } = buildCaseUpdatePayload({
      ...base, editLeadId: 'lead-novo', currentLeadId: null,
    });
    expect(leadChanged).toBe(true);
    expect(payload.lead_id).toBe('lead-novo');
  });

  it('troca o lead de um caso que já tinha outro', () => {
    const { leadChanged, payload } = buildCaseUpdatePayload({
      ...base, editLeadId: 'lead-b', currentLeadId: 'lead-a',
    });
    expect(leadChanged).toBe(true);
    expect(payload.lead_id).toBe('lead-b');
  });

  it('NUNCA envia lead_id nulo — caso com lead e campo vazio mantém o vínculo', () => {
    const { leadChanged, payload } = buildCaseUpdatePayload({
      ...base, editLeadId: null, currentLeadId: 'lead-a',
    });
    expect(leadChanged).toBe(false);
    expect(payload).not.toHaveProperty('lead_id');
  });

  it('caso órfão sem escolha de lead não manda lead_id', () => {
    const { leadChanged, payload } = buildCaseUpdatePayload({
      ...base, editLeadId: null, currentLeadId: null,
    });
    expect(leadChanged).toBe(false);
    expect(payload).not.toHaveProperty('lead_id');
  });

  it('salvar sem mexer no lead não marca mudança (não dispara o backfill)', () => {
    const { leadChanged, payload } = buildCaseUpdatePayload({
      ...base, editLeadId: 'lead-a', currentLeadId: 'lead-a',
    });
    expect(leadChanged).toBe(false);
    expect(payload).not.toHaveProperty('lead_id');
  });

  it('mantém os campos de texto normalizados', () => {
    const { payload } = buildCaseUpdatePayload({
      caseNumber: '  CASO 118  ', title: '  Flávio  ', description: '', notes: '',
      editLeadId: null, currentLeadId: 'lead-a',
    });
    expect(payload.case_number).toBe('CASO 118');
    expect(payload.title).toBe('Flávio');
    expect(payload.description).toBeNull();
    expect(payload.notes).toBeNull();
  });
});
