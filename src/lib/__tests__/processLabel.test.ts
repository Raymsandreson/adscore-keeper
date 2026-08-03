import { describe, it, expect } from 'vitest';
import { formatProcessLabel, displayProcessLabel } from '@/lib/processLabel';

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
