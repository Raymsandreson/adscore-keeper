import { describe, expect, it } from 'vitest';
import {
  agregarPorAno, anoDoProcesso, classificarMateria, cnpjDaFilial, cnpjValido,
  cnpjsDaRaiz, csvPorAno, csvProcessos, digitosVerificadores, formatarCnpj,
  itensDaResposta, mapearProcessoDaEmpresa, percentualAcidentarios, poloDaEmpresa,
  proximaPagina, raizDoCnpj, totalizar,
} from '../processosDaEmpresa';

// Recorte real da resposta v2 (mesma forma do fixture de escavadorCapa.test.ts).
const item = (numero: string, data: string, assunto: string | null, extra: Record<string, unknown> = {}) => ({
  numero_cnj: numero,
  titulo_polo_ativo: 'Fulano de Tal',
  titulo_polo_passivo: 'Empresa X Ltda',
  ano_inicio: Number(data.slice(0, 4)),
  data_inicio: data,
  estado_origem: { nome: 'Ceará', sigla: 'CE' },
  fontes: [{
    sigla: 'TRT07',
    tribunal: { sigla: 'TRT07', nome: 'TRT da 7ª Região' },
    capa: {
      classe: 'Ação Trabalhista - Rito Ordinário',
      area: 'Trabalhista',
      data_distribuicao: data,
      valor_causa: { valor: '50000.00', valor_formatado: 'R$ 50.000,00' },
      assuntos_normalizados: assunto ? [{ nome: assunto }] : [],
    },
    ...extra,
  }],
});

describe('CNPJ — raiz, filial e dígito verificador', () => {
  // Os quatro são CNPJs reais da mesma raiz (Atlantica Agroindustrial), o que
  // prova que o DV calculado bate com o que a Receita emitiu.
  const reais = ['01588098000102', '01588098005333', '01588098003390', '01588098003047'];

  it('valida CNPJ real e rejeita DV trocado', () => {
    for (const c of reais) expect(cnpjValido(c)).toBe(true);
    expect(cnpjValido('01588098000103')).toBe(false);
    expect(cnpjValido('11111111111111')).toBe(false);
    expect(cnpjValido('0158809800010')).toBe(false);
  });

  it('reconstrói o CNPJ da filial a partir da raiz + ordem', () => {
    for (const c of reais) {
      expect(cnpjDaFilial(c.slice(0, 8), Number(c.slice(8, 12)))).toBe(c);
    }
    expect(digitosVerificadores('015880980001')).toBe('02');
  });

  it('gera a varredura da raiz em ordem, a partir da matriz', () => {
    expect(cnpjsDaRaiz('01.588.098/0001-02', 3))
      .toEqual(['01588098000102', '01588098000293', '01588098000374']);
    expect(cnpjsDaRaiz('123', 5)).toEqual([]);
  });

  it('formata e extrai raiz', () => {
    expect(formatarCnpj('01588098000102')).toBe('01.588.098/0001-02');
    expect(raizDoCnpj('01.588.098/0053-33')).toBe('01588098');
  });
});

describe('classificarMateria', () => {
  it('reconhece acidente de trabalho', () => {
    expect(classificarMateria({ assuntos: ['Acidente de Trabalho', 'Dano Moral'] })).toBe('ACIDENTE');
    expect(classificarMateria({ assuntos: ['Acidente do Trabalho'] })).toBe('ACIDENTE');
    expect(classificarMateria({ assunto_principal: 'Acidente de Trajeto' })).toBe('ACIDENTE');
  });

  it('reconhece doença ocupacional, inclusive como LER/DORT', () => {
    expect(classificarMateria({ assuntos: ['Doença Ocupacional'] })).toBe('DOENCA');
    expect(classificarMateria({ assuntos: ['Moléstia Profissional'] })).toBe('DOENCA');
    expect(classificarMateria({ assuntos: ['LER/DORT'] })).toBe('DOENCA');
  });

  it('marca AMBOS quando a capa traz os dois', () => {
    expect(classificarMateria({ assuntos: ['Acidente de Trabalho', 'Doença Ocupacional'] })).toBe('AMBOS');
  });

  it('capa sem assunto e sem classe vira INDETERMINADO, nunca OUTRO', () => {
    expect(classificarMateria({ assuntos: [] })).toBe('INDETERMINADO');
    expect(classificarMateria({ assuntos: null, assunto_principal: null, classe: null })).toBe('INDETERMINADO');
  });

  it('matéria trabalhista comum não vira acidente', () => {
    expect(classificarMateria({ assuntos: ['Rescisão do Contrato de Trabalho', 'Horas Extras'] })).toBe('OUTRO');
    expect(classificarMateria({ classe: 'Execução Fiscal' })).toBe('OUTRO');
  });
});

describe('mapearProcessoDaEmpresa', () => {
  it('lê a capa de dentro de fontes[0]', () => {
    const p = mapearProcessoDaEmpresa(item('0000972-32.2020.5.07.0001', '2020-11-24', 'Acidente de Trabalho'), '01588098000102');
    expect(p.tribunal_sigla).toBe('TRT07');
    expect(p.classe).toBe('Ação Trabalhista - Rito Ordinário');
    expect(p.assuntos).toEqual(['Acidente de Trabalho']);
    expect(p.data_distribuicao).toBe('2020-11-24');
    expect(p.estado).toBe('CE');
    expect(p.valor_causa).toBe(50000);
    expect(p.materia).toBe('ACIDENTE');
    expect(p.cnpj_consultado).toBe('01588098000102');
  });

  it('só afirma o polo quando o envolvido com AQUELE CNPJ vem na resposta', () => {
    const comEnvolvido = item('1', '2023-01-01', 'Horas Extras', {
      envolvidos: [
        { nome: 'Fulano', polo: 'ATIVO' },
        { nome: 'Empresa X Ltda', cnpj: '01.588.098/0001-02', polo: 'PASSIVO' },
      ],
    });
    expect(poloDaEmpresa(comEnvolvido, '01588098000102')).toBe('PASSIVO');
    // Mesmo processo, outro CNPJ da mesma raiz: não é essa filial que está lá.
    expect(poloDaEmpresa(comEnvolvido, '01588098005333')).toBe('INDETERMINADO');
    expect(poloDaEmpresa(item('2', '2023-01-01', null), '01588098000102')).toBe('INDETERMINADO');
  });
});

describe('agregarPorAno e totais', () => {
  const processos = [
    item('1', '2023-03-01', 'Acidente de Trabalho'),
    item('2', '2023-08-10', 'Doença Ocupacional'),
    item('3', '2023-09-20', 'Horas Extras'),
    item('4', '2024-02-02', 'Acidente de Trabalho'),
    { numero_cnj: '5', data_inicio: '2024-05-05', fontes: [] },
    { numero_cnj: '6', fontes: [] },
  ].map(p => mapearProcessoDaEmpresa(p, '01588098000102'));

  const linhas = agregarPorAno(processos);

  it('separa acidente, doença e indeterminado por ano', () => {
    expect(linhas.map(l => l.ano)).toEqual(['2023', '2024', 'sem_data']);
    expect(linhas[0]).toMatchObject({ total: 3, acidente: 1, doenca: 1, outro: 1, indeterminado: 0, acidentarios: 2 });
    expect(linhas[1]).toMatchObject({ total: 2, acidente: 1, indeterminado: 1, outro: 0, acidentarios: 1 });
    expect(linhas[2]).toMatchObject({ total: 1, indeterminado: 1 });
  });

  it('sem_data não entra na média por ano', () => {
    const t = totalizar(linhas);
    expect(t.total).toBe(6);
    expect(t.anos).toBe(2);
    expect(t.mediaPorAno).toBe(2.5); // (3+2)/2, ignorando o sem_data
    expect(t.acidentarios).toBe(3);
  });

  it('o percentual exclui o indeterminado do denominador', () => {
    const t = totalizar(linhas);
    // 3 acidentários sobre 4 classificados (6 - 2 indeterminados) = 75%,
    // não 50% que sairia se "não sei" contasse como "não é".
    expect(percentualAcidentarios(t)).toBe(75);
    expect(percentualAcidentarios({ total: 2, indeterminado: 2, acidentarios: 0 })).toBeNull();
  });

  it('anoDoProcesso prefere distribuição, cai para início e depois ano_inicio', () => {
    expect(anoDoProcesso({ data_distribuicao: '2020-11-24', data_inicio: '2019-01-01', ano_inicio: 2018 })).toBe('2020');
    expect(anoDoProcesso({ data_distribuicao: null, data_inicio: '2019-01-01', ano_inicio: 2018 })).toBe('2019');
    expect(anoDoProcesso({ data_distribuicao: null, data_inicio: null, ano_inicio: 2018 })).toBe('2018');
    expect(anoDoProcesso({ data_distribuicao: null, data_inicio: null, ano_inicio: null })).toBe('sem_data');
  });
});

describe('CSV', () => {
  it('por ano sai com cabeçalho e uma linha por ano', () => {
    const linhas = agregarPorAno([mapearProcessoDaEmpresa(item('1', '2023-03-01', 'Acidente de Trabalho'), '01588098000102')]);
    expect(csvPorAno(linhas)).toBe('ano,total,acidente,doenca,ambos,acidentarios,outro,indeterminado\n2023,1,1,0,0,1,0,0\n');
  });

  it('escapa vírgula do nome da parte em vez de partir a coluna', () => {
    const p = mapearProcessoDaEmpresa({
      ...item('1', '2023-03-01', 'Acidente de Trabalho'),
      titulo_polo_passivo: 'Empresa X Ltda, filial 3',
    }, '01588098000102');
    const linha = csvProcessos([p]).split('\n')[1];
    expect(linha).toContain('"Empresa X Ltda, filial 3"');
  });
});

describe('leitura da resposta paginada', () => {
  it('acha os itens nos formatos que a v2 usa', () => {
    expect(itensDaResposta({ success: true, data: { items: [1, 2] } })).toEqual([1, 2]);
    expect(itensDaResposta({ items: [3] })).toEqual([3]);
    expect(itensDaResposta({ data: [4, 5] })).toEqual([4, 5]);
    expect(itensDaResposta({})).toEqual([]);
  });

  it('devolve a URL inteira do links.next', () => {
    const next = 'https://api.escavador.com/api/v2/processos/cnpj/01588098000102?cursor=abc&li=9';
    expect(proximaPagina({ success: true, data: { links: { next } } })).toBe(next);
    expect(proximaPagina({ data: { links: { next: null } } })).toBeNull();
  });
});
