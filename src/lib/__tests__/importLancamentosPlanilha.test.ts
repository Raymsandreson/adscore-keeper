// Normalização do importador da planilha de lançamentos. Os casos vêm do PDF
// exportado da aba Lançamentos em 18/08/2026 e do que já está em jm_lancamentos.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — script .mjs sem tipos; o que importa aqui é o comportamento.
import { lerCsv, mapearColunas, data, valor, cnj, tipoNormalizado, montarLinha, chaveForte, chaveFraca, planejar } from '../../../scripts/import-lancamentos-planilha.mjs';

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

  it('converte data brasileira para ISO, com um ou dois dígitos', () => {
    expect(data('30/11/2025')).toBe('2025-11-30');
    // O Sheets exporta "10/8/2023" ao lado de "30/11/2025". Exigir dois dígitos
    // zerava a data de 34 linhas em silêncio.
    expect(data('10/8/2023')).toBe('2023-08-10');
    expect(data('1/1/2026')).toBe('2026-01-01');
    expect(data('2025-11-30')).toBe('2025-11-30');
    expect(data('')).toBeNull();
    expect(data('sem data')).toBeNull();
    // A planilha tem "29/02/2022" e 2022 não é bissexto: o formato passava e o
    // Postgres recusava a carga inteira no insert.
    expect(data('29/02/2022')).toBeNull();
    expect(data('29/02/2024')).toBe('2024-02-29');
    expect(data('31/04/2025')).toBeNull();
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

  describe('identidade por conteúdo (planejar)', () => {
    // A linha do banco traz os campos que o script lê para comparar.
    const doBanco = (id, extra = {}) => ({
      id, data: '2025-01-10', categoria: 'Honorários', pessoa: 'HC',
      processo_raw: '0000491-34.2020.5.05.0101', valor_caixa: 100, n_parcela: '1',
      observacao: null, conta: 'ESCRITÓRIO', ...extra,
    });
    const daPlanilha = (extra = {}) => ({
      data: '2025-01-10', categoria: 'Honorários', pessoa: 'HC',
      processo_raw: '0000491-34.2020.5.05.0101', valor_caixa: 100, n_parcela: '1',
      observacao: null, conta: 'Escritório', ...extra,
    });

    it('ignora diferença de caixa e de espaço — senão nada casaria', () => {
      // A carga antiga gravou conta em MAIÚSCULA; a planilha usa caixa mista.
      expect(chaveForte(doBanco(1))).toBe(chaveForte(daPlanilha()));
      expect(chaveForte(daPlanilha({ categoria: '  Honorários  ' })))
        .toBe(chaveForte(daPlanilha()));
    });

    it('linha inalterada não vira ação nenhuma', () => {
      const p = planejar([daPlanilha()], [doBanco(1)]);
      expect(p.iguais).toHaveLength(1);
      expect(p.atualizar).toHaveLength(0);
      expect(p.inserir).toHaveLength(0);
      expect(p.apagar).toHaveLength(0);
    });

    it('valor editado vira UPDATE no mesmo id, não apaga-e-insere', () => {
      // É o que preserva parte_id, parte_conciliacao e tem_data_pagamento.
      const p = planejar([daPlanilha({ valor_caixa: 250 })], [doBanco(7)]);
      expect(p.atualizar).toEqual([expect.objectContaining({ id: 7 })]);
      expect(p.atualizar[0].linha.valor_caixa).toBe(250);
      expect(p.apagar).toHaveLength(0);
      expect(p.inserir).toHaveLength(0);
    });

    it('linha que sumiu da planilha vira APAGAR, e a nova vira INSERIR', () => {
      const p = planejar(
        [daPlanilha({ pessoa: 'HS', valor_caixa: 40 })],
        [doBanco(3)],
      );
      expect(p.apagar.map((l) => l.id)).toEqual([3]);
      expect(p.inserir).toHaveLength(1);
      expect(p.atualizar).toHaveLength(0);
    });

    it('parcelas idênticas não se confundem: 3 na planilha e 2 no banco = 1 inserir', () => {
      const p = planejar(
        [daPlanilha(), daPlanilha(), daPlanilha()],
        [doBanco(1), doBanco(2)],
      );
      expect(p.iguais).toHaveLength(2);
      expect(p.inserir).toHaveLength(1);
      expect(p.apagar).toHaveLength(0);
    });

    it('a chave fraca ignora valor e observação, mas não a parte nem a data', () => {
      expect(chaveFraca(daPlanilha({ valor_caixa: 999, observacao: 'outra' })))
        .toBe(chaveFraca(daPlanilha()));
      expect(chaveFraca(daPlanilha({ pessoa: 'HS' }))).not.toBe(chaveFraca(daPlanilha()));
      expect(chaveFraca(daPlanilha({ data: '2025-02-10' }))).not.toBe(chaveFraca(daPlanilha()));
    });
  });
});
