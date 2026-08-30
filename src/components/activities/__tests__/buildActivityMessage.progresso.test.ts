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
