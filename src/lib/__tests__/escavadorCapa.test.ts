import { describe, expect, it } from 'vitest';
import { COLUNAS_DA_CAPA, mapearCapa } from '../../../supabase/functions/_shared/escavadorCapa';

// Recorte da resposta de GET /processos/numero_cnj/{cnj} do Escavador.
const RESPOSTA = {
  numero_cnj: '0000972-32.2020.5.22.0001',
  titulo_polo_ativo: 'Lindomar Costa Osorio Filho',
  titulo_polo_passivo: 'Dínamo Engenharia Ltda e outros',
  ano_inicio: 2020,
  data_inicio: '2020-11-24',
  estado_origem: { nome: 'Piauí', sigla: 'PI' },
  unidade_origem: { nome: '1ª Vara do Trabalho de Teresina', cidade: 'Teresina' },
  fontes: [{
    nome: 'Tribunal Regional do Trabalho da 22ª Região',
    tipo: 'TRIBUNAL',
    sigla: 'TRT22',
    grau_formatado: 'Primeiro Grau',
    sistema: 'PJE',
    url: 'https://pje.trt22.jus.br/processo',
    arquivado: false,
    segredo_justica: false,
    data_inicio: '2020-11-24',
    data_ultima_movimentacao: '2026-07-02',
    envolvidos: [],
    tribunal: { nome: 'Tribunal Regional do Trabalho da 22ª Região', sigla: 'TRT22' },
    capa: {
      classe: 'Ação Trabalhista - Rito Ordinário',
      area: 'Trabalhista',
      orgao_julgador: '1ª Vara do Trabalho de Teresina',
      data_distribuicao: '2020-11-24',
      valor_causa: { valor: '50000.00', valor_formatado: 'R$ 50.000,00', moeda: 'R$' },
      assuntos_normalizados: [{ nome: 'Acidente de Trabalho' }, { nome: 'Dano Moral' }],
    },
  }],
};

describe('mapearCapa', () => {
  const capa = mapearCapa(RESPOSTA);

  it('traz os campos que o endpoint de movimentações não devolve', () => {
    expect(capa.tribunal_sigla).toBe('TRT22');
    expect(capa.grau).toBe('Primeiro Grau');
    expect(capa.orgao_julgador).toBe('1ª Vara do Trabalho de Teresina');
    expect(capa.polo_ativo).toBe('Lindomar Costa Osorio Filho');
    expect(capa.polo_passivo).toBe('Dínamo Engenharia Ltda e outros');
    expect(capa.classe).toBe('Ação Trabalhista - Rito Ordinário');
    expect(capa.data_distribuicao).toBe('2020-11-24');
    expect(capa.ano_inicio).toBe(2020);
    expect(capa.valor_causa).toBe(50000);
    expect(capa.assuntos).toEqual(['Acidente de Trabalho', 'Dano Moral']);
    expect(capa.unidade_origem_cidade).toBe('Teresina');
  });

  it('mantém false — arquivado/segredo não podem virar campo ausente', () => {
    expect(capa.arquivado).toBe(false);
    expect(capa.segredo_justica).toBe(false);
  });

  it('não devolve chave para o que veio vazio', () => {
    expect('envolvidos' in capa).toBe(false);
    expect('data_arquivamento' in capa).toBe(false);
    expect('audiencias' in capa).toBe(false);
  });

  it('aguenta resposta vazia, nula ou sem fontes', () => {
    expect(mapearCapa(null)).toEqual({});
    expect(mapearCapa({})).toEqual({});
    expect(mapearCapa({ fontes: [] })).toEqual({});
  });

  it('COLUNAS_DA_CAPA cobre tudo que o mapeamento devolve', () => {
    for (const chave of Object.keys(capa)) {
      expect(COLUNAS_DA_CAPA).toContain(chave);
    }
  });
});
