import { describe, it, expect } from 'vitest';
// Módulo do railway-server, puro — o vitest da raiz é o único runner.
import {
  casaNomeCompleto,
  escolherPorNome,
  tokensDePessoa,
  type AlvoNome,
} from '../../../railway-server/src/lib/inss-nome-match';

const alvo = (leadId: string, nome: string): AlvoNome => ({ leadId, nome, tokens: tokensDePessoa(nome) });

describe('tokensDePessoa', () => {
  it('joga fora rótulo de funil, número e preposição', () => {
    expect(tokensDePessoa('✅PREV 879 | Mariceli de Silva Barreto/ Aux. Maternidade'))
      .toEqual(['MARICELI', 'SILVA', 'BARRETO']);
  });

  it('acento não separa o mesmo nome', () => {
    expect(tokensDePessoa('Luan Antônio Silva')).toEqual(tokensDePessoa('LUAN ANTONIO SILVA'));
  });
});

describe('casaNomeCompleto', () => {
  const t = tokensDePessoa;

  it('aceita o segurado inteiro dentro do nome do lead', () => {
    expect(casaNomeCompleto(t('MARICELI DE SILVA BARRETO'), t('PREV 879 | Mariceli de Silva Barreto/ Aux.')))
      .toBe(true);
  });

  it('aceita o lead inteiro dentro do segurado quando são 3+ nomes', () => {
    expect(casaNomeCompleto(t('LUAN ANTONIO SILVA DE SOUZA'), t('Luan Antônio Silva'))).toBe(true);
  });

  it('recusa nome curto e genérico dentro de um nome completo', () => {
    // "Maria do Nascimento" casava com 3 seguradas diferentes na regra antiga.
    expect(casaNomeCompleto(t('MARIA ALICE NUNES NASCIMENTO'), t('Maria do Nascimento'))).toBe(false);
    expect(casaNomeCompleto(t('RITA MARIA FERREIRA DA SILVA'), t('maria silva'))).toBe(false);
  });

  it('nome repetido não vira terceiro nome', () => {
    // "Luiz Fernando/Fernando" tem 3 tokens e 2 nomes.
    expect(casaNomeCompleto(t('LUIZ FERNANDO ORTIZ JAENISCH'), t('✅️ Prev 41 Luiz Fernando/Fernando')))
      .toBe(false);
  });

  it('recusa interseção parcial — o defeito do primeiro+último', () => {
    expect(casaNomeCompleto(t('RITA MARIA FERREIRA DA SILVA'), t('Rita de Cassia Silva martins'))).toBe(false);
    expect(casaNomeCompleto(t('VALENTINA ARAUJO FRANCA'), t('Valentina Francavilla'))).toBe(false);
  });
});

describe('escolherPorNome', () => {
  it('devolve o lead quando ele é único', () => {
    const r = escolherPorNome('ELTON DE LIMA SANTOS', [
      alvo('lead-1', 'Elton de Lima Santos'),
      alvo('lead-2', 'Maria do Nascimento'),
    ]);
    expect(r.leadId).toBe('lead-1');
  });

  it('cala quando dois leads casam', () => {
    const r = escolherPorNome('ELTON DE LIMA SANTOS', [
      alvo('lead-1', 'Elton de Lima Santos'),
      alvo('lead-2', '✅PREV 12 Elton de Lima Santos / Anúncio'),
    ]);
    expect(r.leadId).toBeNull();
    expect(r.motivo).toContain('2 leads');
  });

  it('cala quando o segurado tem um nome só', () => {
    expect(escolherPorNome('MARLENE', [alvo('lead-1', 'Marlene Rodrigues Barbosa')]).leadId).toBeNull();
  });
});
