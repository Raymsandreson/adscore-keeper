import { describe, it, expect } from 'vitest';
import { buildActivityMessage, type ActivityMessageContext } from '../buildActivityMessage';

/**
 * Quem assina a mensagem é quem está MANDANDO, não quem criou a atividade.
 *
 * A atividade troca de mão a cada "concluir e próximo": em 60 dias (medição de
 * 14/09/2026) 3.094 das 14.953 atividades tinham sido editadas por alguém
 * diferente de quem criou — 20,7% — e todas essas mensagens saíam assinadas
 * pelo criador original.
 */
const MEMBROS: Record<string, string> = {
  'user-criador': 'Ana Criadora',
  'user-atual': 'Bruno Remetente',
};

function ctx(over: Partial<ActivityMessageContext> = {}): ActivityMessageContext {
  return {
    formTitle: 'Andamento do pedido',
    formDeadline: '', formNotificationDate: '', formNotificationTime: '',
    formWhatWasDone: 'Enviamos os documentos', formCurrentStatus: 'Aguardando o INSS',
    formNextSteps: 'Acompanhar', formSolicitacao: '', formRespostaJuizo: '', formNotes: '',
    formAssignedToName: 'Jose Francisco', formCoAssignees: [], formIsSystem: false,
    formClientNameOverride: '', formLeadName: 'PREV 1630 - EVELYN', formCaseTitle: 'CASO 1',
    formProcessId: '', formProcessTitle: '',
    fieldSettings: [], caseProcesses: [], stepContext: null,
    selectedActivity: {
      id: 'atv-1', created_by: 'user-criador', updated_by: 'user-atual',
      created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-10T15:00:00Z',
    },
    leadPreview: null, systemOabs: new Set<string>(),
    currentUserId: 'user-atual', currentUserName: 'Bruno Remetente',
    resolveUserName: (id) => (id ? MEMBROS[id] || null : null),
    getTemplateForContext: () => undefined,
    ...over,
  } as ActivityMessageContext;
}

describe('assinatura da mensagem da atividade', () => {
  it('mensagem do cliente assina com quem está mandando, não com quem criou', () => {
    const msg = buildActivityMessage(ctx(), 'client');
    expect(msg).toContain('Com carinho,\nBruno Remetente 💚');
    expect(msg).not.toContain('Ana Criadora');
  });

  it('mensagem ao assessor idem — e sem a linha "Atividade criada por"', () => {
    const msg = buildActivityMessage(ctx(), 'assessor');
    expect(msg).toContain('Com carinho,\nBruno Remetente 💚');
    expect(msg).not.toContain('Atividade criada por');
    expect(msg).not.toContain('Última atualização por');
    expect(msg).not.toContain('Ana Criadora');
  });

  it('template salvo recebe {{enviado_por}} com o remetente e {{criado_por}} com o criador', () => {
    const msg = buildActivityMessage(
      ctx({ getTemplateForContext: () => 'Oi {{lead_name}}\n\nenviou: {{enviado_por}} / criou: {{criado_por}}' }),
      'client',
    );
    expect(msg).toContain('enviou: Bruno Remetente / criou: Ana Criadora');
  });

  it('cai no nome do perfil logado quando a lista de membros não resolve o id', () => {
    const msg = buildActivityMessage(
      ctx({ currentUserId: 'user-fora-da-lista', resolveUserName: (id) => (id ? MEMBROS[id] || null : null) }),
      'client',
    );
    expect(msg).toContain('Com carinho,\nBruno Remetente 💚');
  });

  it('sem saber quem manda, não assina com o nome errado — não assina', () => {
    const msg = buildActivityMessage(
      ctx({ currentUserId: null, currentUserName: null }),
      'client',
    );
    expect(msg).not.toContain('Com carinho');
    expect(msg).not.toContain('Ana Criadora');
  });

  it('atividade nova (ainda sem registro) assina com quem está criando', () => {
    const msg = buildActivityMessage(ctx({ selectedActivity: null }), 'client');
    expect(msg).toContain('Com carinho,\nBruno Remetente 💚');
  });
});
