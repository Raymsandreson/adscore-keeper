import { describe, it, expect } from 'vitest';
import {
  INSS_PREV_OPTIONS,
  extractPrevNumber,
  isJudicialProcess,
  suggestPrevAssignee,
} from '@/lib/processAssignment';

const short = (n: string | null, judicial = false) =>
  suggestPrevAssignee(n, judicial)?.shortName ?? null;

describe('extractPrevNumber', () => {
  it('lê o número do case_number com e sem ruído antes do prefixo', () => {
    expect(extractPrevNumber('PREV 1984', null)).toBe('1984');
    expect(extractPrevNumber('✅PREV 1219', null)).toBe('1219');
    expect(extractPrevNumber('PREV1607', null)).toBe('1607');
    expect(extractPrevNumber('✅️PREV - 42', null)).toBe('42');
  });

  it('cai para o título quando o case_number não tem PREV', () => {
    expect(extractPrevNumber('CASO-0872', '✅PREV 1984 - AMANDA - (BPC/LOAS)')).toBe('1984');
  });

  it('prefere o case_number ao título quando os dois têm PREV', () => {
    expect(extractPrevNumber('PREV 1984', 'PREV 1219 - outro nome')).toBe('1984');
  });

  it('devolve null sem PREV numerado', () => {
    expect(extractPrevNumber('CASO 384', 'Camila - Fluxo BPC')).toBeNull();
    expect(extractPrevNumber(null, null)).toBeNull();
    expect(extractPrevNumber('PREV sem número', null)).toBeNull();
  });
});

describe('isJudicialProcess', () => {
  it('reconhece judicial em qualquer caixa e trata o resto como administrativo', () => {
    expect(isJudicialProcess('judicial')).toBe(true);
    expect(isJudicialProcess('Judicial')).toBe(true);
    expect(isJudicialProcess('administrativo')).toBe(false);
    expect(isJudicialProcess(null)).toBe(false);
    expect(isJudicialProcess(undefined)).toBe(false);
  });
});

describe('suggestPrevAssignee — rodízio administrativo por último dígito', () => {
  const esperado: Record<string, string> = {
    '0': 'Andressa', '1': 'Andressa',
    '2': 'Keliane', '3': 'Keliane',
    '4': 'José', '5': 'José',
    '6': 'Maria Lydia', '7': 'Maria Lydia',
    '8': 'Vanessa', '9': 'Vanessa',
  };

  for (const [digito, nome] of Object.entries(esperado)) {
    it(`final ${digito} → ${nome}`, () => {
      expect(short(`198${digito}`)).toBe(nome);
      expect(short(digito)).toBe(nome);
    });
  }
});

describe('suggestPrevAssignee — judicial por par/ímpar', () => {
  it('final ímpar → Gisele', () => {
    for (const n of ['1981', '1983', '1985', '1987', '1989']) {
      expect(short(n, true)).toBe('Gisele');
    }
  });

  it('final par → Isabela', () => {
    for (const n of ['1980', '1982', '1984', '1986', '1988']) {
      expect(short(n, true)).toBe('Isabela');
    }
  });

  it('judicial vence o rodízio administrativo do mesmo número', () => {
    expect(short('1984', false)).toBe('José');
    expect(short('1984', true)).toBe('Isabela');
  });
});

describe('suggestPrevAssignee — sem número', () => {
  it('não chuta responsável quando o PREV não tem número', () => {
    expect(suggestPrevAssignee(null, false)).toBeNull();
    expect(suggestPrevAssignee(null, true)).toBeNull();
  });
});

describe('INSS_PREV_OPTIONS', () => {
  it('tem os 7 assessores, sem UUID repetido', () => {
    expect(INSS_PREV_OPTIONS).toHaveLength(7);
    expect(new Set(INSS_PREV_OPTIONS.map(o => o.userId)).size).toBe(7);
  });

  it('não inclui KEILANE DE LIMA TEIXEIRA (blocklist)', () => {
    expect(INSS_PREV_OPTIONS.some(o => o.userId === 'f0a5dad8-5c5e-44f2-82b9-d8b9f022bb0c')).toBe(false);
  });
});
