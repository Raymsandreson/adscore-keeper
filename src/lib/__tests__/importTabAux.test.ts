// Importador da aba Tab. Aux (Jurimetria/indenização) -> jm_partes.
// Os casos vêm do CSV real exportado em 18/08/2026: 1.029 partes, 287 processos.
import { describe, it, expect } from 'vitest';
import { mapearColunas, valor, status, nomeChave, chaveParte, cnjDigitos, montarLinha, planejar, gerarSql } from '../../../scripts/import-tab-aux.mjs';

const CABECALHO = [
  'PARTE', 'N° do Processo', 'N° do caso', 'DATA DO PROTOCOLO', 'Duração TOTAL(Dias)',
  'Status Pagamento', 'Última decisão/Termo Inicial JCM', 'TERMO INICIAL DOS JCM',
  'DECISÃO DE MÉRITO', 'Fase Atual', 'TOTAL DA CONDENAÇÃO CJCM', 'TOTAL PARTE CJCM',
  'TOTAL À VISTA PARTE CJCM', 'HONORÁRIOS CONTRATUAIS À VISTA',
  'HONORÁRIOS CONTRATUAIS PARCELADO', 'HONORÁRIOS SUCUMBENCIAIS', 'AUX',
];

describe('importador da Tab. Aux', () => {
  it('acha as colunas de valor pelo nome, com acento e caixa', () => {
    const { indice, faltando } = mapearColunas(CABECALHO);
    expect(faltando).toEqual([]);
    expect(indice.condenacao_cjcm).toBe(10);
    expect(indice.cota_parte_cjcm).toBe(11);
    expect(indice.hc_vista).toBe(13);
    expect(indice.hs).toBe(15);
  });

  it('converte valor em real', () => {
    expect(valor('R$ 365.123,42')).toBeCloseTo(365123.42);
    expect(valor('R$ 0,00')).toBe(0);
    expect(valor('-R$ 2.480,40')).toBeCloseTo(-2480.4);
    expect(valor('#N/A')).toBeNull();
    expect(valor('')).toBeNull();
  });

  it('padroniza o status em maiúscula', () => {
    // A planilha mistura "Projetado" (276 linhas) e "PROJETADO" (163),
    // "A receber" (299) e "A RECEBER" (18) — agrupar por texto cru partia
    // cada contagem em duas.
    expect(status('Projetado')).toBe('PROJETADO');
    expect(status('PROJETADO')).toBe('PROJETADO');
    expect(status('A receber')).toBe('A RECEBER');
    expect(status('#N/A')).toBeNull();
  });

  it('casa o nome da parte apesar de acento e espaço', () => {
    expect(nomeChave('ANTÔNIO JOSÉ  DA SILVA')).toBe('ANTONIO JOSE DA SILVA');
    expect(nomeChave('antônio josé da silva')).toBe('ANTONIO JOSE DA SILVA');
  });

  it('casa o processo por dígitos, não pela pontuação', () => {
    expect(cnjDigitos('0000408-22.2017.5.22.0110')).toBe('00004082220175220110');
    expect(cnjDigitos('00004082220175220110')).toBe('00004082220175220110');
    expect(cnjDigitos('123')).toBeNull();
    expect(chaveParte('0000408-22.2017.5.22.0110', 'ANTÔNIO JOSÉ DA SILVA'))
      .toBe(chaveParte('00004082220175220110', 'antonio jose  da silva'));
  });

  describe('planejar', () => {
    const parte = (parte_id: string, cliente: string) => ({
      parte_id, processo_cnj: '0000408-22.2017.5.22.0110', cliente,
    });
    const linha = (cliente: string, extra = {}) => ({
      processo: '0000408-22.2017.5.22.0110', cliente,
      status_pagamento: 'PAGO', fase_atual: null,
      condenacao_cjcm: 28571.43, cota_parte_cjcm: 20000,
      cota_parte_vista_cjcm: 20000, hc_vista: 8571.43, hc_parcelado: 0, hs: 0,
      ...extra,
    });

    it('casa a parte e traz a separação cota × honorário', () => {
      // O caso 10: 28.571,43 = 20.000 do cliente + 8.571,43 do escritório.
      const p = planejar([linha('ANTÔNIO JOSÉ DA SILVA')], [parte('P0302', 'ANTONIO JOSE DA SILVA')]);
      expect(p.atualizar).toHaveLength(1);
      expect(p.atualizar[0].parte_id).toBe('P0302');
      expect(p.atualizar[0].linha.cota_parte_cjcm).toBe(20000);
      expect(p.atualizar[0].linha.hc_vista).toBeCloseTo(8571.43);
      expect(p.semParte).toHaveLength(0);
    });

    it('parte que não existe no banco NÃO é inventada', () => {
      const p = planejar([linha('QUEM NAO ESTA NO BANCO')], [parte('P0302', 'ANTONIO JOSE DA SILVA')]);
      expect(p.atualizar).toHaveLength(0);
      expect(p.semParte).toHaveLength(1);
    });

    it('linha repetida sem valor não apaga a que tem valor', () => {
      const p = planejar(
        [linha('ANTÔNIO JOSÉ DA SILVA'), linha('ANTÔNIO JOSÉ DA SILVA', { condenacao_cjcm: null })],
        [parte('P0302', 'ANTONIO JOSE DA SILVA')],
      );
      expect(p.atualizar).toHaveLength(1);
      expect(p.atualizar[0].linha.condenacao_cjcm).toBeCloseTo(28571.43);
      expect(p.ambiguas).toHaveLength(0);
    });

    it('mesma parte com DOIS valores é ambígua — o script não escolhe', () => {
      const p = planejar(
        [linha('ANTÔNIO JOSÉ DA SILVA'), linha('ANTÔNIO JOSÉ DA SILVA', { condenacao_cjcm: 999 })],
        [parte('P0302', 'ANTONIO JOSE DA SILVA')],
      );
      expect(p.atualizar).toHaveLength(1);
      expect(p.ambiguas).toHaveLength(1);
    });

    it('o SQL castea os números — VALUES com null vira text e estoura sem isso', () => {
      const p = planejar([linha('ANTÔNIO JOSÉ DA SILVA', { hs: null })], [parte('P0302', 'ANTONIO JOSE DA SILVA')]);
      const sql = gerarSql(p);
      expect(sql).toContain('condenacao_cjcm = v.condenacao_cjcm::numeric');
      expect(sql).toContain('status_pagamento = v.status_pagamento::text');
      expect(sql).toContain("('P0302',28571.43,20000,20000,8571.43,0,null,'PAGO',null)");
      expect(sql).toContain('where p.parte_id = v.parte_id;');
    });
  });
});
