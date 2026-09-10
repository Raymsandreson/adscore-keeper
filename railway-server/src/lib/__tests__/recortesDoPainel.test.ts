import { describe, it, expect } from 'vitest';
import { acolhedorDoConjunto, funilDoNome } from '../recortesDoPainel';

describe('acolhedorDoConjunto', () => {
  // Os 30 formatos que existem hoje em leads.adset_name (medido em 10/09/2026).
  it('lê os formatos reais de nome de conjunto', () => {
    expect(acolhedorDoConjunto('CONJUNTO 3 - ISRAEL — Cópia')).toBe('ISRAEL');
    expect(acolhedorDoConjunto('CONJUNTO 6 - MATEUS — Cópia')).toBe('MATEUS');
    expect(acolhedorDoConjunto('CONJUNTO 5 EDILAN [2]')).toBe('EDILAN');
    expect(acolhedorDoConjunto('CONJUNTO - [ISRAEL]')).toBe('ISRAEL');
    expect(acolhedorDoConjunto('LEADS - MATEUS')).toBe('MATEUS');
    expect(acolhedorDoConjunto('ISRAEL 3')).toBe('ISRAEL');
  });

  it('trata KAROL como a mesma pessoa que KAROLYNE', () => {
    // Há uma só no quadro: Maria Karolyne de Aguiar Nunes. Separá-las partiria
    // o número dela em duas linhas que ninguém saberia somar.
    expect(acolhedorDoConjunto('CONJUNTO 4 KAROL — Cópia')).toBe('KAROLYNE');
    expect(acolhedorDoConjunto('CONJUNTO - KAROLYNE')).toBe('KAROLYNE');
    expect(acolhedorDoConjunto('LEADS - KAROL')).toBe('KAROLYNE');
  });

  it('devolve null quando o nome não nomeia ninguém', () => {
    expect(acolhedorDoConjunto('CONJUNTO 1')).toBeNull();
    expect(acolhedorDoConjunto('C1')).toBeNull();
    expect(acolhedorDoConjunto('C2-[ESTAGIÁRIO]')).toBeNull();
    expect(acolhedorDoConjunto('')).toBeNull();
    expect(acolhedorDoConjunto(null)).toBeNull();
  });

  it('não casa token dentro de outra palavra', () => {
    // O erro que este teste existe para impedir: `includes('KAROL')` daria
    // KAROLYNE aqui, e o número de uma pessoa entraria no recorte de outra.
    expect(acolhedorDoConjunto('CONJUNTO - KAROLINA')).toBeNull();
    expect(acolhedorDoConjunto('CONJUNTO - ISRAELITA')).toBeNull();
  });

  it('ignora o erro da Graph API gravado no lugar do nome', () => {
    expect(
      acolhedorDoConjunto("You don't have enough permission. Please refer to this help: https://www.facebook.com/business/help/766393076839635"),
    ).toBeNull();
  });
});

describe('funilDoNome', () => {
  it('lê a campanha da Meta', () => {
    expect(funilDoNome('BPC-LOAS')).toBe('bpc');
    expect(funilDoNome('[AUXÍLIO-ACIDENTE]')).toBe('auxilio_acidente');
  });

  it('lê o board do CRM, que tem outro nome para o mesmo funil', () => {
    // É por isso que os dois lados passam pela mesma função: "BPC - Autismo" e
    // "BPC-LOAS" são o mesmo funil escrito de dois jeitos.
    expect(funilDoNome('BPC - Autismo')).toBe('bpc');
    expect(funilDoNome('Auxílio Acidente')).toBe('auxilio_acidente');
  });

  it('devolve null para funil desconhecido', () => {
    expect(funilDoNome('Trabalhista')).toBeNull();
    expect(funilDoNome('')).toBeNull();
  });
});
