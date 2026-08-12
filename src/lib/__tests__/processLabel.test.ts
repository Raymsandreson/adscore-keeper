import { describe, it, expect } from 'vitest';
import { formatProcessLabel, displayProcessLabel, displayCaseLabel } from '@/lib/processLabel';

/**
 * Regressão do CASO 382 (03/08/2026): a atividade "Dar andamento - INDENIZAÇÃO",
 * criada junto com o caso, guardou `process_title = "INDENIZAÇÃO"` enquanto o
 * processo tinha número desde o insert. O cabeçalho mostrava o título do processo
 * onde o usuário espera o nº do processo.
 */
describe('formatProcessLabel', () => {
  it('junta número e título no formato do formulário', () => {
    expect(formatProcessLabel('0000997-70.2025.5.23.0121', 'INDENIZAÇÃO'))
      .toBe('0000997-70.2025.5.23.0121 - INDENIZAÇÃO');
  });

  it('processo sem número fica só com o título', () => {
    expect(formatProcessLabel(null, 'Benefício INSS')).toBe('Benefício INSS');
    expect(formatProcessLabel('   ', 'Benefício INSS')).toBe('Benefício INSS');
  });
});

describe('displayProcessLabel', () => {
  const proc = { process_number: '0000997-70.2025.5.23.0121', title: 'INDENIZAÇÃO' };

  it('ignora o snapshot desatualizado e usa o processo vivo', () => {
    // process_title da atividade auto-criada veio só com o título
    expect(displayProcessLabel(proc, 'INDENIZAÇÃO'))
      .toBe('0000997-70.2025.5.23.0121 - INDENIZAÇÃO');
  });

  it('cai no snapshot quando o processo ainda não foi carregado', () => {
    expect(displayProcessLabel(null, 'INDENIZAÇÃO')).toBe('INDENIZAÇÃO');
    expect(displayProcessLabel(undefined, '0000997-70.2025.5.23.0121 - INDENIZAÇÃO'))
      .toBe('0000997-70.2025.5.23.0121 - INDENIZAÇÃO');
  });

  it('processo sem número nem título não apaga o snapshot', () => {
    expect(displayProcessLabel({ process_number: null, title: null }, 'INDENIZAÇÃO'))
      .toBe('INDENIZAÇÃO');
  });
});

/**
 * Regressão da atividade "CONSULTA - JACKSON - PERÍCIA E APOSENTADORIA"
 * (12/08/2026): `case_id`/`process_id` preenchidos com `case_title`/
 * `process_title` NULL. O cabeçalho condicionava a exibição ao título e o
 * vínculo sumia, enquanto o menu "Vincular" (que lê o id) oferecia "Remover".
 */
describe('rótulo do vínculo quando o snapshot veio nulo', () => {
  it('monta o rótulo do caso a partir do caso vivo', () => {
    expect(displayCaseLabel({ case_number: 'CASO 128', title: 'CASO 128' }, null))
      .toBe('CASO 128 - CASO 128');
  });

  it('monta o rótulo do processo a partir do processo vivo', () => {
    expect(displayProcessLabel(
      { process_number: '0000384-82.2022.5.05.0371', title: 'ACIDENTE DE TRABALHO' },
      null,
    )).toBe('0000384-82.2022.5.05.0371 - ACIDENTE DE TRABALHO');
  });

  it('título que chega com hífen na frente não vira hífen duplo', () => {
    // 363 processos tinham o título assim ("- ACIDENTE DE TRABALHO") em 12/08/2026
    expect(displayProcessLabel(
      { process_number: '0000384-82.2022.5.05.0371', title: '- ACIDENTE DE TRABALHO' },
      null,
    )).toBe('0000384-82.2022.5.05.0371 - ACIDENTE DE TRABALHO');
  });

  it('hífen no meio do nome é preservado', () => {
    expect(displayCaseLabel({ case_number: 'CASO 17 e 17.1', title: 'ACIDENTE - DORYEDSON' }, null))
      .toBe('CASO 17 e 17.1 - ACIDENTE - DORYEDSON');
  });

  it('sem dado vivo nem snapshot devolve vazio (a tela usa o texto genérico)', () => {
    expect(displayCaseLabel(null, null)).toBe('');
    expect(displayProcessLabel(null, null)).toBe('');
  });
});
