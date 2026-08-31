import { describe, it, expect } from 'vitest';
import { dedupInstancias, ordenarPassos, escolherPassoAtual } from '@/lib/leadStepContext';
import type { StepOption } from '@/lib/leadStepContext';

/**
 * Regressão do caso 1017247-47.2025.4.01.3100 (30/08/2026): a mensagem ao
 * cliente saiu com "FASE 1 · Viabilidade e Saneamento · Análise do
 * Indeferimento Administrativo" num processo que já estava na fase de
 * contestação, com 16 dos 27 passos marcados no banco.
 */

const passo = (over: Partial<StepOption> & Pick<StepOption, 'stepId' | 'phaseId' | 'templateId'>): StepOption => ({
  stepLabel: over.stepId,
  phaseLabel: null,
  objectiveLabel: null,
  instanceId: `inst-${over.templateId}`,
  checked: false,
  assigneeId: null,
  assigneeOrigem: 'nenhum',
  ...over,
});

describe('ordenarPassos — ordem projetada do POP', () => {
  const faseIndex = { f1: 0, f2: 1, f3: 2 };
  const objetivoOrdem = { 'f1|tB': 0, 'f1|tA': 1, 'f2|tC': 0 };

  it('fase manda sobre a ordem em que as instâncias foram criadas', () => {
    // Chegam com a fase 2 primeiro (instância criada antes).
    const steps = [
      passo({ stepId: 'p-f2', phaseId: 'f2', templateId: 'tC' }),
      passo({ stepId: 'p-f1', phaseId: 'f1', templateId: 'tB' }),
    ];
    expect(ordenarPassos(steps, faseIndex, objetivoOrdem).map(s => s.stepId))
      .toEqual(['p-f1', 'p-f2']);
  });

  it('dentro da fase, o objetivo sai na ordem do link (display_order)', () => {
    const steps = [
      passo({ stepId: 'a1', phaseId: 'f1', templateId: 'tA' }),
      passo({ stepId: 'b1', phaseId: 'f1', templateId: 'tB' }),
    ];
    expect(ordenarPassos(steps, faseIndex, objetivoOrdem).map(s => s.stepId))
      .toEqual(['b1', 'a1']);
  });

  it('passos do mesmo objetivo mantêm a ordem em que estão no objetivo', () => {
    const steps = [
      passo({ stepId: 'b1', phaseId: 'f1', templateId: 'tB' }),
      passo({ stepId: 'b2', phaseId: 'f1', templateId: 'tB' }),
      passo({ stepId: 'b3', phaseId: 'f1', templateId: 'tB' }),
    ];
    expect(ordenarPassos(steps, faseIndex, objetivoOrdem).map(s => s.stepId))
      .toEqual(['b1', 'b2', 'b3']);
  });

  it('fase que não existe mais no board vai para o fim, nunca para o começo', () => {
    const steps = [
      passo({ stepId: 'orfao', phaseId: 'fase_antiga', templateId: 'tX' }),
      passo({ stepId: 'p-f1', phaseId: 'f1', templateId: 'tB' }),
    ];
    expect(ordenarPassos(steps, faseIndex, objetivoOrdem).map(s => s.stepId))
      .toEqual(['p-f1', 'orfao']);
  });
});

describe('escolherPassoAtual', () => {
  const steps = [
    passo({ stepId: 'f1a', phaseId: 'f1', templateId: 't1', checked: true }),
    passo({ stepId: 'f1b', phaseId: 'f1', templateId: 't1', checked: false }),
    passo({ stepId: 'f2a', phaseId: 'f2', templateId: 't2', checked: false }),
  ];

  it('sem fase atual, é o 1º não-marcado da ordem projetada', () => {
    expect(escolherPassoAtual(steps, null)).toBe('f1b');
  });

  it('com fase atual, é o 1º não-marcado DELA — mesmo com pendência atrás', () => {
    expect(escolherPassoAtual(steps, 'f2')).toBe('f2a');
  });

  it('tudo marcado: fica no último, não devolve nada', () => {
    const todos = steps.map(s => ({ ...s, checked: true }));
    expect(escolherPassoAtual(todos, null)).toBe('f2a');
  });

  it('sem passo nenhum, devolve null', () => {
    expect(escolherPassoAtual([], 'f1')).toBeNull();
  });
});

describe('dedupInstancias', () => {
  const inst = (id: string, stage: string, tpl: string, marcados: number, total: number) => ({
    id,
    stage_id: stage,
    checklist_template_id: tpl,
    items: Array.from({ length: total }, (_, i) => ({
      id: `${id}-${i}`, label: `p${i}`, checked: i < marcados,
    })),
  });

  it('reinstanciação do mesmo objetivo não duplica passo: fica a mais avançada', () => {
    const out = dedupInstancias([inst('velha', 'f1', 't1', 0, 3), inst('nova', 'f1', 't1', 2, 3)]);
    expect(out.map(i => i.id)).toEqual(['nova']);
  });

  it('mesmo objetivo em fases diferentes são duas instâncias legítimas', () => {
    const out = dedupInstancias([inst('a', 'f1', 't1', 0, 2), inst('b', 'f2', 't1', 0, 2)]);
    expect(out.map(i => i.id).sort()).toEqual(['a', 'b']);
  });

  it('passo histórico (supersededBy) não conta como avanço', () => {
    const viva = inst('viva', 'f1', 't1', 1, 3);
    const historica = inst('historica', 'f1', 't1', 3, 3);
    historica.items = historica.items.map(i => ({ ...i, supersededBy: 'outro' }));
    const out = dedupInstancias([historica, viva]);
    expect(out.map(i => i.id)).toEqual(['viva']);
  });
});
