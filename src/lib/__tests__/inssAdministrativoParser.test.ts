import { describe, it, expect } from 'vitest';
// Módulo puro na pasta da edge, mesmo caso do emailPushParser.
import { parseEmailAdministrativo } from '../../../supabase/functions/_shared/inssAdministrativoParser';

/**
 * Recortes FIÉIS de e-mails do noreply@inss.gov.br na caixa processual@,
 * lidos do banco em 20/08/2026. São os dois formatos que respondem por 1.088
 * dos 1.118 e-mails do INSS.
 */
const REQUERIMENTO_FEITO = `[INSS] Requerimento realizado com sucesso Requerimento INSS - INSTITUTO `
  + `NACIONAL DO SEGURO SOCIAL ##### Esta é uma mensagem automática. Favor não responder esse e-mail. `
  + `##### Prezado(a) Sr(a) EFRAIM SAMUEL OLIVEIRA COSTA , Informamos que o requerimento solicitado pela `
  + `Internet (Entidade Conveniada) no dia 20/08/2026 às 16:56 foi realizado com sucesso conforme detalhes `
  + `abaixo: Protocolo : 1358796571 Serviço : BENEFÍCIO ASSISTENCIAL À PESSOA COM DEFICIÊNCIA `
  + `Data do Protocolo : 20/08/2026 16:56 Unidade responsável : COORDENAÇÃO DE GESTÃO DAS CENTRAIS DE ANÁLISE`;

describe('parseEmailAdministrativo — mudança de status', () => {
  it('exigência é PRAZO: é o único status que cobra ato do escritório', () => {
    const [m] = parseEmailAdministrativo({
      assunto: '[INSS] O status do requerimento 2082987386 foi alterado para Exigência',
      corpo: '',
      dataEmail: '2026-08-19',
    });
    expect(m.protocolo).toBe('2082987386');
    expect(m.categoria).toBe('prazo');
    expect(m.data).toBe('2026-08-19');
    expect(m.titulo).toBe('Requerimento 2082987386 — Exigência');
  });

  it('concluída é o mérito da esfera administrativa', () => {
    const [m] = parseEmailAdministrativo({
      assunto: '[INSS] O status do requerimento 812040787 foi alterado para Concluída',
      dataEmail: '2026-08-19',
    });
    expect(m.categoria).toBe('decisao_merito');
  });

  it('em análise e pendente são andamento, não notícia', () => {
    for (const status of ['Em Análise', 'Pendente', 'Cancelada']) {
      const [m] = parseEmailAdministrativo({
        assunto: `[INSS] O status do requerimento 645803149 foi alterado para ${status}`,
        dataEmail: '2026-08-19',
      });
      expect(m.categoria, status).toBe('movimentacao');
    }
  });
});

describe('parseEmailAdministrativo — requerimento protocolado', () => {
  it('acha o protocolo no CORPO, que é onde ele está nesse formato', () => {
    const [m] = parseEmailAdministrativo({
      assunto: '[INSS] Requerimento realizado com sucesso',
      corpo: REQUERIMENTO_FEITO,
      dataEmail: '2026-08-20',
    });
    expect(m.protocolo).toBe('1358796571');
    expect(m.data).toBe('2026-08-20');
    expect(m.categoria).toBe('movimentacao');
    expect(m.titulo).toContain('BENEFÍCIO ASSISTENCIAL À PESSOA COM DEFICIÊNCIA');
    expect(m.titulo).not.toContain('Data do Protocolo');
  });

  it('data do protocolo nunca passa do dia do e-mail', () => {
    const [m] = parseEmailAdministrativo({
      assunto: '[INSS] Requerimento realizado com sucesso',
      corpo: REQUERIMENTO_FEITO,
      dataEmail: '2026-08-19',
    });
    expect(m.data).toBe('2026-08-19');
  });
});

describe('parseEmailAdministrativo — o que NÃO pode entrar', () => {
  it('agendamento e convocação avulsa não viram movimentação', () => {
    expect(parseEmailAdministrativo({ assunto: '[INSS] Cancelamento de Agendamento', corpo: 'Seu agendamento foi cancelado.' })).toEqual([]);
    expect(parseEmailAdministrativo({ assunto: 'ANTECIPAÇÃO ATENDIMENTO INSS BALNEARIO CAMBORIU', corpo: '' })).toEqual([]);
    expect(parseEmailAdministrativo({ assunto: '', corpo: '' })).toEqual([]);
  });
});
