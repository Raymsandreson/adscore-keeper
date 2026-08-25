import { describe, it, expect } from 'vitest';
import {
  donoDaAtualizacaoInss,
  ehLeadTrabalhista,
  ASSESSOR_INSS,
  ASSESSOR_PROTOCOLO,
  ASSESSOR_TRABALHISTA,
} from '../../../railway-server/src/lib/inss-roteamento';

// Nomes de lead reais do Externo (amostra de 25/08/2026).
const TRABALHISTAS = [
  '✅ FAMÍLIA 252 - MARILAN DOMINGOS DE MIRANDA',
  '✅ FAMILIA 301 / Feira de Santana/BA / Luis x',
  '✅Família 372(JP)/  Beberibe/CE | Ricardo Nep',
  'CASO 146 SÓ CRISTIANE',
  'Caso 180 - Iago-Bacabal/MA',
];

const PREVIDENCIARIOS = [
  '✅PREV 1800 - Gilson - AUX. ACIDENTE',
  '✅LEAD 2034-SAMUEL HEITOR- (BPC/LOAS) - KAR',
  '✅️ 1104 milagros BPC-LOAS',
  'PREV 110 /RAIMUNDO/ANUNCIO (BPC LOAS)',
  '✅Lead 2104 Bárbara Eduarda (BPC/LOAS) - Ma',
];

describe('ehLeadTrabalhista', () => {
  it('reconhece Família com e sem acento, e CASO em qualquer caixa', () => {
    for (const nome of TRABALHISTAS) expect(ehLeadTrabalhista(nome)).toBe(true);
  });

  it('não confunde lead previdenciário com trabalhista', () => {
    for (const nome of PREVIDENCIARIOS) expect(ehLeadTrabalhista(nome)).toBe(false);
  });

  it('não casa "caso" dentro de outra palavra', () => {
    expect(ehLeadTrabalhista('PREV 900 - MARIA CASOTTI')).toBe(false);
    expect(ehLeadTrabalhista('LEAD 12 - ocasoinesperado')).toBe(false);
  });

  it('lead sem nome não vira trabalhista', () => {
    expect(ehLeadTrabalhista(null)).toBe(false);
    expect(ehLeadTrabalhista('')).toBe(false);
  });
});

describe('donoDaAtualizacaoInss', () => {
  it('trabalhista vai para o Felipe, mesmo sendo protocolo', () => {
    expect(donoDaAtualizacaoInss({ status: 'Exigência', leadName: 'Família 400 (LUIZ)' }))
      .toEqual(ASSESSOR_TRABALHISTA);
    expect(donoDaAtualizacaoInss({ status: 'Protocolado', leadName: 'CASO 146 SÓ CRISTIANE' }))
      .toEqual(ASSESSOR_TRABALHISTA);
  });

  it('protocolo previdenciário vai para a Luana', () => {
    expect(donoDaAtualizacaoInss({ status: 'Protocolado', leadName: 'PREV 1800 - Gilson' }))
      .toEqual(ASSESSOR_PROTOCOLO);
  });

  it('demais status previdenciários vão para o José', () => {
    for (const status of ['Exigência', 'Em Análise', 'Concluída', 'Pendente', 'Cancelada']) {
      expect(donoDaAtualizacaoInss({ status, leadName: '✅️ 1104 milagros BPC-LOAS' }))
        .toEqual(ASSESSOR_INSS);
    }
  });

  it('sem lead identificado, cai no previdenciário', () => {
    expect(donoDaAtualizacaoInss({ status: 'Exigência', leadName: null })).toEqual(ASSESSOR_INSS);
    expect(donoDaAtualizacaoInss({ status: 'Protocolado', leadName: null })).toEqual(ASSESSOR_PROTOCOLO);
  });

  it('os três uuids são distintos e são user_id, não profiles.id', () => {
    const ids = [ASSESSOR_INSS.id, ASSESSOR_PROTOCOLO.id, ASSESSOR_TRABALHISTA.id];
    expect(new Set(ids).size).toBe(3);
    // profiles.id conhecidos que NÃO podem aparecer aqui (não casam no filtro da tela)
    expect(ids).not.toContain('c5284e57-b0f4-4075-b61c-a46f6fa87b16'); // Luana
    expect(ids).not.toContain('8fc1df70-2592-419c-ba72-14f2cc9765b7'); // Felipe
  });
});
