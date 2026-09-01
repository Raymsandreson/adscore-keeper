import { describe, it, expect } from 'vitest';
import { isRobotActivity, robotActivityLabel } from '@/lib/activityRobot';

describe('activityRobot — quem criou a atividade', () => {
  it('robô: action_source = system', () => {
    const a = { action_source: 'system', action_source_detail: 'Robô do INSS', created_by_ai: false };
    expect(isRobotActivity(a)).toBe(true);
    expect(robotActivityLabel(a)).toBe('Criada automaticamente por: Robô do INSS');
  });

  it('robô: sync de prazos do Escavador', () => {
    const a = { action_source: 'escavador_compromissos', action_source_detail: null, created_by_ai: false };
    expect(isRobotActivity(a)).toBe(true);
    expect(robotActivityLabel(a)).toContain('Escavador');
  });

  it('robô: created_by_ai', () => {
    const a = { action_source: null, action_source_detail: null, created_by_ai: true };
    expect(isRobotActivity(a)).toBe(true);
    expect(robotActivityLabel(a)).toBe('Criada automaticamente pela IA');
  });

  it('pessoa: carimbo manual', () => {
    const a = { action_source: 'manual', action_source_detail: null, created_by_ai: false };
    expect(isRobotActivity(a)).toBe(false);
    expect(robotActivityLabel(a)).toBeNull();
  });

  it('linha antiga sem carimbo nenhum não vira robô por chute', () => {
    expect(isRobotActivity({})).toBe(false);
    expect(isRobotActivity(null)).toBe(false);
  });

  it('is_system (botão "Interna" do formulário) NÃO é robô', () => {
    // Regressão do motivo de não usar is_system como sinal: quem marca "Interna"
    // é gente, e o Escavador marca is_system junto com o action_source dele.
    const internaDeGente = { action_source: 'manual', action_source_detail: null, created_by_ai: false, is_system: true };
    expect(isRobotActivity(internaDeGente)).toBe(false);
  });
});
