import { describe, it, expect } from 'vitest';
import {
  ramoDoProcesso, ufDoProcesso, ufAmbigua, ramoPrometidoPeloNome,
  RAMO_ORDEM, RAMO_BADGE, RAMO_ROTULO,
} from '../ramoDoProcesso';

// Números reais da base (24/08/2026), conferidos contra `tribunal_sigla`.
const TRT6_PE = '0000581-03.2026.5.06.0391'; // Premolaje, TRT-6
const TRT8    = '0001561-29.2025.5.08.0101'; // TRT-8: PA + AP
const TJSP    = '0001351-46.2015.8.26.0001';
const TRF5    = '0800123-45.2024.4.05.8100';

describe('ramoDoProcesso', () => {
  it('lê o ramo do segmento, sem depender de `area`', () => {
    expect(ramoDoProcesso(TRT6_PE)).toBe('trabalhista');
    expect(ramoDoProcesso(TJSP)).toBe('estadual');
    expect(ramoDoProcesso(TRF5)).toBe('federal');
  });

  // As duas linhas que a tela precisa mostrar separadas: 210 fichas sem número
  // e 17 com número quebrado, só no POP trabalhista.
  it('separa ficha sem número de ficha com número quebrado', () => {
    expect(ramoDoProcesso(null)).toBe('SEM_NUMERO');
    expect(ramoDoProcesso('')).toBe('SEM_NUMERO');
    expect(ramoDoProcesso('sem número')).toBe('SEM_NUMERO');
    expect(ramoDoProcesso('123')).toBe('NUMERO_INVALIDO');
    expect(ramoDoProcesso('12345678901234567')).toBe('NUMERO_INVALIDO');
  });

  it('todo ramo tem rótulo, badge e lugar na ordem', () => {
    for (const r of RAMO_ORDEM) {
      expect(RAMO_ROTULO[r]).toBeTruthy();
      expect(RAMO_BADGE[r]).toBeTruthy();
    }
    // Buraco de cadastro fica por último, depois da jurisdição.
    expect(RAMO_ORDEM.slice(-2)).toEqual(['NUMERO_INVALIDO', 'SEM_NUMERO']);
  });
});

describe('ufAmbigua', () => {
  it('marca o tribunal que cobre mais de um estado', () => {
    expect(ufAmbigua(TRT8)).toBe(true);   // PA + AP
    expect(ufAmbigua(TRF5)).toBe(true);   // 6 estados
    expect(ufAmbigua(TRT6_PE)).toBe(false);
    expect(ufAmbigua(TJSP)).toBe(false);
    expect(ufAmbigua('123')).toBe(false);
  });
});

describe('ufDoProcesso', () => {
  it('a Tabela Auxiliar ganha do cadastro, que ganha do número', () => {
    expect(ufDoProcesso({ process_number: TRT6_PE, estado_origem_sigla: 'CE', uf_proc: 'BA' })).toBe('BA');
    expect(ufDoProcesso({ process_number: TRT6_PE, estado_origem_sigla: 'CE' })).toBe('CE');
    expect(ufDoProcesso({ process_number: TRT6_PE })).toBe('PE');
  });

  // Sem isto, os 111 processos do TRT-8 que TÊM cadastro ficariam sem UF.
  it('o cadastro resolve o número ambíguo, e o número resolve o cadastro vazio', () => {
    expect(ufDoProcesso({ process_number: TRT8, estado_origem_sigla: 'PA' })).toBe('PA');
    expect(ufDoProcesso({ process_number: TRT8 })).toBeNull();
  });

  it('campo em branco não conta como resposta', () => {
    expect(ufDoProcesso({ process_number: TRT6_PE, estado_origem_sigla: '  ', uf_proc: '' })).toBe('PE');
  });

  it('ficha sem nada devolve null, não inventa', () => {
    expect(ufDoProcesso({})).toBeNull();
  });
});

describe('ramoPrometidoPeloNome', () => {
  it('lê o ramo no nome do POP', () => {
    expect(ramoPrometidoPeloNome('Trabalhistas judicial — marcos')).toBe('trabalhista');
    expect(ramoPrometidoPeloNome('POP - BPC - Administrativo')).toBe('federal');
    expect(ramoPrometidoPeloNome('Justiça Comum')).toBe('estadual');
  });

  it('ignora acento e caixa', () => {
    expect(ramoPrometidoPeloNome('SALÁRIO MATERNIDADE URBANO')).toBe('federal');
  });

  // Na dúvida a tela mostra a distribuição sem acusar ninguém.
  it('devolve null quando o nome não diz o ramo', () => {
    expect(ramoPrometidoPeloNome('Leads Inbound')).toBeNull();
    expect(ramoPrometidoPeloNome('INQUÉRITO POLICIAL')).toBeNull();
    expect(ramoPrometidoPeloNome(null)).toBeNull();
  });
});
