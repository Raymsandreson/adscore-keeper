// Régua de atualização por ramo. Os coeficientes vêm de jm_indices, safra
// 2026-08, e foram conferidos contra a série do Bacen na própria migration.
import { describe, it, expect } from 'vitest';
import {
  reguaDoProcesso, competenciaDe, atualizarValor, REGUA_LABEL, PORQUE_LABEL,
} from '../atualizacaoMonetaria';

// Coeficientes reais da safra 08/2026.
const TRAB = new Map([['2024-04-01', 1.3175], ['2024-09-01', 1.2704], ['2026-08-01', 1]]);
const COMUM = new Map([['2024-04-01', 1.3457], ['2024-09-01', 1.2704], ['2017-09-01', 3.147]]);

describe('qual régua vale', () => {
  it('dígito 5 do CNJ é Justiça do Trabalho', () => {
    expect(reguaDoProcesso('0000072-69.2023.5.13.0009')).toBe('REGUA_TRABALHISTA');
    expect(reguaDoProcesso('00000726920235130009')).toBe('REGUA_TRABALHISTA');
  });

  it('estadual e federal seguem o Código Civil, não a tabela do CSJT', () => {
    expect(reguaDoProcesso('0000016-85.2022.8.12.0013')).toBe('REGUA_COMUM');
    expect(reguaDoProcesso('0000016-85.2022.4.12.0013')).toBe('REGUA_COMUM');
  });

  it('CNJ ausente ou truncado NÃO cai numa régua por padrão', () => {
    // Chutar o ramo corrigiria 70 processos pela tabela errada — foi exatamente
    // o erro que esta lib existe para desfazer.
    expect(reguaDoProcesso(null)).toBeNull();
    expect(reguaDoProcesso('123')).toBeNull();
    expect(reguaDoProcesso('')).toBeNull();
  });

  it('cada régua tem rótulo em português para a tela', () => {
    expect(REGUA_LABEL.REGUA_TRABALHISTA).toBe('Justiça do Trabalho');
    expect(REGUA_LABEL.REGUA_COMUM).toBe('Justiça comum');
  });
});

describe('competência da data-base', () => {
  it('o índice é mensal, a data é diária', () => {
    expect(competenciaDe('2024-04-25')).toBe('2024-04-01');
    expect(competenciaDe(new Date('2024-04-25T12:00:00Z'))).toBe('2024-04-01');
    expect(competenciaDe(null)).toBeNull();
    expect(competenciaDe('sem data')).toBeNull();
  });
});

describe('aplicar a régua', () => {
  const ivonete = {
    valor: 346134.35, cnj: '0000072-69.2023.5.13.0009',
    dataBase: '2024-04-25', coeficientes: TRAB,
  };

  it('trabalhista de abr/2024 usa a régua trabalhista', () => {
    const r = atualizarValor(ivonete);
    expect(r.regua).toBe('REGUA_TRABALHISTA');
    expect(r.coeficiente).toBe(1.3175);
    expect(r.atualizado).toBeCloseTo(456032.01, 1);
    expect(r.porque).toBe('ok');
  });

  it('o mesmo valor na justiça comum corrige mais — régua diferente', () => {
    const r = atualizarValor({ ...ivonete, cnj: '0000072-69.2023.8.13.0009', coeficientes: COMUM });
    expect(r.regua).toBe('REGUA_COMUM');
    expect(r.coeficiente).toBe(1.3457);
    expect(r.atualizado as number).toBeGreaterThan(456032.01);
  });

  it('já pago não corrige, mesmo sem data-base', () => {
    // Correção atualiza o que falta receber. Dinheiro na conta ficou no nominal.
    const r = atualizarValor({ ...ivonete, dataBase: null, pago: true });
    expect(r.atualizado).toBe(346134.35);
    expect(r.coeficiente).toBe(1);
    expect(r.porque).toBe('pago');
  });

  it('sem data-base devolve o nominal e DIZ que não corrigiu', () => {
    const r = atualizarValor({ ...ivonete, dataBase: null });
    expect(r.atualizado).toBeNull();
    expect(r.porque).toBe('sem-data-base');
    expect(PORQUE_LABEL[r.porque]).toBe('sem termo inicial na planilha');
  });

  it('sem CNJ não inventa ramo', () => {
    const r = atualizarValor({ ...ivonete, cnj: null });
    expect(r.atualizado).toBeNull();
    expect(r.regua).toBeNull();
    expect(r.porque).toBe('sem-cnj');
  });

  it('competência fora da tabela não vira coeficiente 1 disfarçado', () => {
    // Devolver 1 aqui faria o valor aparecer "atualizado" sem ter sido.
    const r = atualizarValor({ ...ivonete, dataBase: '1994-01-10' });
    expect(r.atualizado).toBeNull();
    expect(r.porque).toBe('sem-coeficiente');
  });

  it('competência igual à referência vale 1,0 — o mês corrente não corrige', () => {
    const r = atualizarValor({ ...ivonete, dataBase: '2026-08-19' });
    expect(r.coeficiente).toBe(1);
    expect(r.atualizado).toBe(346134.35);
  });

  it('valor nulo não vira NaN', () => {
    const r = atualizarValor({ ...ivonete, valor: null });
    expect(r.nominal).toBe(0);
    expect(r.atualizado).toBe(0);
  });
});
