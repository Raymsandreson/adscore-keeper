import { describe, it, expect } from 'vitest';
import { buildActivityMessage, extractPartyFirstName, type ActivityMessageContext } from '../buildActivityMessage';

/**
 * Saudação ao cliente: PRIMEIRO NOME de CADA parte do polo que representamos,
 * e nenhuma hora na frase de retorno.
 *
 * Dados reais do processo 0100419-74.2021.5.01.0281 (lead_processes, leitura de
 * 14/09/2026): 7 autores, 2 rés e o perito repetido em dois papéis. A mensagem
 * saía "*Boa tarde Sr(a). Changrillayne Biazini*" — os outros 6 autores leem a
 * mesma mensagem no grupo — e "*...no dia 24/09/2026 quinta-feira, às 09:00.*".
 */
const ENVOLVIDOS = [
  { nome: 'Changrillayne Biazini', polo: 'ATIVO', tipo: 'AUTOR', tipo_normalizado: 'Autor', tipo_pessoa: 'FISICA' },
  { nome: 'Deolinda Moraes Ribeiro', polo: 'ATIVO', tipo: 'AUTOR', tipo_normalizado: 'Autor', tipo_pessoa: 'FISICA' },
  { nome: 'Edson Ribeiro', polo: 'ATIVO', tipo: 'AUTOR', tipo_normalizado: 'Autor', tipo_pessoa: 'FISICA' },
  { nome: 'Elisangela Moraes Ribeiro', polo: 'ATIVO', tipo: 'AUTOR', tipo_normalizado: 'Autor', tipo_pessoa: 'FISICA' },
  { nome: 'Maria Ribeiro Fernandes', polo: 'ATIVO', tipo: 'AUTOR', tipo_normalizado: 'Autor', tipo_pessoa: 'FISICA' },
  { nome: 'Wandrey da Silva Moraes', polo: 'ATIVO', tipo: 'AUTOR', tipo_normalizado: 'Autor', tipo_pessoa: 'FISICA' },
  { nome: 'Wendey Fernandes Moraes Ribeiro', polo: 'ATIVO', tipo: 'AUTOR', tipo_normalizado: 'Autor', tipo_pessoa: 'FISICA' },
  { nome: 'Dra. Fulana Advogada', polo: 'ATIVO', tipo: 'Advogado', tipo_normalizado: 'Advogado', tipo_pessoa: 'FISICA' },
  { nome: 'Ampla Energia e Servicos S.A', polo: 'PASSIVO', tipo: 'Réu', tipo_normalizado: 'Réu', tipo_pessoa: 'JURIDICA', cnpj: '33.050.071/0001-58' },
  { nome: 'Engelmig Eletrica Ltda', polo: 'PASSIVO', tipo: 'Réu', tipo_normalizado: 'Réu', tipo_pessoa: 'JURIDICA', cnpj: '21.066.139/0001-08' },
  { nome: 'Alexandre Pacheco Terra', polo: 'DESCONHECIDO', tipo: 'Perito', tipo_normalizado: 'Perito', tipo_pessoa: 'FISICA' },
  { nome: 'Alexandre Pacheco Terra', polo: 'DESCONHECIDO', tipo: 'OUTROS PARTICIPANTES', tipo_normalizado: 'Outro', tipo_pessoa: 'FISICA' },
];

const PROCESSO = {
  id: 'proc-1',
  process_number: '0100419-74.2021.5.01.0281',
  title: 'Ação Trabalhista - Rito Ordinário',
  envolvidos: ENVOLVIDOS,
  cliente_polo: null,
  polo_ativo: 'Edson Ribeiro e outros',
  polo_passivo: 'Ampla Energia e Servicos S.A e outros',
};

function ctx(over: Partial<ActivityMessageContext> = {}): ActivityMessageContext {
  return {
    formTitle: 'Acidente de trabalho',
    formDeadline: '', formNotificationDate: '2026-09-24', formNotificationTime: '09:00',
    formWhatWasDone: '', formCurrentStatus: 'Aguardando admissibilidade do RR',
    formNextSteps: '', formSolicitacao: '', formRespostaJuizo: '', formNotes: '',
    formAssignedToName: '', formCoAssignees: [], formIsSystem: false,
    formClientNameOverride: '', formLeadName: 'LEAD DO GRUPO', formCaseTitle: 'CASO 1',
    formProcessId: 'proc-1', formProcessTitle: '',
    fieldSettings: [{ field_key: 'current_status', label: 'Como está?', include_in_message: true }],
    selectedActivity: null,
    caseProcesses: [PROCESSO],
    stepContext: null,
    leadPreview: null, systemOabs: new Set<string>(),
    currentUserId: 'user-1', currentUserName: 'Raymsandreson de Morais Prudêncio',
    resolveUserName: () => 'Raymsandreson de Morais Prudêncio',
    getTemplateForContext: () => undefined,
    ...over,
  } as ActivityMessageContext;
}

describe('saudação com as partes do polo do cliente', () => {
  it('cumprimenta o primeiro nome de TODAS as partes do nosso polo, na ordem do processo', () => {
    const msg = buildActivityMessage(ctx(), 'client');
    expect(msg).toContain(
      'Sr(a). Changrillayne, Deolinda, Edson, Elisangela, Maria, Wandrey e Wendey',
    );
    // Sobrenome não entra (era o que saía antes: "Changrillayne Biazini")
    expect(msg).not.toContain('Changrillayne Biazini');
    // Advogado da nossa parte e partes do polo adversário ficam de fora
    expect(msg).not.toContain('Fulana');
    expect(msg).not.toContain('Ampla');
  });

  it('não repete parte que a API devolve em mais de um papel', () => {
    const msg = buildActivityMessage(
      ctx({
        caseProcesses: [{
          ...PROCESSO,
          cliente_polo: 'DESCONHECIDO',
          envolvidos: ENVOLVIDOS,
        }],
      }),
      'client',
    );
    expect(msg).toContain('Sr(a). Alexandre');
    expect(msg).not.toContain('Alexandre e Alexandre');
  });

  it('polo do cliente PASSIVO: pessoa jurídica entra com a razão social inteira', () => {
    const msg = buildActivityMessage(
      ctx({ caseProcesses: [{ ...PROCESSO, cliente_polo: 'PASSIVO' }] }),
      'client',
    );
    expect(msg).toContain('Sr(a). Ampla Energia e Servicos S.A e Engelmig Eletrica Ltda');
  });

  it('sem partes estruturadas, cai no título do polo como antes', () => {
    const msg = buildActivityMessage(
      ctx({ caseProcesses: [{ ...PROCESSO, envolvidos: [] }] }),
      'client',
    );
    // "Outros" com maiúscula é o title-case pré-existente de
    // extractClientFirstName — comportamento de antes desta mudança, mantido de
    // propósito: sem as partes estruturadas não dá pra listar primeiros nomes.
    expect(msg).toContain('Sr(a). Edson Ribeiro e Outros');
  });

  it('nome digitado à mão no formulário continua vencendo as partes', () => {
    const msg = buildActivityMessage(ctx({ formClientNameOverride: 'Seu Zé' }), 'client');
    expect(msg).toContain('Sr(a). Seu Zé');
    expect(msg).not.toContain('Changrillayne');
  });
});

describe('frase de retorno sem horário', () => {
  it('não promete hora mesmo com hora marcada na atividade', () => {
    const msg = buildActivityMessage(ctx(), 'client');
    expect(msg).toContain('Retornaremos com mais informações no dia 24/09/2026 quinta-feira, até o final do dia.');
    expect(msg).not.toContain('09:00');
    expect(msg).not.toContain('às 0');
  });

  it('template salvo que emenda "até o final do dia" em {{data_retorno}} não duplica hora', () => {
    const msg = buildActivityMessage(
      ctx({
        formAssignedToName: 'Jose Francisco',
        getTemplateForContext: () => "*{{saudacao}} Sr(a). {{lead_name}}*\n\n{{campos_dinamicos}}\n\n{{responsavel_dr ? '*' + responsavel_dr + ' voltará com mais informações no dia ' + data_retorno + ', até o final do dia.*' : ''}}",
      }),
      'client',
    );
    expect(msg).toContain('Dr. Jose Francisco voltará com mais informações no dia 24/09/2026 quinta-feira, até o final do dia.');
    expect(msg).not.toContain('09:00');
  });

  it('mensagem ao ASSESSOR mantém a hora na linha de notificação (uso interno)', () => {
    const msg = buildActivityMessage(ctx(), 'assessor');
    expect(msg).toContain('*Notificação:* 24/09/2026 quinta-feira, às 09:00');
  });
});

describe('extractPartyFirstName', () => {
  it('corta no primeiro nome', () => {
    expect(extractPartyFirstName('Wandrey da Silva Moraes')).toBe('Wandrey');
    expect(extractPartyFirstName('Maria Ribeiro Fernandes')).toBe('Maria');
  });
  it('rótulo sujo continua passando pela limpeza antes do corte', () => {
    expect(extractPartyFirstName('PREV291 Evelyn Souza')).toBe('Evelyn');
  });
  it('vazio continua vazio', () => {
    expect(extractPartyFirstName('')).toBe('');
    expect(extractPartyFirstName('  -- ')).toBe('');
  });
});
