import { describe, it, expect } from 'vitest';
import {
  isBeneficioInssProcess,
  periciaInputValue,
  periciaIsoFromInput,
  formatPericia,
  periciaTom,
} from '../periciaInss';

describe('isBeneficioInssProcess', () => {
  it('reconhece o título como ele nasce no banco', () => {
    expect(isBeneficioInssProcess('Benefício INSS')).toBe(true);
  });

  it('ignora acento, caixa e espaço extra', () => {
    expect(isBeneficioInssProcess('  beneficio   inss ')).toBe(true);
    expect(isBeneficioInssProcess('BENEFÍCIO INSS')).toBe(true);
  });

  it('não pega processo que só menciona INSS', () => {
    // Sem isto, "Protocolar no INSS" ou o requerimento administrativo ganhariam
    // campos de perícia que aquele processo não tem.
    expect(isBeneficioInssProcess('INSS Administrativo — Req. 470045537 (BPC)')).toBe(false);
    expect(isBeneficioInssProcess('Auxílio maternidade')).toBe(false);
    expect(isBeneficioInssProcess('Onboarding')).toBe(false);
    expect(isBeneficioInssProcess(null)).toBe(false);
    expect(isBeneficioInssProcess('')).toBe(false);
  });
});

describe('conversão datetime-local ↔ timestamptz', () => {
  it('ida e volta preserva o horário que a pessoa digitou', () => {
    // O input não carrega fuso: se a string crua fosse gravada, o Postgres a
    // leria como UTC e a perícia das 09:20 apareceria às 06:20 no Brasil.
    const digitado = '2026-08-14T09:20';
    const iso = periciaIsoFromInput(digitado);
    expect(iso).toBeTruthy();
    expect(periciaInputValue(iso)).toBe(digitado);
  });

  it('vazio e lixo viram null/string vazia em vez de data inválida', () => {
    expect(periciaIsoFromInput('')).toBeNull();
    expect(periciaIsoFromInput(null)).toBeNull();
    expect(periciaIsoFromInput('não é data')).toBeNull();
    expect(periciaInputValue(null)).toBe('');
    expect(periciaInputValue('lixo')).toBe('');
    expect(formatPericia(null)).toBe('');
  });

  it('formata para leitura em pt-BR', () => {
    expect(formatPericia(periciaIsoFromInput('2026-08-14T09:20'))).toBe('14/08/2026 09:20');
  });
});

describe('periciaTom', () => {
  const agora = new Date('2026-08-13T15:00:00');

  it('sem data é vazio', () => {
    expect(periciaTom(null, agora)).toBe('vazio');
  });

  it('mesma data civil é hoje, mesmo já tendo passado a hora', () => {
    expect(periciaTom(periciaIsoFromInput('2026-08-13T09:00'), agora)).toBe('hoje');
    expect(periciaTom(periciaIsoFromInput('2026-08-13T18:00'), agora)).toBe('hoje');
  });

  it('separa futura de passada', () => {
    expect(periciaTom(periciaIsoFromInput('2026-08-20T09:00'), agora)).toBe('futura');
    expect(periciaTom(periciaIsoFromInput('2026-07-30T09:00'), agora)).toBe('passada');
  });
});
