// Trava quem é o cliente e como o lead/caso é nomeado quando um processo órfão
// vira caso. Caso real: 0017007-20.2016.5.16.0019 — ficha criada pelo inventário
// por OAB com o nome do cliente no título e o réu só na nota do cadastro.
import { describe, it, expect } from 'vitest';
import { nomeDoLead, notaDoLeadCriado, parteDoCliente, tituloDoCaso } from '@/lib/casoDoProcesso';

const AIRTON = {
  titulo: 'Airton de Sousa Carvalho',
  numero: '0017007-20.2016.5.16.0019',
  poloAtivo: 'Airton de Sousa Carvalho',
  poloPassivo: 'B e Q Energia Ltda',
  clientePolo: null,
};

describe('parteDoCliente', () => {
  it('o polo declarado manda', () => {
    expect(parteDoCliente({ ...AIRTON, clientePolo: 'PASSIVO' }))
      .toEqual({ nome: 'B e Q Energia Ltda', polo: 'PASSIVO' });
  });

  it('sem polo declarado, o título da ficha casa com o polo ativo', () => {
    expect(parteDoCliente(AIRTON)).toEqual({ nome: 'Airton de Sousa Carvalho', polo: 'ATIVO' });
  });

  it('casa mesmo com acento e caixa diferentes', () => {
    const r = parteDoCliente({ ...AIRTON, titulo: 'AIRTON DE SOUSA CARVALHO' });
    expect(r?.polo).toBe('ATIVO');
  });

  it('título que não casa com polo nenhum não vira cliente', () => {
    expect(parteDoCliente({ ...AIRTON, titulo: 'Reclamação do galpão' })).toBeNull();
  });

  it('sem polos e sem polo declarado não afirma lado', () => {
    expect(parteDoCliente({ titulo: 'Alguém', poloAtivo: null, poloPassivo: null })).toBeNull();
  });
});

describe('nomeDoLead', () => {
  it('nomeia como cliente x adversário', () => {
    expect(nomeDoLead(AIRTON)).toBe('Airton de Sousa Carvalho x B e Q Energia Ltda');
  });

  it('inverte quando representamos o réu', () => {
    expect(nomeDoLead({ ...AIRTON, clientePolo: 'PASSIVO' }))
      .toBe('B e Q Energia Ltda x Airton de Sousa Carvalho');
  });

  it('sem polos, usa o título da ficha', () => {
    expect(nomeDoLead({ titulo: 'Airton de Sousa Carvalho', numero: '123' }))
      .toBe('Airton de Sousa Carvalho');
  });

  it('sem nada, o número identifica — nunca devolve vazio', () => {
    expect(nomeDoLead({ numero: '0017007-20.2016.5.16.0019' }))
      .toBe('Processo 0017007-20.2016.5.16.0019');
    expect(nomeDoLead({})).toBe('Processo sem identificação');
  });

  it('não escreve "X x X" quando as duas pontas são a mesma', () => {
    expect(nomeDoLead({ poloAtivo: 'Fulano', poloPassivo: 'FULANO' })).toBe('Fulano');
  });
});

describe('tituloDoCaso', () => {
  it('segue o padrão dos casos criados pelo funil', () => {
    expect(tituloDoCaso(AIRTON)).toBe('Caso - Airton de Sousa Carvalho x B e Q Energia Ltda');
  });
});

describe('notaDoLeadCriado', () => {
  it('diz de onde o lead veio, com data e número', () => {
    const nota = notaDoLeadCriado(AIRTON, '2026-08-26');
    expect(nota).toContain('26/08/2026');
    expect(nota).toContain('0017007-20.2016.5.16.0019');
  });
});
