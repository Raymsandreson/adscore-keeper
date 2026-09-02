import { describe, it, expect } from 'vitest';
import { janelaDeAtendimento, formatarRestante, ehCanalCloud } from '../whatsapp24hWindow';

const AGORA = new Date('2026-09-02T12:00:00-03:00');
const msg = (direction: string, created_at: string) => ({ direction, created_at });

describe('janelaDeAtendimento', () => {
  it('canal UazAPI não está sujeito à regra e nunca bloqueia', () => {
    const j = janelaDeAtendimento('prudencio1', [msg('inbound', '2026-08-01T10:00:00-03:00')], AGORA);
    expect(j.aplicavel).toBe(false);
    expect(j.aberta).toBe(true);
  });

  it('conversa sem nenhuma mensagem do cliente está fechada', () => {
    const j = janelaDeAtendimento('cloud_gerencia', [msg('outbound', '2026-09-02T11:00:00-03:00')], AGORA);
    expect(j.aplicavel).toBe(true);
    expect(j.aberta).toBe(false);
    expect(j.ultimoInboundEm).toBeNull();
  });

  it('inbound de 3h atrás mantém a janela aberta', () => {
    const j = janelaDeAtendimento('cloud_gerencia', [msg('inbound', '2026-09-02T09:00:00-03:00')], AGORA);
    expect(j.aberta).toBe(true);
    expect(j.restanteMs).toBe(21 * 60 * 60 * 1000);
  });

  it('inbound de 25h atrás fecha a janela', () => {
    const j = janelaDeAtendimento('cloud_gerencia', [msg('inbound', '2026-09-01T11:00:00-03:00')], AGORA);
    expect(j.aberta).toBe(false);
    expect(j.restanteMs).toBe(0);
  });

  it('vale o inbound MAIS RECENTE, não o primeiro da lista', () => {
    const j = janelaDeAtendimento('cloud_gerencia', [
      msg('inbound', '2026-08-20T10:00:00-03:00'),
      msg('inbound', '2026-09-02T10:00:00-03:00'),
      msg('outbound', '2026-09-02T11:59:00-03:00'),
    ], AGORA);
    expect(j.aberta).toBe(true);
    expect(j.ultimoInboundEm).toBe(new Date('2026-09-02T10:00:00-03:00').toISOString());
  });

  it('o que NÓS enviamos não reabre a janela', () => {
    const j = janelaDeAtendimento('cloud_gerencia', [
      msg('inbound', '2026-09-01T09:00:00-03:00'),
      msg('outbound', '2026-09-02T11:59:00-03:00'),
    ], AGORA);
    expect(j.aberta).toBe(false);
  });

  it('tolera lista vazia, nula e data inválida', () => {
    expect(janelaDeAtendimento('cloud_gerencia', [], AGORA).aberta).toBe(false);
    expect(janelaDeAtendimento('cloud_gerencia', null, AGORA).aberta).toBe(false);
    expect(janelaDeAtendimento('cloud_gerencia', [msg('inbound', 'xx')], AGORA).aberta).toBe(false);
  });

  it('reconhece o canal em qualquer caixa e com espaço', () => {
    expect(ehCanalCloud(' Cloud_Gerencia ')).toBe(true);
    expect(ehCanalCloud(null)).toBe(false);
  });
});

describe('formatarRestante', () => {
  it('mostra horas e minutos', () => {
    expect(formatarRestante(3 * 60 * 60 * 1000 + 20 * 60 * 1000)).toBe('3h 20min');
    expect(formatarRestante(2 * 60 * 60 * 1000)).toBe('2h');
    expect(formatarRestante(45 * 60 * 1000)).toBe('45min');
    expect(formatarRestante(0)).toBe('expirada');
  });
});
