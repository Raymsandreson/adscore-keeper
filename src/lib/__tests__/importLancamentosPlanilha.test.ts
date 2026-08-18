// Normalização do importador da planilha de lançamentos. Os casos vêm do PDF
// exportado da aba Lançamentos em 18/08/2026 e do que já está em jm_lancamentos.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — script .mjs sem tipos; o que importa aqui é o comportamento.
import { lerCsv, mapearColunas, data, valor, cnj, tipoNormalizado, montarLinha, preservaCategoria } from '../../../scripts/import-lancamentos-planilha.mjs';

const CABECALHO = [
  'Responsável', 'DISTRIBUÍDO', 'data', 'CASO', 'Processo', 'PESSOA', 'Categoria',
  'SUBCATEGORIA', 'Natureza', 'RECORRÊNCIA', 'Tipo', 'Relação c/ Cliente',
  'N° DA PARCELA', 'NF', 'Conta', 'observação', 'Valor (Regime de Caixa)',
  'Valor (Regime de Competência)', 'Beneficiário', 'Conta beneficiária da transferência',
  'BANCO', 'TAXA(A.M)', 'NATUREZA',
];

describe('importador da planilha de lançamentos', () => {
  it('acha as colunas pelo nome, ignorando acento e caixa', () => {
    const { indice, faltando } = mapearColunas(CABECALHO);
    expect(faltando).toEqual([]);
    expect(indice.relacao_cliente).toBe(11);
    expect(indice.valor_caixa).toBe(16);
    expect(indice.natureza_dano).toBe(22);
  });

  it('aceita o cabeçalho truncado que a exportação produz', () => {
    // O PDF da planilha sai com "Valor (Regime de Caix" — posição fixa quebraria.
    const truncado = [...CABECALHO];
    truncado[16] = 'Valor (Regime de Caix';
    expect(mapearColunas(truncado).indice.valor_caixa).toBe(16);
  });

  it('lê CSV com vírgula e quebra de linha dentro de aspas', () => {
    const linhas = lerCsv('a,b\n"tem, vírgula","tem\nquebra"\n');
    expect(linhas[1]).toEqual(['tem, vírgula', 'tem\nquebra']);
  });

  it('converte data brasileira para ISO', () => {
    expect(data('30/11/2025')).toBe('2025-11-30');
    expect(data('2025-11-30')).toBe('2025-11-30');
    expect(data('')).toBeNull();
  });

  it('converte valor em real, inclusive negativo entre parênteses', () => {
    expect(valor('R$ 1.234,56')).toBeCloseTo(1234.56);
    expect(valor('R$ 12.353,40')).toBeCloseTo(12353.4);
    expect(valor('228,37')).toBeCloseTo(228.37);
    expect(valor('(R$ 100,00)')).toBeCloseTo(-100);
    expect(valor('#N/A')).toBeNull();
    expect(valor('')).toBeNull();
  });

  it('formata o CNJ como a base guarda, e recusa número incompleto', () => {
    expect(cnj('00027019220175220003')).toBe('0002701-92.2017.5.22.0003');
    expect(cnj('0002701-92.2017.5.22.0003')).toBe('0002701-92.2017.5.22.0003');
    expect(cnj('12345')).toBeNull();
  });

  describe('tipo', () => {
    it('respeita o que foi escrito na planilha', () => {
      expect(tipoNormalizado('Entrada', 'Indenização')).toBe('ENTRADA');
      expect(tipoNormalizado('Saída', 'Custas')).toBe('SAIDA');
      expect(tipoNormalizado('Repasse', 'Indenização')).toBe('REPASSE');
    });

    it('deduz da categoria quando a coluna Tipo está vazia', () => {
      // Dinheiro de terceiro passando pela conta: cliente e parceiro.
      expect(tipoNormalizado('', 'Indenização')).toBe('REPASSE');
      expect(tipoNormalizado(null, 'Indenização a receber')).toBe('REPASSE');
      expect(tipoNormalizado('', 'Honorários Adv Parceiro')).toBe('REPASSE');
      // Nosso.
      expect(tipoNormalizado('', 'Honorários')).toBe('ENTRADA');
      expect(tipoNormalizado('', 'Honorários Adiantados Oriz')).toBe('ENTRADA');
      expect(tipoNormalizado('', 'Indenização comprada')).toBe('ENTRADA');
    });

    it('não inventa tipo para categoria ambígua', () => {
      expect(tipoNormalizado('', 'Movimentação conta')).toBeNull();
      expect(tipoNormalizado('', 'OUTROS')).toBeNull();
    });
  });

  it('monta a linha inteira a partir do CSV', () => {
    const csv = lerCsv(
      `${CABECALHO.join(',')}\n`
      + ',,30/11/2025,3,0000491-34.2020.5.05.0101,HC,Honorários a receber,,,,,30%,,,'
      + 'ESCRITÓRIO,,"R$ 228,37","R$ 228,37",Escritório,,,,DANO MATERIAL\n',
    );
    const { indice } = mapearColunas(csv[0]);
    const linha = montarLinha(csv[1], indice, 2);
    expect(linha).toMatchObject({
      ordem_origem: 2,
      data: '2025-11-30',
      processo_cnj: '0000491-34.2020.5.05.0101',
      pessoa: 'HC',
      categoria: 'Honorários a receber',
      relacao_cliente: '30%',
      conta: 'ESCRITÓRIO',
      tipo: 'ENTRADA',
      natureza_dano: 'DANO MATERIAL',
    });
    expect(linha.valor_caixa).toBeCloseTo(228.37);
  });

  describe('reclassificação que só existe no banco', () => {
    it('mantém "Honorários condenação" quando a planilha ainda diz "a receber"', () => {
      // As 29 linhas foram reclassificadas direto no banco; reimportar sem o
      // guarda desfaria isso em silêncio.
      expect(preservaCategoria('Honorários condenação', 'Honorários a receber')).toBe(true);
    });

    it('não segura nada quando a planilha muda de verdade', () => {
      expect(preservaCategoria('Honorários condenação', 'Honorários')).toBe(false);
      expect(preservaCategoria('Honorários a receber', 'Honorários a receber')).toBe(false);
      expect(preservaCategoria(null, 'Honorários a receber')).toBe(false);
    });
  });
});
