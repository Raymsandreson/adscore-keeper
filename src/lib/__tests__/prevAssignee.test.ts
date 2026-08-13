import { describe, it, expect } from 'vitest';
import {
  INSS_PREV_OPTIONS,
  PREV_TRILHA_OPTIONS,
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

  it('aceita LEAD como prefixo — board BPC/LOAS desde 05/08/2026', () => {
    // O case_number costuma vir digitado só com o número; o prefixo sobra no título.
    expect(extractPrevNumber('2005', '✅LEAD 2005 - (BPC LOAS)')).toBe('2005');
    expect(extractPrevNumber('1999', 'Lead 1999 ( BPC/LOAS )')).toBe('1999');
    expect(extractPrevNumber('Lead 1939', null)).toBe('1939');
  });

  it('o número extraído do caso LEAD alimenta a divisão administrativa', () => {
    // Os dois terminam em ímpar (5 e 9) — desde 13/08/2026 isso é a Andressa.
    expect(short(extractPrevNumber('2005', '✅LEAD 2005 - (BPC LOAS)'))).toBe('Andressa');
    expect(short(extractPrevNumber('1999', 'Lead 1999 ( BPC/LOAS )'))).toBe('Andressa');
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

// Até 13/08/2026 o administrativo era rodízio de cinco por faixa de dígito
// (0-1 Andressa · 2-3 Keliane · 4-5 José · 6-7 Maria Lydia · 8-9 Vanessa).
// Virou divisão por paridade entre duas pessoas.
describe('suggestPrevAssignee — administrativo por par/ímpar', () => {
  const esperado: Record<string, string> = {
    '0': 'Maria Lydia', '1': 'Andressa',
    '2': 'Maria Lydia', '3': 'Andressa',
    '4': 'Maria Lydia', '5': 'Andressa',
    '6': 'Maria Lydia', '7': 'Andressa',
    '8': 'Maria Lydia', '9': 'Andressa',
  };

  for (const [digito, nome] of Object.entries(esperado)) {
    it(`final ${digito} → ${nome}`, () => {
      expect(short(`198${digito}`)).toBe(nome);
      expect(short(digito)).toBe(nome);
    });
  }

  it('Keliane, José e Vanessa não são mais sugeridos em nenhum dígito', () => {
    const sugeridos = new Set(
      Array.from({ length: 10 }, (_, d) => short(String(d))),
    );
    for (const fora of ['Keliane', 'José', 'Vanessa']) {
      expect(sugeridos.has(fora)).toBe(false);
    }
  });
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

  it('as duas trilhas usam a mesma paridade, com pessoas diferentes', () => {
    expect(short('1984', false)).toBe('Maria Lydia');
    expect(short('1984', true)).toBe('Isabela');
    expect(short('1985', false)).toBe('Andressa');
    expect(short('1985', true)).toBe('Gisele');
  });
});

describe('suggestPrevAssignee — sem número', () => {
  it('não chuta responsável quando o PREV não tem número', () => {
    expect(suggestPrevAssignee(null, false)).toBeNull();
    expect(suggestPrevAssignee(null, true)).toBeNull();
  });
});

describe('INSS_PREV_OPTIONS', () => {
  // Continua com os 7 mesmo depois de Keliane, José e Vanessa saírem da
  // escolha: é este catálogo que dá o nome canônico dos casos que já são deles.
  it('tem os 7 assessores, sem UUID repetido', () => {
    expect(INSS_PREV_OPTIONS).toHaveLength(7);
    expect(new Set(INSS_PREV_OPTIONS.map(o => o.userId)).size).toBe(7);
  });

  it('não inclui KEILANE DE LIMA TEIXEIRA (blocklist)', () => {
    expect(INSS_PREV_OPTIONS.some(o => o.userId === 'f0a5dad8-5c5e-44f2-82b9-d8b9f022bb0c')).toBe(false);
  });
});

describe('PREV_TRILHA_OPTIONS', () => {
  // Trava a ordem [ímpar, par] e as pessoas: PREV_TRILHA_OPTIONS aponta para
  // índices de INSS_PREV_OPTIONS, então reordenar o catálogo quebra aqui — que
  // é onde tem que quebrar, e não em produção.
  it('administrativo é [Andressa, Maria Lydia]', () => {
    expect(PREV_TRILHA_OPTIONS.administrativo.map(o => o.shortName))
      .toEqual(['Andressa', 'Maria Lydia']);
  });

  it('judicial é [Gisele, Isabela]', () => {
    expect(PREV_TRILHA_OPTIONS.judicial.map(o => o.shortName))
      .toEqual(['Gisele', 'Isabela']);
  });

  it('cada opção existe no catálogo, com o mesmo objeto', () => {
    for (const t of ['administrativo', 'judicial'] as const) {
      for (const o of PREV_TRILHA_OPTIONS[t]) {
        expect(INSS_PREV_OPTIONS).toContain(o);
      }
    }
  });
});
