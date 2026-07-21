import { describe, it, expect } from 'vitest';
import { isGapWorking } from '../ActivityTimerContext';

/**
 * Regressão: sem atividade aberta, o cronômetro contava 100% do tempo como
 * OCIOSO — quem estava atendendo no WhatsApp ou cadastrando atividade aparecia
 * ocioso e ainda levava alarme a cada 5 min. Ocioso passou a ser falta de
 * INTERAÇÃO, não falta de atividade vinculada.
 */
describe('isGapWorking — trabalho avulso x ociosidade real', () => {
  const base = { idleFor: 0, locked: false, deltaSec: 1 };

  it('conta como trabalho quando houve interação agora (digitando no WhatsApp)', () => {
    expect(isGapWorking(base)).toBe(true);
  });

  it('segue contando como trabalho dentro da janela de 5 min', () => {
    expect(isGapWorking({ ...base, idleFor: 4 * 60 * 1000 })).toBe(true);
    expect(isGapWorking({ ...base, idleFor: 5 * 60 * 1000 - 1 })).toBe(true);
  });

  it('vira ocioso ao completar 5 min sem interação', () => {
    expect(isGapWorking({ ...base, idleFor: 5 * 60 * 1000 })).toBe(false);
    expect(isGapWorking({ ...base, idleFor: 30 * 60 * 1000 })).toBe(false);
  });

  it('tela bloqueada é ocioso mesmo com interação recente', () => {
    expect(isGapWorking({ ...base, locked: true })).toBe(false);
  });

  it('máquina suspensa (salto >= 120s entre ticks) é ocioso', () => {
    expect(isGapWorking({ ...base, deltaSec: 120 })).toBe(false);
    expect(isGapWorking({ ...base, deltaSec: 3600 })).toBe(false);
  });
});
