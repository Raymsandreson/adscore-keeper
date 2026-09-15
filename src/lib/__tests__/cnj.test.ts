import { describe, it, expect } from 'vitest';
import { parseCnj, originScopeLabel, digitoVerificadorCnj, cnjDvValido, candidatosCnj, cnjDigitado } from '../cnj';
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

/**
 * Reparo do número torto. O caso de 09/09/2026 é o corpo de delito: o advogado
 * da reclamada mandou "0000846-69-2025-5-08-00009" no WhatsApp (traço no lugar
 * do ponto, zero a mais na unidade de origem) e a atividade nasceu sem processo.
 */
describe('dígito verificador do CNJ', () => {
  it('calcula o DD pelo módulo 97', () => {
    // 0000846-69.2025.5.08.0009 — processo real do CASO 307 (TRT8, 9ª VT de Belém).
    expect(digitoVerificadorCnj('000084620255080009')).toBe('69');
  });

  it('exige 18 dígitos', () => {
    expect(digitoVerificadorCnj('123')).toBeNull();
    expect(digitoVerificadorCnj('00008462025508000')).toBeNull();
  });

  it('confere o número inteiro', () => {
    expect(cnjDvValido('00008466920255080009')).toBe(true);
    // Mesmo número com o DD trocado: não fecha.
    expect(cnjDvValido('00008467020255080009')).toBe(false);
    expect(cnjDvValido('000084669202550800009')).toBe(false); // 21 dígitos
  });
});

describe('candidatosCnj', () => {
  it('devolve o próprio número quando já tem 20 dígitos', () => {
    const [c] = candidatosCnj('0000846-69.2025.5.08.0009');
    expect(c.digits).toBe('00008466920255080009');
    expect(c.reparado).toBe(false);
  });

  it('conserta o zero a mais na unidade de origem', () => {
    const cands = candidatosCnj('0000846-69-2025-5-08-00009');
    expect(cands).toHaveLength(1);
    expect(cands[0].formatted).toBe('0000846-69.2025.5.08.0009');
    expect(cands[0].reparado).toBe(true);
  });

  it('conserta o zero que faltou', () => {
    // Mesmo processo com o sequencial digitado sem um zero: 19 dígitos.
    const cands = candidatosCnj('000846-69.2025.5.08.0009');
    expect(cands.some((c) => c.formatted === '0000846-69.2025.5.08.0009')).toBe(true);
  });

  it('não inventa processo quando nenhum candidato fecha o DV', () => {
    // 21 dígitos aleatórios: nada aqui pode virar sugestão de vínculo.
    expect(candidatosCnj('123456789012345678901')).toHaveLength(0);
  });

  it('ignora o que não tem tamanho de CNJ', () => {
    expect(candidatosCnj('7219266600')).toHaveLength(0); // NB do INSS
    expect(candidatosCnj('')).toHaveLength(0);
    expect(candidatosCnj(null)).toHaveLength(0);
  });
});

describe('cnjDigitado — máscara automática na busca', () => {
  it('mascara o número colado sem separador nenhum', () => {
    expect(cnjDigitado('00008466920255080009')?.formatted).toBe('0000846-69.2025.5.08.0009');
  });

  it('conserta o zero perdido na cópia (caso real da busca, 09/09/2026)', () => {
    // 19 dígitos: é o processo 0000846-69.2025.5.08.0009 sem um zero à esquerda.
    const cnj = cnjDigitado('0008466920255080009');
    expect(cnj?.formatted).toBe('0000846-69.2025.5.08.0009');
    expect(cnj?.reparado).toBe(true);
  });

  it('não mexe no que já está mascarado', () => {
    expect(cnjDigitado('0000846-69.2025.5.08.0009')?.formatted).toBe('0000846-69.2025.5.08.0009');
  });

  it('deixa passar o que não é processo', () => {
    expect(cnjDigitado('11122233344')).toBeNull();      // CPF
    expect(cnjDigitado('5591988887777')).toBeNull();    // telefone com DDI
    expect(cnjDigitado('7219266600')).toBeNull();       // NB do INSS
    expect(cnjDigitado('CASO-369')).toBeNull();
    expect(cnjDigitado('Maria de Souza')).toBeNull();
    expect(cnjDigitado('')).toBeNull();
  });

  it('não escolhe por conta própria quando o reparo é ambíguo', () => {
    expect(cnjDigitado('123456789012345678901')).toBeNull();
  });
});
