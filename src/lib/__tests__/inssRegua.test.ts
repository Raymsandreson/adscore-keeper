import { describe, it, expect } from 'vitest';
import {
  resumir, classificarNumeroProcesso, DIAS_EXIGENCIA_CRITICA, type RequerimentoInss,
} from '../inssRegua';

const req = (over: Partial<RequerimentoInss>): RequerimentoInss => ({
  id: Math.random().toString(36).slice(2),
  requerimentoNumber: '123',
  caseId: null, leadId: null, beneficio: null, servico: null, protocolDate: null,
  marcoAtual: 'protocolado', marcoOrdem: 1, temDesfecho: false,
  statusNormalizado: null, emExigencia: false, diasEmExigencia: null,
  concluidaSemResultado: false, despacho: null, ultimoEmail: null,
  ...over,
});

describe('resumir', () => {
  it('conta cada estação da régua', () => {
    const r = resumir([
      req({ marcoAtual: 'protocolado' }),
      req({ marcoAtual: 'concedido', temDesfecho: true }),
      req({ marcoAtual: 'indeferido', temDesfecho: true }),
      req({ marcoAtual: 'indeferido', temDesfecho: true }),
      req({ marcoAtual: 'encerrado', temDesfecho: true }),
    ]);
    expect(r.total).toBe(5);
    expect(r.protocolado).toBe(1);
    expect(r.concedido).toBe(1);
    expect(r.indeferido).toBe(2);
    expect(r.encerrado).toBe(1);
  });

  it('taxa de deferimento ignora encerrado sem análise', () => {
    // Cancelado/arquivado não é derrota — é ausência de análise. Incluí-lo
    // derrubaria a taxa sem que ninguém tenha perdido nada.
    const r = resumir([
      req({ marcoAtual: 'concedido', temDesfecho: true }),
      req({ marcoAtual: 'indeferido', temDesfecho: true }),
      req({ marcoAtual: 'encerrado', temDesfecho: true }),
      req({ marcoAtual: 'encerrado', temDesfecho: true }),
    ]);
    expect(r.taxaDeferimento).toBe(50); // 1 de 2, não 1 de 4
  });

  it('sem desfecho de merito a taxa e null, nao zero', () => {
    // Zero diria "perdemos tudo"; null diz "ainda não há resultado".
    const r = resumir([req({ marcoAtual: 'protocolado' }), req({ marcoAtual: 'encerrado' })]);
    expect(r.taxaDeferimento).toBeNull();
  });

  it('separa exigencia parada alem do limite critico', () => {
    const r = resumir([
      req({ emExigencia: true, diasEmExigencia: 10 }),
      req({ emExigencia: true, diasEmExigencia: DIAS_EXIGENCIA_CRITICA + 1 }),
      req({ emExigencia: true, diasEmExigencia: 900 }),
    ]);
    expect(r.emExigencia).toBe(3);
    expect(r.exigenciaVencida).toBe(2);
  });

  it('mediana de dias em exigencia ignora quem nao esta em exigencia', () => {
    const r = resumir([
      req({ emExigencia: true, diasEmExigencia: 10 }),
      req({ emExigencia: true, diasEmExigencia: 100 }),
      req({ emExigencia: true, diasEmExigencia: 1000 }),
      req({ emExigencia: false, diasEmExigencia: 5 }),
    ]);
    expect(r.medianaDiasExigencia).toBe(100);
  });

  it('conta o buraco de captura: INSS concluiu e nao sabemos o resultado', () => {
    const r = resumir([
      req({ concluidaSemResultado: true }),
      req({ concluidaSemResultado: true }),
      req({}),
    ]);
    expect(r.concluidaSemResultado).toBe(2);
  });

  it('lista vazia nao gera NaN', () => {
    const r = resumir([]);
    expect(r.total).toBe(0);
    expect(r.taxaDeferimento).toBeNull();
    expect(r.medianaDiasExigencia).toBeNull();
  });
});

// Casos tirados do que existe de verdade em lead_processes (07/08/2026).
// Números alterados dígito a dígito — a FORMA é o que está sob teste.
describe('classificarNumeroProcesso', () => {
  it('reconhece CNJ com e sem máscara', () => {
    expect(classificarNumeroProcesso('0801234-56.2025.8.17.0001')).toBe('cnj');
    expect(classificarNumeroProcesso('08012345620258170001')).toBe('cnj');
  });

  it('protocolo federal de 17 dígitos é nup, não requerimento', () => {
    // Era classificado junto com os requerimentos e mandava o usuário
    // esperar um e-mail do INSS que nunca chega.
    expect(classificarNumeroProcesso('13624.202168/2026-18')).toBe('nup');
    expect(classificarNumeroProcesso('13040201812202693')).toBe('nup');
  });

  it('numeração de MP/inquérito não é NUP nem requerimento', () => {
    // Existem no acervo (procedimento do MP, inquérito civil) e têm numeração
    // própria — 21 e 16 dígitos. Nenhuma fonte nossa acompanha isso hoje, então
    // cair em "indefinido" é honesto: não é que falta capturar, é que não há de onde.
    expect(classificarNumeroProcesso('02.11.2026.1234567/2026-11')).toBe('indefinido');
    expect(classificarNumeroProcesso('000512.2026.11.123/8')).toBe('indefinido');
  });

  it('requerimento do INSS é dígito puro de 7 a 12', () => {
    expect(classificarNumeroProcesso('1915296761')).toBe('nb');
    expect(classificarNumeroProcesso('60137897')).toBe('nb');
    expect(classificarNumeroProcesso('933586098')).toBe('nb');
  });

  it('data e CNPJ não viram requerimento por terem dígitos na faixa', () => {
    // 19/07/2026 tem 8 dígitos, a mesma faixa de 35 requerimentos reais.
    // Só o separador distingue — e os 5 com separador casam 0 vezes no banco.
    expect(classificarNumeroProcesso('19/07/2026')).toBe('indefinido');
    expect(classificarNumeroProcesso('2024-07-07')).toBe('indefinido');
    expect(classificarNumeroProcesso('32.947.516/0001-27')).toBe('indefinido');
  });

  it('campo usado como recado não é número', () => {
    expect(classificarNumeroProcesso('Não protocolado')).toBe('indefinido');
    expect(classificarNumeroProcesso('reprotocolar-cliente nao foi p perícia')).toBe('indefinido');
    expect(classificarNumeroProcesso('.')).toBe('indefinido');
    expect(classificarNumeroProcesso('')).toBe('indefinido');
    expect(classificarNumeroProcesso(null)).toBe('indefinido');
  });

  it('número curto demais para requerimento não é requerimento', () => {
    expect(classificarNumeroProcesso('287')).toBe('indefinido');
    expect(classificarNumeroProcesso('0110')).toBe('indefinido');
  });
});
