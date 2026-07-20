import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeDateInput } from '../normalizeDateInput';
import { sanitizeLeadDateFields, LEAD_DATE_COLUMNS } from '../sanitizeLeadDateFields';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('normalizeDateInput', () => {
  it('rejeita data parcial só com o ano (regressão do 22007 no lead 1804)', () => {
    expect(normalizeDateInput('2024')).toBeNull();
  });

  it.each([
    ['2024-XX-XX', null],
    ['', null],
    [null, null],
    [undefined, null],
    ['   ', null],
    ['2024-05', null],
    ['05/2024', null],
    ['2024-13-01', null],
    ['2024-02-30', null],
    ['maio de 2024', null],
    ['2024-01-01', '2024-01-01'],
    ['01/01/2024', '2024-01-01'],
    ['2024-01-01T12:00:00Z', '2024-01-01'],
    ['2024-01-01 12:00:00', '2024-01-01'],
  ])('normalizeDateInput(%p) -> %p', (input, expected) => {
    expect(normalizeDateInput(input as string | null | undefined)).toBe(expected);
  });

  it('nunca inventa mês ou dia', () => {
    for (const partial of ['2024', '2024-05', '05/2024', '2024/05']) {
      expect(normalizeDateInput(partial)).toBeNull();
    }
  });
});

describe('sanitizeLeadDateFields', () => {
  it('zera "2024" em todas as colunas date de leads', () => {
    const payload = Object.fromEntries(LEAD_DATE_COLUMNS.map((c) => [c, '2024']));
    const out = sanitizeLeadDateFields(payload) as Record<string, unknown>;
    for (const col of LEAD_DATE_COLUMNS) expect(out[col]).toBeNull();
  });

  it('sanitiza o payload real do lead 1804 (POST /rest/v1/leads?select=*)', () => {
    const payloadReal = {
      lead_name: 'Cláudio Narcizo',
      lead_phone: null,
      whatsapp_group_id: '120363428340556964',
      lead_email: null,
      source: 'whatsapp',
      created_by: 'cfab247e-c8e3-40c4-8aa7-5dbf367ea9b1',
      board_id: '2dcd54b5-502b-413b-b795-5e24a20797d2',
      city: null,
      state: null,
      neighborhood: null,
      action_source: 'system',
      accident_date: '2024',
      case_type: 'Aposentadoria por Invalidez',
      damage_description: 'Amputação da perna esquerda abaixo do joelho.',
      notes: 'Cliente busca aposentadoria por INSS.',
    };

    const out = sanitizeLeadDateFields(payloadReal);

    expect(out.accident_date).toBeNull();
    // Nenhum outro campo pode ser tocado.
    expect({ ...out, accident_date: '2024' }).toEqual(payloadReal);
  });

  it('preserva datas completas e valores nulos/ausentes', () => {
    const out = sanitizeLeadDateFields({
      accident_date: '2024-01-01',
      became_client_date: null,
      birth_date: undefined,
      classification_date: '01/01/2024',
    }) as Record<string, unknown>;

    expect(out.accident_date).toBe('2024-01-01');
    expect(out.became_client_date).toBeNull();
    expect(out.birth_date).toBeUndefined();
    expect(out.classification_date).toBe('2024-01-01');
  });

  it('trata string vazia e valores aninhados/não-string', () => {
    const out = sanitizeLeadDateFields({
      accident_date: '',
      expected_birth_date: { ano: 2024 } as unknown as string,
      inviavel_date: new Date(Date.UTC(2024, 0, 1)),
      notes: JSON.stringify({ accident_date: '2024' }),
    }) as Record<string, unknown>;

    expect(out.accident_date).toBeNull();
    expect(out.expected_birth_date).toBeNull();
    expect(out.inviavel_date).toBe('2024-01-01');
    // Data dentro de campo texto (JSON) não é coluna date: fica intacta.
    expect(out.notes).toBe('{"accident_date":"2024"}');
  });

  it('cobre insert em lote (array de payloads)', () => {
    const out = sanitizeLeadDateFields([
      { accident_date: '2024' },
      { accident_date: '2024-01-01' },
      { accident_date: '2024-XX-XX' },
    ]) as Array<Record<string, unknown>>;

    expect(out.map((r) => r.accident_date)).toEqual([null, '2024-01-01', null]);
  });

  it('não altera payloads que já estão válidos (mesma referência)', () => {
    const payload = { lead_name: 'x', accident_date: '2024-01-01' };
    expect(sanitizeLeadDateFields(payload)).toBe(payload);
  });
});
