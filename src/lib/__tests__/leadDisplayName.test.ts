import { describe, it, expect } from 'vitest';
import { temNomeDePessoa, ehSoCodigoDeDossie, displayLeadName } from '../leadDisplayName';

// Todos os rótulos abaixo saíram do banco em 04/09/2026.
describe('temNomeDePessoa', () => {
  it('recusa rótulo que é só o código do dossiê', () => {
    expect(temNomeDePessoa('LEAD314')).toBe(false);
    expect(temNomeDePessoa('LEAD 305')).toBe(false);
    expect(temNomeDePessoa('lead 304')).toBe(false);
    expect(temNomeDePessoa('PREV 1512')).toBe(false);
  });

  it('recusa rótulo que sobrou só com a pontuação da receita', () => {
    // Nasce quando os campos do lead estão vazios e só os literais `text:` entram.
    expect(temNomeDePessoa('PREV 1512 - ( ) Acd- -')).toBe(false);
    expect(temNomeDePessoa('PREV 1409 - ( ) Acd- -')).toBe(false);
    expect(temNomeDePessoa('✅LEAD 1512 - - (BPC/LOAS) -')).toBe(false);
  });

  it('recusa telefone e pontuação pura', () => {
    expect(temNomeDePessoa('11987654321')).toBe(false);
    expect(temNomeDePessoa('(86) 98151-3426')).toBe(false);
    expect(temNomeDePessoa('')).toBe(false);
    expect(temNomeDePessoa(null)).toBe(false);
  });

  it('aceita rótulo que carrega nome de gente junto do código', () => {
    expect(
      temNomeDePessoa('LEAD 301 | Nova Serrana/MG | Willian Rodrigues Gomes x Mac Supermercados | 26/08/2026'),
    ).toBe(true);
    expect(temNomeDePessoa('✅Prev 1663 James Benjamim/ Mateus - BPC/LOAS')).toBe(true);
    expect(temNomeDePessoa('CASO 106 - TORRE Mauro')).toBe(true);
    expect(temNomeDePessoa('PREV 384 /GEISIANE/ANUNCIO (AUX. MATERNIDADE) - LUIZ')).toBe(true);
  });

  it('aceita nome incompleto — é nome, só falta sobrenome', () => {
    // "Aline" e "Camila" são problema da cascata de resolução, não desta trava:
    // o rótulo diz de quem é, apenas não diz o nome inteiro.
    expect(temNomeDePessoa('Aline')).toBe(true);
    expect(temNomeDePessoa('Elisângela')).toBe(true);
  });

  it('não confunde sigla de UF com nome', () => {
    expect(temNomeDePessoa('PREV 1586 - SC')).toBe(false);
    expect(temNomeDePessoa('LEAD 22 | MG')).toBe(false);
  });
});

describe('ehSoCodigoDeDossie', () => {
  it('não acusa campo vazio — quem cuida do vazio é a obrigatoriedade do formulário', () => {
    expect(ehSoCodigoDeDossie('')).toBe(false);
    expect(ehSoCodigoDeDossie('   ')).toBe(false);
  });

  it('acusa o código puro', () => {
    expect(ehSoCodigoDeDossie('LEAD314')).toBe(true);
    expect(ehSoCodigoDeDossie('PREV 1512 - ( ) Acd- -')).toBe(true);
  });
});

describe('displayLeadName', () => {
  it('mantém o lead_name quando ele já diz de quem é', () => {
    const r = displayLeadName({ lead_name: 'Willian Rodrigues', client_name_resolved: 'Outro Nome' });
    expect(r.titulo).toBe('Willian Rodrigues');
    expect(r.codigo).toBeNull();
  });

  it('promove o nome resolvido quando o rótulo é código — e mantém o código à vista', () => {
    const r = displayLeadName({
      lead_name: 'LEAD314',
      client_name_resolved: 'João Damião Ramos',
      client_name_source: 'procuracao',
    });
    expect(r.titulo).toBe('João Damião Ramos');
    expect(r.codigo).toBe('LEAD314');
    expect(r.fonte).toBe('procuracao');
  });

  it('sem nome resolvido, mostra o código mesmo — nunca esconde a ficha', () => {
    const r = displayLeadName({ lead_name: 'LEAD314' });
    expect(r.titulo).toBe('LEAD314');
    expect(r.codigo).toBeNull();
  });
});
