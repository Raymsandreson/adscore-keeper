import { describe, it, expect } from 'vitest';
import {
  contarPorAssessor,
  totalGeral,
  concluidasDe,
  statusDeLate,
  statusDeFeedback,
  SEM_RESPONSAVEL,
} from '@/lib/feedbackFunnelStats';

describe('feedbackFunnelStats', () => {
  it('classifica late e feedback com a mesma regra das colunas do funil', () => {
    expect(statusDeLate({ assigned_to_name: 'A', status: 'reagendada' })).toBe('reagendada');
    expect(statusDeLate({ assigned_to_name: 'A', status: 'pendente' })).toBe('atrasada');
    expect(statusDeLate({ assigned_to_name: 'A', status: null })).toBe('atrasada');

    expect(statusDeFeedback({ assigned_to_name: 'A', feedback_outcome: null })).toBe('a_avaliar');
    expect(statusDeFeedback({ assigned_to_name: 'A', feedback_outcome: '' })).toBe('a_avaliar');
    expect(statusDeFeedback({ assigned_to_name: 'A', feedback_outcome: 'satisfeito' })).toBe('satisfeito');
    expect(statusDeFeedback({ assigned_to_name: 'A', feedback_outcome: 'incompleto' })).toBe('incompleto');
    expect(statusDeFeedback({ assigned_to_name: 'A', feedback_outcome: 'insatisfeito' })).toBe('insatisfeito');
  });

  it('conta cada status por assessor responsável e soma o total da linha', () => {
    const linhas = contarPorAssessor(
      [
        { assigned_to_name: 'Joao', status: 'pendente' },
        { assigned_to_name: 'Joao', status: 'em_andamento' },
        { assigned_to_name: 'Andressa', status: 'reagendada' },
      ],
      [
        { assigned_to_name: 'Joao', feedback_outcome: null },
        { assigned_to_name: 'Andressa', feedback_outcome: 'satisfeito' },
        { assigned_to_name: 'Andressa', feedback_outcome: 'incompleto' },
      ],
    );

    const joao = linhas.find(l => l.assessor === 'Joao')!;
    const andressa = linhas.find(l => l.assessor === 'Andressa')!;
    expect(joao).toMatchObject({ atrasada: 2, reagendada: 0, a_avaliar: 1, total: 3 });
    expect(andressa).toMatchObject({ atrasada: 0, reagendada: 1, satisfeito: 1, incompleto: 1, total: 3 });
  });

  it('agrupa quem não tem responsável sob o mesmo rótulo do filtro', () => {
    const linhas = contarPorAssessor(
      [{ assigned_to_name: null, status: 'pendente' }],
      [{ assigned_to_name: null, feedback_outcome: 'insatisfeito' }],
    );
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ assessor: SEM_RESPONSAVEL, atrasada: 1, insatisfeito: 1, total: 2 });
  });

  it('ordena por atrasadas, depois total, depois nome', () => {
    const linhas = contarPorAssessor(
      [
        { assigned_to_name: 'Bia', status: 'pendente' },
        { assigned_to_name: 'Bia', status: 'pendente' },
        { assigned_to_name: 'Ana', status: 'pendente' },
      ],
      [
        { assigned_to_name: 'Ana', feedback_outcome: 'satisfeito' },
        { assigned_to_name: 'Ana', feedback_outcome: 'satisfeito' },
        { assigned_to_name: 'Carla', feedback_outcome: 'satisfeito' },
      ],
    );
    expect(linhas.map(l => l.assessor)).toEqual(['Bia', 'Ana', 'Carla']);
  });

  it('total geral fecha com a soma das linhas', () => {
    const linhas = contarPorAssessor(
      [
        { assigned_to_name: 'Joao', status: 'pendente' },
        { assigned_to_name: 'Andressa', status: 'reagendada' },
      ],
      [
        { assigned_to_name: 'Joao', feedback_outcome: null },
        { assigned_to_name: 'Andressa', feedback_outcome: 'satisfeito' },
      ],
    );
    expect(totalGeral(linhas)).toEqual({
      atrasada: 1, reagendada: 1, a_avaliar: 1, satisfeito: 1, incompleto: 0, insatisfeito: 0, total: 4,
    });
  });

  it('concluídas somam os quatro desfechos e ignoram atrasada/reagendada', () => {
    const linhas = contarPorAssessor(
      [
        { assigned_to_name: 'Joao', status: 'pendente' },
        { assigned_to_name: 'Joao', status: 'reagendada' },
      ],
      [
        { assigned_to_name: 'Joao', feedback_outcome: null },
        { assigned_to_name: 'Joao', feedback_outcome: 'satisfeito' },
        { assigned_to_name: 'Joao', feedback_outcome: 'incompleto' },
        { assigned_to_name: 'Joao', feedback_outcome: 'insatisfeito' },
      ],
    );
    const joao = linhas[0];
    expect(concluidasDe(joao)).toBe(4);          // total 6 — as 2 em aberto ficam de fora
    expect(joao.total).toBe(6);
    expect(concluidasDe(totalGeral(linhas))).toBe(4);
    expect(concluidasDe(totalGeral([]))).toBe(0);
  });

  it('lista vazia devolve zero sem quebrar', () => {
    expect(contarPorAssessor([], [])).toEqual([]);
    expect(totalGeral([])).toEqual({ atrasada: 0, reagendada: 0, a_avaliar: 0, satisfeito: 0, incompleto: 0, insatisfeito: 0, total: 0 });
  });
});
