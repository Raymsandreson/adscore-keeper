import { describe, it, expect } from 'vitest';
import {
  ATENCAO_DIARIO_ATIVIDADES,
  LIMITE_DIARIO_ATIVIDADES,
  classesCarga,
  descreveCarga,
  nivelCarga,
  rotuloCarga,
} from '../activityDailyLoad';

describe('nivelCarga', () => {
  it('sem contagem não pinta nada', () => {
    expect(nivelCarga(null)).toBeNull();
    expect(nivelCarga(undefined)).toBeNull();
    expect(nivelCarga(NaN)).toBeNull();
  });

  it('dia vazio e dia com uma atividade são os dois tranquilos', () => {
    // Regressão do badge antigo: ele ficava âmbar com UMA atividade no dia,
    // então quase todo dia útil aparecia em alerta e ninguém olhava mais.
    expect(nivelCarga(0)).toBe('tranquilo');
    expect(nivelCarga(1)).toBe('tranquilo');
  });

  it('vira âmbar ao encostar nos 24 e some abaixo disso', () => {
    expect(nivelCarga(ATENCAO_DIARIO_ATIVIDADES - 1)).toBe('tranquilo');
    expect(nivelCarga(ATENCAO_DIARIO_ATIVIDADES)).toBe('cheio');
    expect(nivelCarga(LIMITE_DIARIO_ATIVIDADES - 1)).toBe('cheio');
  });

  it('vira vermelho a partir do limite pedido, e continua vermelho acima dele', () => {
    expect(nivelCarga(LIMITE_DIARIO_ATIVIDADES)).toBe('estourado');
    expect(nivelCarga(87)).toBe('estourado'); // maior carga real medida em 17/08/2026
  });
});

describe('rotuloCarga', () => {
  it('mostra a contagem contra o teto, no formato do mockup', () => {
    expect(rotuloCarga(12)).toBe('12/30');
    expect(rotuloCarga(30)).toBe('30/30');
    expect(rotuloCarga(41)).toBe('41/30');
  });
});

describe('classesCarga', () => {
  it('cada faixa tem sua cor', () => {
    expect(classesCarga('tranquilo')).toContain('success');
    expect(classesCarga('cheio')).toContain('warning');
    expect(classesCarga('estourado')).toContain('destructive');
  });
});

describe('descreveCarga', () => {
  it('não inventa texto sem contagem', () => {
    expect(descreveCarga(null)).toBe('');
  });

  it('usa o primeiro nome de quem vai receber', () => {
    expect(descreveCarga(5, 'Maria Lydia Ribeiro')).toContain('Maria');
    expect(descreveCarga(5, '  ')).toContain('A pessoa');
    expect(descreveCarga(5)).toContain('A pessoa');
  });

  it('conta quantas faltam para o teto na faixa âmbar', () => {
    expect(descreveCarga(28, 'João')).toContain('faltam 2');
  });

  it('deixa explícito que passar do teto é permitido', () => {
    const texto = descreveCarga(34, 'João');
    expect(texto).toContain('4 acima');
    expect(texto).toContain('não bloqueio');
  });

  it('no limite exato não fala em excedente', () => {
    const texto = descreveCarga(LIMITE_DIARIO_ATIVIDADES, 'João');
    expect(texto).toContain('bate o limite');
    expect(texto).not.toContain('acima do limite');
  });

  it('concorda em número na faixa tranquila', () => {
    expect(descreveCarga(1, 'Ana')).toContain('1 atividade nesse dia');
    expect(descreveCarga(2, 'Ana')).toContain('2 atividades nesse dia');
  });
});
