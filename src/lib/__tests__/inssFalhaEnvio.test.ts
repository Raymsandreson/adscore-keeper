import { describe, it, expect } from 'vitest';
import {
  classificarFalha,
  avisoDeFalhaNoEnvio,
} from '../../../railway-server/src/lib/inss-falha-envio';

// Os dois primeiros são o `zap_erro` literal das duas falhas registradas em
// `inss_status_history` até 04/09/2026 — não texto inventado.
const ERRO_DESCONECTADA =
  'uazapi 503: {"error":true,"message":"WhatsApp disconnected: session is not reconnectable"}';
const ERRO_GRUPO_SUMIU =
  'uazapi 500: {"error":"error sending message after 2 attempts: failed to get group members: that group does not exist"}';

describe('classificarFalha', () => {
  it('reconhece a instância desconectada', () => {
    expect(classificarFalha(ERRO_DESCONECTADA)).toBe('instancia_desconectada');
  });

  it('reconhece o grupo que não existe mais', () => {
    expect(classificarFalha(ERRO_GRUPO_SUMIU)).toBe('grupo_inexistente');
  });

  it('não confunde os dois: ambos são 5xx da UazAPI', () => {
    expect(classificarFalha(ERRO_DESCONECTADA)).not.toBe(
      classificarFalha(ERRO_GRUPO_SUMIU),
    );
  });

  it('classifica os desfechos da fila', () => {
    expect(classificarFalha('agendado sem texto')).toBe('sem_texto');
    expect(classificarFalha('parado mais de 3 dias na fila')).toBe('expirado');
  });

  it('erro vazio ou desconhecido cai em outro, sem quebrar', () => {
    expect(classificarFalha(null)).toBe('outro');
    expect(classificarFalha('')).toBe('outro');
    expect(classificarFalha('uazapi 429: rate limited')).toBe('outro');
  });
});

describe('avisoDeFalhaNoEnvio', () => {
  it('diz que o cliente não foi avisado, que é o que importa', () => {
    const t = avisoDeFalhaNoEnvio({ zapErro: ERRO_DESCONECTADA, tipo: 'protocolado' });
    expect(t).toMatch(/O CLIENTE NÃO FOI AVISADO/);
  });

  it('manda reconectar quando a instância caiu, e vincular quando o grupo sumiu', () => {
    expect(avisoDeFalhaNoEnvio({ zapErro: ERRO_DESCONECTADA })).toMatch(/[Rr]econecte a instância/);
    expect(avisoDeFalhaNoEnvio({ zapErro: ERRO_GRUPO_SUMIU })).toMatch(/vincular grupo/);
  });

  it('destaca o indeferimento, porque ali o prazo do cliente corre', () => {
    const indef = avisoDeFalhaNoEnvio({ zapErro: ERRO_DESCONECTADA, tipo: 'indeferido' });
    const prot = avisoDeFalhaNoEnvio({ zapErro: ERRO_DESCONECTADA, tipo: 'protocolado' });
    expect(indef).toMatch(/INDEFERIMENTO/);
    expect(prot).not.toMatch(/INDEFERIMENTO/);
  });

  it('carrega o motivo técnico, mas nunca sem instrução do que fazer', () => {
    const t = avisoDeFalhaNoEnvio({ zapErro: ERRO_GRUPO_SUMIU });
    expect(t).toMatch(/Motivo técnico:/);
    expect(t.split('Motivo técnico:')[0].length).toBeGreaterThan(120);
  });

  it('sem motivo técnico ainda diz o que fazer', () => {
    const t = avisoDeFalhaNoEnvio({ zapErro: null });
    expect(t).not.toMatch(/Motivo técnico:/);
    expect(t).toMatch(/avise o cliente/i);
  });

  it('não vaza dado do cliente no aviso', () => {
    const t = avisoDeFalhaNoEnvio({ zapErro: ERRO_DESCONECTADA, tipo: 'indeferido' });
    expect(t).not.toMatch(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/); // CPF
    expect(t).not.toMatch(/\d{4,}/); // número longo (benefício, processo)
  });
});
