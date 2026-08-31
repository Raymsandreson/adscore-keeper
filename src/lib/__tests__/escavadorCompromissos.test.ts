import { describe, it, expect } from 'vitest';
// O detector vive na pasta da edge (é lá que roda), mas é módulo puro — mesmo
// caso do processUpdateClassifier: o teste importa direto, sem cópia.
import { extractCompromissos } from '../../../supabase/functions/_shared/escavadorCompromissos';

type Mov = Parameters<typeof extractCompromissos>[0][number];
const mov = (conteudo: string, data = '2026-07-08'): Mov =>
  ({ conteudo, data } as unknown as Mov);

/**
 * A intimação real do 1017247-47.2025.4.01.3100 (08/07/2026) que o detector
 * errou duas vezes: o prazo estava escrito como "Prazo: 5 dias" (dois-pontos,
 * formato do ato ordinatório do PJe/TRF1) e não casava com nenhum padrão; e o
 * alvo saiu "sentença" por causa da lista genérica do cabeçalho da secretaria
 * ("ato ordinatório / despacho / decisão / sentença"), quando a ordem era
 * manifestar sobre a Contestação. Virou "Prazo — providência sobre sentença".
 */
const INTIMACAO_1017247 =
  'Seção Judiciária do Amapá 5ª Vara Federal INTIMAÇÃO VIA DIÁRIO ELETRÔNICO ' +
  'FINALIDADE: Intimar o(s) polo ativo acerca do(a) ato ordinatório / despacho / decisão / sentença ' +
  'proferido(a) nos autos. Prazo: 5 dias. ATO ORDINATÓRIO Intime-se a parte autora para se manifestar ' +
  'acerca da Contestação apresentada pelo réu. Prazo: 5 (cinco) dias úteis.';

describe('prazo com dois-pontos e alvo da providência (caso 1017247, 31/08/2026)', () => {
  const [c] = extractCompromissos([mov(INTIMACAO_1017247)]);

  it('"Prazo: 5 dias" é prazo em dias explícito', () => {
    expect(c).toBeDefined();
    expect(c.tipo).toBe('prazo');
    expect(c.prazo_dias).toBe(5);
  });

  it('o alvo é a contestação (o que a intimação manda fazer), não a lista genérica', () => {
    expect(c.titulo).toBe('Prazo de 5 dias — manifestação sobre a contestação');
    expect(c.titulo).not.toContain('sentença');
  });
});

describe('alvo genérico continua funcionando fora da lista da secretaria', () => {
  it('intimação de sentença de verdade mira a sentença', () => {
    const [c] = extractCompromissos([
      mov('Intimada a parte autora da sentença proferida nos autos, para, querendo, apresentar recurso no prazo de 10 dias.'),
    ]);
    expect(c.prazo_dias).toBe(10);
    expect(c.titulo).toBe('Prazo de 10 dias — providência sobre a sentença');
  });

  it('a lista "despacho / decisão / sentença" sem providência específica não vira "sentença"', () => {
    const [c] = extractCompromissos([
      mov('Intimar a parte autora acerca do(a) ato ordinatório / despacho / decisão / sentença proferido(a) nos autos, para cumprir. Prazo: 15 dias.'),
    ]);
    expect(c.prazo_dias).toBe(15);
    expect(c.titulo).toBe('Prazo de 15 dias — providência da intimação');
  });

  it('formato antigo "no prazo de N dias" segue casando', () => {
    const [c] = extractCompromissos([
      mov('Fica a parte intimada para se manifestar sobre o laudo pericial no prazo de 15 dias.'),
    ]);
    expect(c.prazo_dias).toBe(15);
    expect(c.titulo).toBe('Prazo de 15 dias — manifestação sobre o laudo');
  });
});
