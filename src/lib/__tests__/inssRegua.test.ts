import { describe, it, expect } from 'vitest';
import { resumir, DIAS_EXIGENCIA_CRITICA, type RequerimentoInss } from '../inssRegua';

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
