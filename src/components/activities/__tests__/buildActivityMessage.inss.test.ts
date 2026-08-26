import { describe, it, expect } from 'vitest';
import { buildActivityMessage, type ActivityMessageContext } from '../buildActivityMessage';

/** Contexto mínimo: só o que o cálculo de progresso enxerga. */
function ctx(over: Partial<ActivityMessageContext> = {}): ActivityMessageContext {
  const passos = [
    { stepId: 's1', phaseId: 'f1', templateId: 't1', stepLabel: 'Juntar documentos', checked: true },
    { stepId: 's2', phaseId: 'f1', templateId: 't1', stepLabel: 'Protocolar', checked: false },
    { stepId: 's3', phaseId: 'f2', templateId: 't2', stepLabel: 'Acompanhar', checked: false },
  ];
  return {
    formTitle: 'Andamento do pedido',
    formDeadline: '', formNotificationDate: '', formNotificationTime: '',
    formWhatWasDone: 'Enviamos os documentos', formCurrentStatus: 'Aguardando o INSS',
    formNextSteps: 'Acompanhar', formSolicitacao: '', formRespostaJuizo: '', formNotes: '',
    formAssignedToName: 'Jose Francisco', formCoAssignees: [], formIsSystem: false,
    formClientNameOverride: '', formLeadName: 'PREV 1630 - EVELYN', formCaseTitle: 'CASO 1',
    formProcessId: '', formProcessTitle: '',
    fieldSettings: [], selectedActivity: null, caseProcesses: [],
    stepContext: { stageId: 'f1', templateId: 't1', stepId: 's2', allSteps: passos },
    leadPreview: null, systemOabs: new Set<string>(), currentUserId: null,
    resolveUserName: () => null, getTemplateForContext: () => undefined,
    ...over,
  } as ActivityMessageContext;
}

describe('progresso do caso vs. desfecho no INSS', () => {
  it('sem desfecho, segue anunciando o progresso do POP', () => {
    const msg = buildActivityMessage(ctx(), 'client');
    expect(msg).toContain('Progresso do caso');
  });

  it('requerimento indeferido: o cliente NÃO recebe percentual nenhum', () => {
    const msg = buildActivityMessage(
      ctx({ inssDesfecho: { encerrado: true, resultado: 'indeferido', requerimento: '1514532493', emAndamento: 0 } }),
      'client',
    );
    expect(msg).not.toContain('Progresso do caso');
    expect(msg).not.toMatch(/\d+% concluído/);
    // e a notícia do indeferimento não vaza de esguelha na mensagem da atividade
    expect(msg).not.toContain('INDEFERIDO');
  });

  it('deferido também cala o percentual — o caso não está "33% feito"', () => {
    const msg = buildActivityMessage(
      ctx({ inssDesfecho: { encerrado: true, resultado: 'deferido', requerimento: '999', emAndamento: 0 } }),
      'client',
    );
    expect(msg).not.toMatch(/\d+% concluído/);
  });

  it('o assessor recebe o alerta no lugar do detalhe', () => {
    const msg = buildActivityMessage(
      ctx({ inssDesfecho: { encerrado: true, resultado: 'indeferido', requerimento: '1514532493', emAndamento: 0 } }),
      'assessor',
    );
    expect(msg).toContain('1514532493');
    expect(msg).toContain('INDEFERIDO');
  });

  it('com outro requerimento em andamento, o progresso continua valendo', () => {
    const msg = buildActivityMessage(
      ctx({ inssDesfecho: { encerrado: false, resultado: 'indeferido', requerimento: '1', emAndamento: 1 } }),
      'client',
    );
    expect(msg).toContain('Progresso do caso');
  });
});
