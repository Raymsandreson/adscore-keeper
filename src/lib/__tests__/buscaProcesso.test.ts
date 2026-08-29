import { describe, it, expect } from 'vitest';
import { termosDaBusca, palheiroDoProcesso, filtrarProcessos } from '../buscaProcesso';

// Ficha real do POP trabalhista (24/08/2026), reduzida ao que a busca lê.
const premolaje = {
  process_number: '0000581-03.2026.5.06.0391',
  title: 'Maria Francinete da Silva e outros x Premolaje Construcoes Ltda - Acidente de Trabalho',
  polo_passivo: 'Premolaje Construcoes Ltda',
  classe: 'Ação Trabalhista',
  status: 'em_andamento',
  envolvidos: [
    { nome: 'Maria Francinete da Silva', cpf: '06278781301', cnpj: null, polo: 'ATIVO', advogados: [
      { nome: 'Raymsandreson de Morais Prudencio' },
    ] },
    { nome: 'Premolaje Construcoes Ltda', cpf: null, cnpj: '57124663000135', polo: 'PASSIVO' },
  ],
};

const hotel = {
  process_number: '0001561-29.2025.8.26.0101',
  title: 'AÇÃO DE INDENIZAÇÃO',
  polo_passivo: 'Gurgueia Palace Hotel Ltda',
  envolvidos: null,
};

describe('termosDaBusca', () => {
  it('número vira só os dígitos, escrito de qualquer jeito', () => {
    expect(termosDaBusca('0000581-03.2026.5.06.0391')).toEqual(['00005810320265060391']);
    expect(termosDaBusca('00005810320265060391')).toEqual(['00005810320265060391']);
  });

  it('palavra continua palavra', () => {
    expect(termosDaBusca('Premolaje')).toEqual(['premolaje']);
    expect(termosDaBusca('  ')).toEqual([]);
  });

  it('tira acento, para "Ererê" achar "EREREE"', () => {
    expect(termosDaBusca('Ererê')).toEqual(['erere']);
  });

  it('sigla com número não vira busca de número', () => {
    expect(termosDaBusca('TRT-6')).toEqual(['trt-6']);
  });

  it('vários termos viram vários filtros', () => {
    expect(termosDaBusca('premolaje 2026')).toEqual(['premolaje', '2026']);
  });
});

describe('palheiroDoProcesso', () => {
  it('enxerga o número nas duas grafias de uma vez', () => {
    const p = palheiroDoProcesso(premolaje);
    expect(p).toContain('00005810320265060391');
    expect(p).toContain('0000581-03.2026.5.06.0391');
  });

  it('deriva tribunal, UF e ramo do próprio número', () => {
    const p = palheiroDoProcesso(premolaje);
    expect(p).toContain('trt6');
    expect(p).toContain('pe');
    expect(p).toContain('trabalhista');
  });

  it('desce no envolvidos: parte, advogado, CPF e CNPJ', () => {
    const p = palheiroDoProcesso(premolaje);
    expect(p).toContain('maria francinete');
    expect(p).toContain('raymsandreson');
    expect(p).toContain('06278781301');
    expect(p).toContain('57124663000135');
  });

  it('extras entram — é por onde o nome do lead chega', () => {
    const p = palheiroDoProcesso(hotel, ['Caso 88 - Mauro- Ererê/CE']);
    expect(p).toContain('erere');
  });

  it('ficha vazia não quebra', () => {
    expect(palheiroDoProcesso({})).toContain('sem numero');
  });
});

describe('filtrarProcessos', () => {
  const lista = [premolaje, hotel];

  it('acha pelo número, com ou sem pontuação', () => {
    expect(filtrarProcessos(lista, '0000581-03.2026.5.06.0391')).toEqual([premolaje]);
    expect(filtrarProcessos(lista, '00005810320265060391')).toEqual([premolaje]);
  });

  it('acha por pedaço do número', () => {
    expect(filtrarProcessos(lista, '0000581')).toEqual([premolaje]);
  });

  it('acha pelo nome da parte demandada', () => {
    expect(filtrarProcessos(lista, 'premolaje')).toEqual([premolaje]);
    expect(filtrarProcessos(lista, 'gurgueia')).toEqual([hotel]);
  });

  it('acha pelo advogado, que só existe dentro do envolvidos', () => {
    expect(filtrarProcessos(lista, 'raymsandreson')).toEqual([premolaje]);
  });

  it('acha por texto solto do título', () => {
    expect(filtrarProcessos(lista, 'indenização')).toEqual([hotel]);
  });

  // O recorte que dispensa filtro na tela: réu dentro de um estado.
  it('termos somam, não substituem', () => {
    expect(filtrarProcessos(lista, 'premolaje pe')).toEqual([premolaje]);
    expect(filtrarProcessos(lista, 'premolaje sp')).toEqual([]);
  });

  it('busca vazia devolve a lista inteira', () => {
    expect(filtrarProcessos(lista, '')).toEqual(lista);
    expect(filtrarProcessos(lista, '   ')).toEqual(lista);
  });

  it('acha pelo nome do lead, que vem por extras', () => {
    const achou = filtrarProcessos(lista, 'erere', p => (p === hotel ? ['Caso 88 - Mauro- Ererê/CE'] : []));
    expect(achou).toEqual([hotel]);
  });
});
