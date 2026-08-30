import { describe, it, expect } from 'vitest';
import { buildActivityMessage, type ActivityMessageContext } from '../buildActivityMessage';

/**
 * Regressão do caso 1017247-47.2025.4.01.3100 (POP "BPC JUDICIAL", 30/08/2026).
 *
 * A barra da ficha mostrava o caso andando na fase de contestação e a mensagem
 * ao cliente saía com "estamos no comecinho (0% concluído)" e passo da FASE 1.
 * Duas medidas do mesmo caso: o percentual da mensagem contava passo no plano,
 * o da tela pesa fase → objetivo → passo.
 */

/** Passos reais do POP no dia (16 de 27 marcados). */
const PASSOS = [
  ['stage_prep_ajuizamento', 'tpl_elaboracao', 'Montagem do Kit Documental', true],
  ['stage_prep_ajuizamento', 'tpl_elaboracao', 'Elaboração da Petição Inicial', true],
  ['stage_prep_ajuizamento', 'tpl_elaboracao', 'Protocolo da Ação Judicial', true],
  ['stage_prep_ajuizamento', 'tpl_viabilidade', 'Análise do Indeferimento Administrativo', true],
  ['stage_prep_ajuizamento', 'tpl_viabilidade', 'Verificação do CadÚnico e do Grupo Familiar', true],
  ['stage_prep_ajuizamento', 'tpl_viabilidade', 'Decisão', true],
  ['stage_dist_mon', 'tpl_monitoramento', 'Monitoramento do Despacho Inicial', true],
  ['stage_dist_mon', 'tpl_monitoramento', 'Decisão sobre a Tutela de Urgência', true],
  ['stage_instrucao', 'tpl_social', 'Preparação da Família para a Visita', true],
  ['stage_instrucao', 'tpl_social', 'Pontos Obrigatórios do Laudo Social', true],
  ['stage_instrucao', 'tpl_social', 'Análise do Estudo Social e Manifestação', true],
  ['stage_instrucao', 'tpl_medica', 'Preparação do Autor para a Perícia', true],
  ['stage_instrucao', 'tpl_medica', 'Quesitos do Impedimento de Longo Prazo', true],
  ['stage_instrucao', 'tpl_medica', 'Análise do Laudo Médico e Manifestação', true],
  ['stage_defesa_contestacao', 'tpl_replica', 'Análise da Contestação do INSS', true],
  ['stage_defesa_contestacao', 'tpl_replica', 'Elaboração da Réplica', true],
  ['stage_defesa_contestacao', 'tpl_replica', 'Análise de Proposta de Acordo (se houver)', false],
  ['stage_sentenca_execucao', 'tpl_sentenca', 'Conferência do Dispositivo', false],
  ['stage_sentenca_execucao', 'tpl_sentenca', 'Comunicação ao Cliente e Atualização do Recebível', false],
  ['stage_sentenca_execucao', 'tpl_recursal', 'Definição do Rito e do Recurso Cabível', false],
  ['stage_sentenca_execucao', 'tpl_recursal', 'Instâncias Superiores', false],
  ['stage_sentenca_execucao', 'tpl_cumprimento', 'Implantação do Benefício', false],
  ['stage_sentenca_execucao', 'tpl_cumprimento', 'Cálculo e Requisição dos Atrasados', false],
  ['stage_sentenca_execucao', 'tpl_cumprimento', 'Destaque de Honorários e Liberação', false],
  ['stage_pos_decisao', 'tpl_contas', 'Prestação de Contas ao Cliente', false],
  ['stage_pos_decisao', 'tpl_contas', 'Manutenção do Benefício', false],
  ['stage_pos_decisao', 'tpl_contas', 'Finalização e Arquivamento', false],
] as const;

const FASES = [
  { id: 'stage_prep_ajuizamento', name: 'FASE 1 — Preparação e Ajuizamento' },
  { id: 'stage_dist_mon', name: 'FASE 2 — Distribuição e monitoramento' },
  { id: 'stage_instrucao', name: 'FASE 3 — Instrução Probatória' },
  { id: 'stage_defesa_contestacao', name: 'FASE 4 — Defesa em Caso de Contestação' },
  { id: 'stage_sentenca_execucao', name: 'FASE 5 — Sentença, Recursos e Execução' },
  { id: 'stage_pos_decisao', name: 'FASE 6 — Pós-Decisão / Encerramento' },
];

const allSteps = PASSOS.map(([phaseId, templateId, stepLabel, checked], i) => ({
  stepId: `s${i}`, phaseId, templateId, stepLabel, checked,
}));

function ctx(over: Partial<ActivityMessageContext> = {}): ActivityMessageContext {
  return {
    formTitle: 'APRESENTAR MANIFESTAÇÃO SOBRE A CONTESTAÇÃO DO INSS',
    formDeadline: '', formNotificationDate: '', formNotificationTime: '',
    formWhatWasDone: 'Réplica protocolada', formCurrentStatus: 'Aguardando sentença',
    formNextSteps: 'Acompanhar', formSolicitacao: '', formRespostaJuizo: '', formNotes: '',
    formAssignedToName: 'Gisele Borges', formCoAssignees: [], formIsSystem: false,
    formClientNameOverride: '', formLeadName: 'PREV 03 - SIDINEY', formCaseTitle: 'PREV 03',
    formProcessId: '', formProcessTitle: '',
    fieldSettings: [], selectedActivity: null, caseProcesses: [],
    stepContext: {
      stageId: 'stage_defesa_contestacao',
      templateId: 'tpl_replica',
      stepId: 's16',
      stepLabel: 'Análise de Proposta de Acordo (se houver)',
      phaseLabel: 'FASE 4 — Defesa em Caso de Contestação',
      objectiveLabel: 'Contestação e réplica',
      allSteps,
      phases: FASES,
    },
    leadPreview: null, systemOabs: new Set<string>(), currentUserId: null,
    resolveUserName: () => null, getTemplateForContext: () => undefined,
    ...over,
  } as ActivityMessageContext;
}

describe('andamento pela régua de marcos', () => {
  /** Régua real deste processo em 30/08/2026: 2 de 5 marcos, atual = Perícia. */
  const REGUA = {
    percentual: 40, atualRotulo: 'Perícia', atualData: '2026-04-28',
    previstos: 5, cumpridos: 2,
  };

  it('havendo marco, o percentual é o da régua — não o dos passos', () => {
    const msg = buildActivityMessage(ctx({ regua: REGUA }), 'client');
    expect(msg).toContain('Andamento do processo: 40% concluído');
    expect(msg).not.toContain('Progresso do caso');
    expect(msg).not.toContain('61%');
  });

  it('anuncia o marco atual com a data em que foi detectado', () => {
    const msg = buildActivityMessage(ctx({ regua: REGUA }), 'client');
    // Cliente lê a versão leiga do marco
    expect(msg).toContain('*Marco atual:* avaliação com o perito da Justiça em 28/04/2026');
  });

  it('o passo do POP continua sendo o do checklist — são duas medidas', () => {
    const msg = buildActivityMessage(ctx({ regua: REGUA }), 'client');
    expect(msg).toContain('*Passo atual:* Análise de Proposta de Acordo (se houver)');
  });

  it('sem marco detectado (percentual null), cai no progresso por passos', () => {
    const semMarco = { ...REGUA, percentual: null, atualRotulo: null, atualData: null, previstos: 0, cumpridos: 0 };
    const msg = buildActivityMessage(ctx({ regua: semMarco }), 'client');
    expect(msg).toContain('Progresso do caso: 61% concluído');
    expect(msg).not.toContain('Andamento do processo');
  });

  it('requerimento encerrado no INSS silencia a régua também', () => {
    const msg = buildActivityMessage(
      ctx({ regua: REGUA, inssDesfecho: { encerrado: true, resultado: 'indeferido', requerimento: '123', emAndamento: 0 } }),
      'client',
    );
    expect(msg).not.toMatch(/\d+% concluído/);
  });

  it('o assessor recebe a contagem de marcos no detalhe', () => {
    const msg = buildActivityMessage(ctx({ regua: REGUA }), 'assessor');
    expect(msg).toContain('2/5 previstos');
  });
});

describe('campos vazios preenchidos pela régua', () => {
  const REGUA_CHEIA = {
    percentual: 50, atualRotulo: 'Contestação do INSS', atualData: '2026-06-17',
    previstos: 6, cumpridos: 3,
    atingidos: [
      { rotulo: 'Estudo social', data: '2026-04-28' },
      { rotulo: 'Contestação do INSS', data: '2026-06-17' },
    ],
    proximoRotulo: 'Sentença',
  };
  const semCampos = {
    formCurrentStatus: '', formWhatWasDone: '', formNextSteps: '',
    fieldSettings: [
      { field_key: 'current_status', label: 'Como está?', include_in_message: true },
      { field_key: 'what_was_done', label: 'O que foi feito?', include_in_message: true },
      { field_key: 'next_steps', label: 'Próximo passo', include_in_message: true },
    ],
  };

  it('atividade sem texto ganha as três seções, em linguagem de leigo', () => {
    const msg = buildActivityMessage(ctx({ ...semCampos, regua: REGUA_CHEIA }), 'client');
    expect(msg).toContain('*Como está?:* O processo está andando normalmente. A novidade mais recente: o INSS apresentou a defesa dele, em 17/06/2026.');
    expect(msg).toContain('*O que foi feito?:* Até aqui o processo já passou por: visita da assistente social da Justiça (28/04/2026); o INSS apresentou a defesa dele (17/06/2026).');
    expect(msg).toContain('*Próximo passo:* Agora aguardamos a próxima etapa: decisão do juiz (sentença). Estamos de olho em cada movimentação e avisamos assim que houver novidade.');
    // jargão técnico não vaza pro cliente
    expect(msg).not.toContain('Réplica');
    expect(msg).not.toContain('marco registrado');
  });

  it('texto digitado pelo assessor sempre vence o automático', () => {
    const msg = buildActivityMessage(
      ctx({ ...semCampos, formCurrentStatus: 'Réplica protocolada, aguardando sentença.', regua: REGUA_CHEIA }),
      'client',
    );
    expect(msg).toContain('*Como está?:* Réplica protocolada, aguardando sentença.');
    expect(msg).not.toContain('A novidade mais recente');
  });

  it('sem régua, campo vazio continua vazio — nada é inventado', () => {
    const msg = buildActivityMessage(ctx({ ...semCampos, regua: null }), 'client');
    expect(msg).not.toContain('*Como está?:*');
    expect(msg).not.toContain('já passou por');
  });
});

describe('progresso da mensagem = progresso da barra', () => {
  it('caso na fase de contestação não sai como "comecinho"', () => {
    const msg = buildActivityMessage(ctx(), 'client');
    expect(msg).not.toContain('comecinho');
    expect(msg).not.toContain('0% concluído');
  });

  it('usa o peso hierárquico (fase → objetivo → passo), não a contagem plana', () => {
    // 3 fases inteiras de 6 (50%) + FASE 4 com 2/3 do único objetivo (11,1%).
    // Contagem plana daria 16/27 = 59%.
    const msg = buildActivityMessage(ctx(), 'client');
    expect(msg).toContain('Progresso do caso: 61% concluído');
  });

  it('fase do board sem passo instanciado continua pesando no denominador', () => {
    const semUltimaFase = ctx({
      stepContext: {
        ...(ctx().stepContext as object),
        allSteps: allSteps.filter(s => s.phaseId !== 'stage_pos_decisao'),
      },
    } as Partial<ActivityMessageContext>);
    // As 6 fases seguem no denominador: o percentual não sobe por sumir passo.
    expect(buildActivityMessage(semUltimaFase, 'client')).toContain('61% concluído');
  });

  it('anuncia a etapa, o objetivo e o passo do estado atual do POP', () => {
    const msg = buildActivityMessage(ctx(), 'client');
    expect(msg).toContain('*Etapa:* FASE 4 — Defesa em Caso de Contestação');
    expect(msg).toContain('*Objetivo:* Contestação e réplica');
    expect(msg).toContain('*Passo atual:* Análise de Proposta de Acordo (se houver)');
    expect(msg).not.toContain('Análise do Indeferimento Administrativo');
  });
});
