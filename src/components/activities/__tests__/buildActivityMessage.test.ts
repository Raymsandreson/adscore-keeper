import { describe, it, expect } from 'vitest';
import { buildActivityMessage, formatTempoDedicado, progressBar } from '../buildActivityMessage';
import type { ActivityMessageContext } from '../buildActivityMessage';
import { phaseLabelFromStageId } from '@/hooks/useActivityStepContext';

// Template salvo em produção (board "Acidente de Trabalho", is_default) — não
// referencia fluxo nem progresso, então tudo depende da auto-injeção.
const TPL_PRODUCAO = `*{{saudacao}} Sr(a). {{lead_name}}*

*Assunto da atividade:* {{titulo}}

{{campos_dinamicos}}

{{responsavel_dr ? '*' + responsavel_dr + ' voltará com mais informações no dia ' + data_retorno + ', até o final do dia.*' : ''}}
{{tempo_dedicado}}

Estamos à disposição para quaisquer dúvidas.

🚀Avante!

Tem alguma dúvida ou precisa de uma explicação mais detalhada? Digite 1 . Se tudo está claro, digite 2.`;

const steps = [
  { stepId: 's1', phaseId: 'p1', templateId: 't1', stepLabel: 'Colher documentos', checked: true },
  { stepId: 's2', phaseId: 'p1', templateId: 't1', stepLabel: 'Protocolar', checked: false },
  { stepId: 's3', phaseId: 'p2', templateId: 't2', stepLabel: 'Audiência', checked: false },
];

function makeCtx(over: Record<string, unknown> = {}): ActivityMessageContext {
  return {
    formTitle: 'Protocolo da inicial',
    formDeadline: '2026-08-20',
    formNotificationDate: '2026-08-12',
    formWhatWasDone: 'Peticionamos hoje',
    formCurrentStatus: 'Aguardando distribuição',
    formNextSteps: '', formSolicitacao: '', formRespostaJuizo: '', formNotes: '',
    formAssignedToName: 'Martin Rafael',
    formCoAssignees: [],
    formIsSystem: false,
    formClientNameOverride: '',
    formLeadName: 'Joao da Silva',
    formCaseTitle: '', formProcessId: '', formProcessTitle: '',
    fieldSettings: [{ field_key: 'what_was_done', label: 'O que foi feito', include_in_message: true }],
    selectedActivity: {
      id: '3f7a1c9d-2b4e-4f61-9a20-77c0d1e5b842', created_by: 'u1',
      created_at: '2026-08-01T10:00:00Z', updated_at: '2026-08-01T10:00:00Z',
    },
    caseProcesses: [],
    stepContext: {
      stageId: 'p1', templateId: 't1', stepId: 's2',
      stepLabel: 'Protocolar', phaseLabel: 'Fase Inicial', objectiveLabel: 'Ajuizamento',
      source: 'processo', allSteps: steps,
    },
    leadPreview: { board_id: 'b1' },
    systemOabs: [],
    currentUserId: 'u1',
    resolveUserName: () => 'Ana Paula',
    getTemplateForContext: () => TPL_PRODUCAO,
    timeSpentSeconds: 5040, // 1h24
    ...over,
  } as unknown as ActivityMessageContext;
}

describe('buildActivityMessage — fluxo, progresso e tempo', () => {
  it('mensagem ao CLIENTE traz etapa, objetivo, passo atual, % e tempo', () => {
    const msg = buildActivityMessage(makeCtx(), 'client');
    expect(msg).toContain('*Etapa:* Fase Inicial');
    expect(msg).toContain('*Objetivo:* Ajuizamento');
    expect(msg).toContain('*Passo atual:* Protocolar');
    expect(msg).toContain('*📊 Progresso do processo*');
    expect(msg).toContain('🟩🟩🟩⬜⬜⬜⬜⬜⬜⬜ 33% concluído');
    expect(msg).toContain('*⏱️ Tempo dedicado a esta atividade:* 1h 24min');
  });

  it('mensagem ao ASSESSOR traz a quebra completa do progresso e o tempo', () => {
    const msg = buildActivityMessage(makeCtx(), 'assessor');
    expect(msg).toContain('*Passo atual:* Protocolar');
    expect(msg).toContain('*📊 Progresso do processo*');
    expect(msg).toContain('🟩🟩🟩⬜⬜⬜⬜⬜⬜⬜ 33% concluído');
    expect(msg).toContain('• Fases: 0% (0/2)');
    expect(msg).toContain('• Passos (objetivo atual): 50% (1/2)');
    expect(msg).toContain('*⏱️ Tempo dedicado a esta atividade:* 1h 24min');
  });

  it('template que usa {{progresso}} recebe o valor (antes vinha vazio)', () => {
    const msg = buildActivityMessage(
      makeCtx({ getTemplateForContext: () => '*{{saudacao}}*\n\n{{progresso}}\n\n{{tempo_dedicado}}' }),
      'client',
    );
    expect(msg).toContain('*📊 Progresso do processo*');
    expect(msg).toContain('🟩🟩🟩⬜⬜⬜⬜⬜⬜⬜ 33% concluído');
    expect(msg).toContain('1h 24min');
    // Não pode duplicar: a variável foi usada, a auto-injeção não entra.
    expect(msg.match(/Progresso do/g)).toHaveLength(1);
    expect(msg.match(/Tempo dedicado/g)).toHaveLength(1);
  });

  it('sem tempo cronometrado a linha some (não sai "0min")', () => {
    const msg = buildActivityMessage(makeCtx({ timeSpentSeconds: 0 }), 'client');
    expect(msg).not.toContain('Tempo dedicado');
  });

  it('sem checklist (stepContext null) a mensagem sai sem fluxo, mas não quebra', () => {
    const msg = buildActivityMessage(makeCtx({ stepContext: null }), 'client');
    expect(msg).not.toContain('Progresso do');
    expect(msg).not.toContain('*Etapa:*');
    expect(msg).toContain('*Assunto da atividade:* PROTOCOLO DA INICIAL');
  });
});

describe('nº da atv de referência (POP sem processo)', () => {
  const popSemProcesso = {
    stepContext: {
      stageId: 'p1', templateId: 't1', stepId: 's2',
      stepLabel: 'Protocolar', phaseLabel: 'Fase Inicial', objectiveLabel: 'Ajuizamento',
      source: 'atv', allSteps: steps,
    },
    formProcessId: '',
  };

  it('atv com POP próprio e SEM processo vira a referência do acompanhamento', () => {
    const msg = buildActivityMessage(makeCtx(popSemProcesso), 'client');
    // nº = 8 primeiros hex do UUID, mesmo código do link curto /atv/:code
    expect(msg).toContain('*🔖 Atividade de referência do POP:* nº 3f7a1c9d');
    // rótulo segue a origem do fluxo
    expect(msg).toContain('*📊 Progresso do POP*');
    // e a referência cola logo abaixo da barra, não entre o título e ela
    expect(msg).toMatch(/🟩🟩🟩⬜⬜⬜⬜⬜⬜⬜ 33% concluído\n\*🔖 Atividade de referência/);
  });

  it('atv vinculada a processo NÃO mostra o nº de referência', () => {
    const msg = buildActivityMessage(makeCtx({ formProcessId: 'proc-1' }), 'client');
    expect(msg).not.toContain('Atividade de referência');
  });

  it('fluxo vindo do funil não mostra o nº de referência', () => {
    const msg = buildActivityMessage(
      makeCtx({ ...popSemProcesso, stepContext: { ...popSemProcesso.stepContext, source: 'funil' } }),
      'client',
    );
    expect(msg).not.toContain('Atividade de referência');
  });

  it('mensagem ao assessor também leva o nº de referência', () => {
    const msg = buildActivityMessage(makeCtx(popSemProcesso), 'assessor');
    expect(msg).toContain('Atividade de referência do POP');
  });
});

describe('número do processo', () => {
  const proc = {
    formProcessId: 'p-1',
    caseProcesses: [{ id: 'p-1', title: 'INDENIZAÇÃO', process_number: '0801234-56.2025.8.05.0001' }],
  };

  it('com número cadastrado, sai o nº vivo do processo', () => {
    const msg = buildActivityMessage(makeCtx(proc), 'client');
    expect(msg).toContain('*Processo n° 0801234-56.2025.8.05.0001* — INDENIZAÇÃO');
  });

  it('sem número cadastrado (52% da base), não sai `n° "—"`', () => {
    const msg = buildActivityMessage(
      makeCtx({ ...proc, caseProcesses: [{ id: 'p-1', title: 'INDENIZAÇÃO', process_number: null }] }),
      'client',
    );
    expect(msg).toContain('Referente ao processo "INDENIZAÇÃO"');
    expect(msg).not.toContain('—"');
    expect(msg).not.toContain('n° "');
  });

  it('não duplica a linha do processo quando ela já veio do template', () => {
    const msg = buildActivityMessage(
      makeCtx({ ...proc, getTemplateForContext: () => '*{{saudacao}}*\n\n{{process_info}}\n\n{{campos_dinamicos}}' }),
      'client',
    );
    expect(msg.match(/Processo n°/g)).toHaveLength(1);
  });
});

describe('ordem do bloco de fluxo', () => {
  const ordem = (msg: string) => [
    msg.search(/\*Processo n°|Referente ao processo/),
    msg.search(/📊 Progresso do/),
    msg.search(/\*Etapa:\*/),
    msg.search(/⏱️ Tempo dedicado/),
  ];

  it('processo → barra → etapa/objetivo/passo → tempo (com processo)', () => {
    const msg = buildActivityMessage(makeCtx({
      formProcessId: 'p-1',
      caseProcesses: [{ id: 'p-1', title: 'INDENIZAÇÃO', process_number: '0801234-56.2025.8.05.0001' }],
    }), 'client');
    const [proc, prog, etapa, tempo] = ordem(msg);
    expect(proc).toBeGreaterThanOrEqual(0);
    expect(prog).toBeGreaterThan(proc);
    expect(etapa).toBeGreaterThan(prog);
    expect(tempo).toBeGreaterThan(etapa);
  });

  it('mesma ordem sem processo vinculado', () => {
    const msg = buildActivityMessage(makeCtx(), 'client');
    const [, prog, etapa, tempo] = ordem(msg);
    expect(etapa).toBeGreaterThan(prog);
    expect(tempo).toBeGreaterThan(etapa);
  });

  it('mensagem ao assessor segue a mesma ordem', () => {
    const msg = buildActivityMessage(makeCtx(), 'assessor');
    const [, prog, etapa] = ordem(msg);
    expect(etapa).toBeGreaterThan(prog);
  });
});

describe('progressBar', () => {
  it('10 blocos, proporcional', () => {
    expect(progressBar(0)).toBe('⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜');
    expect(progressBar(33)).toBe('🟩🟩🟩⬜⬜⬜⬜⬜⬜⬜');
    expect(progressBar(100)).toBe('🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩');
  });

  it('fluxo iniciado nunca mostra barra vazia', () => {
    expect(progressBar(1)).toBe('🟩⬜⬜⬜⬜⬜⬜⬜⬜⬜');
    expect(progressBar(4)).toBe('🟩⬜⬜⬜⬜⬜⬜⬜⬜⬜');
  });
});

describe('formatTempoDedicado', () => {
  it('formata horas e minutos', () => {
    expect(formatTempoDedicado(0)).toBe('');
    expect(formatTempoDedicado(59)).toBe('');       // < 1min não vira linha
    expect(formatTempoDedicado(600)).toBe('10min');
    expect(formatTempoDedicado(3600)).toBe('1h');
    expect(formatTempoDedicado(5040)).toBe('1h 24min');
  });
});

describe('phaseLabelFromStageId', () => {
  it('recupera o rótulo de fases renomeadas/removidas do board', () => {
    expect(phaseLabelFromStageId('captação_e_triagem_1776178507796_awyv')).toBe('Captação e triagem');
    expect(phaseLabelFromStageId('processo_judicial_1774615654956_6qvi')).toBe('Processo judicial');
    expect(phaseLabelFromStageId('onboarding_1778159356653')).toBe('Onboarding');
  });

  it('ignora ids legados curtos — melhor sem a linha que "Etapa: Done"', () => {
    expect(phaseLabelFromStageId('done')).toBeNull();
    expect(phaseLabelFromStageId('whatsapp')).toBeNull();
    expect(phaseLabelFromStageId(null)).toBeNull();
  });
});
