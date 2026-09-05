import { describe, expect, it } from 'vitest';
// @ts-expect-error — script CLI em .mjs, sem tipos; o que importa aqui é a
// lógica pura de classificação/agregação que o relatório de CNPJ usa.
import { agregarPorAno, anoDoProcesso, classificarProcesso, mapearProcesso } from '../../../scripts/escavador-processos-por-cnpj.mjs';

describe('classificarProcesso', () => {
  it('reconhece acidente de trabalho no assunto normalizado', () => {
    expect(classificarProcesso({ assuntos: ['Acidente de Trabalho', 'Dano Moral'] })).toBe('ACIDENTE');
    expect(classificarProcesso({ assuntos: ['Acidente do Trabalho'] })).toBe('ACIDENTE');
    expect(classificarProcesso({ assunto_principal: 'Acidente de Trajeto' })).toBe('ACIDENTE');
  });

  it('reconhece doença ocupacional, inclusive escrita como LER/DORT', () => {
    expect(classificarProcesso({ assuntos: ['Doença Ocupacional'] })).toBe('DOENCA');
    expect(classificarProcesso({ assuntos: ['Moléstia Profissional'] })).toBe('DOENCA');
    expect(classificarProcesso({ assuntos: ['LER/DORT'] })).toBe('DOENCA');
  });

  it('marca AMBOS quando a capa traz os dois', () => {
    expect(classificarProcesso({ assuntos: ['Acidente de Trabalho', 'Doença Ocupacional'] })).toBe('AMBOS');
  });

  it('capa sem assunto/classe vira INDETERMINADO, nunca OUTRO', () => {
    expect(classificarProcesso({ assuntos: [] })).toBe('INDETERMINADO');
    expect(classificarProcesso({ assuntos: null, assunto_principal: null, classe: null })).toBe('INDETERMINADO');
  });

  it('matéria trabalhista comum não vira acidente', () => {
    expect(classificarProcesso({ assuntos: ['Rescisão do Contrato de Trabalho', 'Horas Extras'] })).toBe('OUTRO');
    expect(classificarProcesso({ classe: 'Execução Fiscal' })).toBe('OUTRO');
  });
});

describe('anoDoProcesso', () => {
  it('prefere a distribuição, cai para data_inicio e depois ano_inicio', () => {
    expect(anoDoProcesso({ data_distribuicao: '2020-11-24', data_inicio: '2019-01-01' })).toBe('2020');
    expect(anoDoProcesso({ data_inicio: '2019-01-01' })).toBe('2019');
    expect(anoDoProcesso({ ano_inicio: 2018 })).toBe('2018');
    expect(anoDoProcesso({})).toBe('sem_data');
  });
});

describe('mapearProcesso + agregarPorAno', () => {
  // Recorte real da resposta da v2 (mesma forma usada em escavadorCapa.test.ts).
  const item = (numero: string, data: string, assunto: string) => ({
    numero_cnj: numero,
    titulo_polo_ativo: 'Fulano',
    titulo_polo_passivo: 'Empresa X',
    ano_inicio: Number(data.slice(0, 4)),
    data_inicio: data,
    fontes: [{
      sigla: 'TRT07',
      tribunal: { sigla: 'TRT07' },
      capa: {
        classe: 'Ação Trabalhista - Rito Ordinário',
        area: 'Trabalhista',
        data_distribuicao: data,
        assuntos_normalizados: [{ nome: assunto }],
      },
    }],
  });

  it('agrega por ano separando acidente, doença e indeterminado', () => {
    const processos = [
      item('1', '2023-03-01', 'Acidente de Trabalho'),
      item('2', '2023-08-10', 'Doença Ocupacional'),
      item('3', '2023-09-20', 'Horas Extras'),
      item('4', '2024-02-02', 'Acidente de Trabalho'),
      { numero_cnj: '5', data_inicio: '2024-05-05', fontes: [] },
    ].map(mapearProcesso);

    const linhas = agregarPorAno(processos);
    expect(linhas.map((l: { ano: string }) => l.ano)).toEqual(['2023', '2024']);
    expect(linhas[0]).toMatchObject({ total: 3, acidente: 1, doenca: 1, outro: 1, indeterminado: 0 });
    expect(linhas[1]).toMatchObject({ total: 2, acidente: 1, indeterminado: 1, outro: 0 });
  });

  it('lê a capa de dentro de fontes[0]', () => {
    const p = mapearProcesso(item('0000972-32.2020.5.22.0001', '2020-11-24', 'Acidente de Trabalho'));
    expect(p.tribunal_sigla).toBe('TRT07');
    expect(p.classe).toBe('Ação Trabalhista - Rito Ordinário');
    expect(p.assuntos).toEqual(['Acidente de Trabalho']);
    expect(p.data_distribuicao).toBe('2020-11-24');
    expect(p.materia).toBe('ACIDENTE');
  });
});
