import { describe, it, expect } from 'vitest';
import { parseCnj, originScopeLabel } from '../cnj';
import { normalizeUnitName, buildUnitKey, isContactStale } from '../courtCatalog';

/**
 * Os números abaixo são estruturas reais tiradas de `lead_processes` em
 * 06/08/2026 — o que importa é o par (segmento, TR, OOOO), não o sequencial.
 */
describe('parseCnj', () => {
  it('lê processo da Justiça do Trabalho e identifica a vara pela origem', () => {
    // TRT22, origem 0002 = 2ª Vara do Trabalho de Teresina.
    const info = parseCnj('0000123-45.2024.5.22.0002');
    expect(info).not.toBeNull();
    expect(info!.branch).toBe('trabalhista');
    expect(info!.courtCode).toBe('TRT22');
    expect(info!.uf).toBe('PI');
    expect(info!.originCode).toBe('0002');
    expect(info!.isTribunalOrigin).toBe(false);
  });

  it('lê processo estadual e resolve a UF pelo código do tribunal', () => {
    // TJPI, origem 0140 = comarca de Teresina.
    const info = parseCnj('08001234520248180140');
    expect(info!.branch).toBe('estadual');
    expect(info!.courtCode).toBe('TJPI');
    expect(info!.uf).toBe('PI');
    expect(info!.originCode).toBe('0140');
  });

  it('não força UF quando o tribunal cobre várias', () => {
    const trf1 = parseCnj('1000123-45.2023.4.01.4000');
    expect(trf1!.courtCode).toBe('TRF1');
    expect(trf1!.uf).toBeNull();
    expect(trf1!.ufs).toContain('PI');

    const trt8 = parseCnj('0000123-45.2024.5.08.0001');
    expect(trt8!.uf).toBeNull();
    expect(trt8!.ufs).toEqual(['PA', 'AP']);
  });

  it('usa a sigla corrente do tribunal do DF', () => {
    expect(parseCnj('07001234520248070001')!.courtCode).toBe('TJDFT');
  });

  it('marca origem 0000 como processo originário do tribunal', () => {
    expect(parseCnj('0800123-45.2024.8.14.0000')!.isTribunalOrigin).toBe(true);
  });

  it('devolve null para o que não é CNJ de 20 dígitos', () => {
    expect(parseCnj('123456789')).toBeNull();          // NB do INSS
    expect(parseCnj(null)).toBeNull();
    expect(parseCnj('')).toBeNull();
    expect(parseCnj('0000123-45.2024.0.22.0002')).toBeNull(); // segmento inexistente
  });

  it('rotula o escopo da origem conforme o ramo', () => {
    expect(originScopeLabel('trabalhista')).toBe('nesta vara');
    expect(originScopeLabel('estadual')).toBe('nesta comarca');
    expect(originScopeLabel('federal')).toBe('nesta subseção');
  });
});

describe('agrupamento por unidade', () => {
  it('junta secretaria e gabinete da mesma vara', () => {
    const secretaria = buildUnitKey('TJPI', '6ª Vara Cível de Teresina');
    const gabinete = buildUnitKey('TJPI', 'Gabinete da 6° Vara Cível da Comarca de Teresina');
    expect(secretaria).toBe(gabinete);
  });

  it('gera exatamente as chaves gravadas no backfill da migration', () => {
    expect(buildUnitKey('TJPI', '6ª Vara Cível de Teresina')).toBe('TJPI:6-vara-civel-teresina');
    expect(buildUnitKey('TRT23', '5ª Vara do Trabalho de Cuiabá')).toBe('TRT23:5-vara-trabalho-cuiaba');
    expect(buildUnitKey('TJMA', 'Vara Única de Peritoró')).toBe('TJMA:vara-unica-peritoro');
    expect(buildUnitKey('TJPA', 'Gab. Desa. Gleide Pereira de Moura')).toBe('TJPA:gab-desa-gleide-pereira-moura');
    expect(buildUnitKey('TRT21', 'Gab. Des. Carlos Newton')).toBe('TRT21:gab-des-carlos-newton');
  });

  it('não funde unidades distintas do mesmo tribunal', () => {
    expect(normalizeUnitName('6ª Vara Cível de Teresina'))
      .not.toBe(normalizeUnitName('4ª Vara Cível de Teresina'));
    expect(buildUnitKey('TJPI', '1ª Vara do Trabalho de Teresina'))
      .not.toBe(buildUnitKey('TRT22', '1ª Vara do Trabalho de Teresina'));
  });

  it('devolve null quando não há nome de unidade', () => {
    expect(buildUnitKey('TJPI', '')).toBeNull();
    expect(buildUnitKey('TJPI', null)).toBeNull();
  });
});

describe('validade do contato', () => {
  const old = new Date(Date.now() - 400 * 86_400_000).toISOString();
  const recent = new Date(Date.now() - 30 * 86_400_000).toISOString();

  it('envelhece gabinete sem confirmação há mais de 12 meses', () => {
    expect(isContactStale('gabinete', null, old)).toBe(true);
    expect(isContactStale('gabinete', recent, old)).toBe(false);
  });

  it('não envelhece secretaria de vara, que é contato estável', () => {
    expect(isContactStale('secretaria', null, old)).toBe(false);
  });
});
