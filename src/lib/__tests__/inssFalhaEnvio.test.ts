import { describe, it, expect } from 'vitest';
import {
  classificarFalha,
  avisoDeFalhaNoEnvio,
  avisoDeVinculoSuspeito,
  explicarDestinoDaMensagem,
  avisoDeProcuracaoNaoEntregue,
} from '../../../railway-server/src/lib/inss-falha-envio';

// Os dois primeiros são o `zap_erro` literal das duas falhas registradas em
// `inss_status_history` até 04/09/2026 — não texto inventado.
const ERRO_DESCONECTADA =
  'uazapi 503: {"error":true,"message":"WhatsApp disconnected: session is not reconnectable"}';
const ERRO_GRUPO_SUMIU =
  'uazapi 500: {"error":"error sending message after 2 attempts: failed to get group members: that group does not exist"}';

describe('classificarFalha', () => {
  it('reconhece a instância desconectada', () => {
    expect(classificarFalha(ERRO_DESCONECTADA)).toBe('instancia_desconectada');
  });

  it('reconhece o grupo que não existe mais', () => {
    expect(classificarFalha(ERRO_GRUPO_SUMIU)).toBe('grupo_inexistente');
  });

  it('não confunde os dois: ambos são 5xx da UazAPI', () => {
    expect(classificarFalha(ERRO_DESCONECTADA)).not.toBe(
      classificarFalha(ERRO_GRUPO_SUMIU),
    );
  });

  it('classifica os desfechos da fila', () => {
    expect(classificarFalha('agendado sem texto')).toBe('sem_texto');
    expect(classificarFalha('parado mais de 3 dias na fila')).toBe('expirado');
  });

  it('erro vazio ou desconhecido cai em outro, sem quebrar', () => {
    expect(classificarFalha(null)).toBe('outro');
    expect(classificarFalha('')).toBe('outro');
    expect(classificarFalha('uazapi 429: rate limited')).toBe('outro');
  });
});

describe('avisoDeFalhaNoEnvio', () => {
  it('diz que o cliente não foi avisado, que é o que importa', () => {
    const t = avisoDeFalhaNoEnvio({ zapErro: ERRO_DESCONECTADA, tipo: 'protocolado' });
    expect(t).toMatch(/O CLIENTE NÃO FOI AVISADO/);
  });

  it('manda reconectar quando a instância caiu, e vincular quando o grupo sumiu', () => {
    expect(avisoDeFalhaNoEnvio({ zapErro: ERRO_DESCONECTADA })).toMatch(/[Rr]econecte a instância/);
    expect(avisoDeFalhaNoEnvio({ zapErro: ERRO_GRUPO_SUMIU })).toMatch(/vincular grupo/);
  });

  it('destaca o indeferimento, porque ali o prazo do cliente corre', () => {
    const indef = avisoDeFalhaNoEnvio({ zapErro: ERRO_DESCONECTADA, tipo: 'indeferido' });
    const prot = avisoDeFalhaNoEnvio({ zapErro: ERRO_DESCONECTADA, tipo: 'protocolado' });
    expect(indef).toMatch(/INDEFERIMENTO/);
    expect(prot).not.toMatch(/INDEFERIMENTO/);
  });

  it('carrega o motivo técnico, mas nunca sem instrução do que fazer', () => {
    const t = avisoDeFalhaNoEnvio({ zapErro: ERRO_GRUPO_SUMIU });
    expect(t).toMatch(/Motivo técnico:/);
    expect(t.split('Motivo técnico:')[0].length).toBeGreaterThan(120);
  });

  it('sem motivo técnico ainda diz o que fazer', () => {
    const t = avisoDeFalhaNoEnvio({ zapErro: null });
    expect(t).not.toMatch(/Motivo técnico:/);
    expect(t).toMatch(/avise o cliente/i);
  });

  it('não vaza dado do cliente no aviso', () => {
    const t = avisoDeFalhaNoEnvio({ zapErro: ERRO_DESCONECTADA, tipo: 'indeferido' });
    expect(t).not.toMatch(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/); // CPF
    expect(t).not.toMatch(/\d{4,}/); // número longo (benefício, processo)
  });
});

// Motivos literais de `zap_erro` em eventos com zap_status = 'suspeito'.
const CONFLITO_REAL = '"CAMILLI" não aparece em nenhum nome do lead (LIMEIRA, MATHEUS, BRASCAR)';
const CONFLITO_GRAFIA = '"DANIELLE" não aparece em nenhum nome do lead (DANIELE, BUTZEN, VIVIANE)';

describe('avisoDeVinculoSuspeito', () => {
  it('diz que o cliente não foi avisado e por quê', () => {
    const t = avisoDeVinculoSuspeito({ motivo: CONFLITO_REAL, tipo: 'exigencia' });
    expect(t).toMatch(/O CLIENTE NÃO FOI AVISADO/);
    expect(t).toMatch(/grupo de outro cliente/);
  });

  it('separa decisão de andamento: indeferido e deferido ganham destaque', () => {
    expect(avisoDeVinculoSuspeito({ tipo: 'indeferido' })).toMatch(/INDEFERIMENTO/);
    expect(avisoDeVinculoSuspeito({ tipo: 'deferido' })).toMatch(/DEFERIMENTO/);
    const andamento = avisoDeVinculoSuspeito({ tipo: 'protocolado' });
    expect(andamento).not.toMatch(/INDEFERIMENTO|DEFERIMENTO/);
  });

  it('manda conferir de quem é o requerimento, os dois desfechos', () => {
    const t = avisoDeVinculoSuspeito({ motivo: CONFLITO_GRAFIA, tipo: 'exigencia' });
    expect(t).toMatch(/Se for mesmo deste lead/);
    expect(t).toMatch(/Se não for/);
  });

  it('dá o caminho de desvincular, que é o conserto quando o lead está errado', () => {
    const t = avisoDeVinculoSuspeito({ motivo: CONFLITO_REAL, tipo: 'indeferido' });
    expect(t).toMatch(/desvincule o protocolo na tela de Protocolos/);
    // sem esta frase a pessoa conserta o sintoma e o requerimento continua preso
    expect(t).toMatch(/TODAS as próximas atualizações/);
  });

  it('lembra da grafia, que foi 2 dos 38 casos medidos', () => {
    expect(avisoDeVinculoSuspeito({ motivo: CONFLITO_GRAFIA })).toMatch(/grafia/);
  });

  it('carrega o motivo, que é o que permite decidir sem abrir o banco', () => {
    const t = avisoDeVinculoSuspeito({ motivo: CONFLITO_REAL });
    expect(t).toMatch(/CAMILLI/);
    expect(t).toMatch(/LIMEIRA/);
  });

  it('sem motivo continua acionável', () => {
    const t = avisoDeVinculoSuspeito({ motivo: null, tipo: 'indeferido' });
    expect(t).not.toMatch(/O que não bateu:/);
    expect(t).toMatch(/Confira de quem é este requerimento/);
  });

  it('não se confunde com o aviso de envio recusado', () => {
    const suspeito = avisoDeVinculoSuspeito({ motivo: CONFLITO_REAL, tipo: 'indeferido' });
    const falha = avisoDeFalhaNoEnvio({ zapErro: 'uazapi 503: disconnected', tipo: 'indeferido' });
    expect(suspeito).not.toMatch(/o WhatsApp recusou/);
    expect(falha).not.toMatch(/não bate com o nome deste lead/);
  });
});

describe('explicarDestinoDaMensagem', () => {
  // Os quatro que antes não diziam nada e somam 78 eventos no histórico.
  it.each([
    ['silencio', /NÃO VIRA MENSAGEM/],
    ['retroativo', /anterior à ativação/],
    ['repetido', /JÁ FOI AVISADO/],
    ['expirado', /tempo demais na fila/],
  ])('explica %s, que antes ficava mudo', (st, esperado) => {
    const t = explicarDestinoDaMensagem({ zapStatus: st });
    expect(t).toBeTruthy();
    expect(t).toMatch(esperado);
  });

  it('diz também quando deu certo — a atividade tem que responder "o cliente já sabe?"', () => {
    expect(explicarDestinoDaMensagem({ zapStatus: 'enviado' })).toMatch(/JÁ FOI AVISADO/);
  });

  it('agendado avisa que sai sozinha, para ninguém mandar em dobro à toa', () => {
    const t = explicarDestinoDaMensagem({ zapStatus: 'agendado' });
    expect(t).toMatch(/SAI SOZINHA/);
    expect(t).toMatch(/8h às 20h/);
  });

  it('cala nos desfechos que já se explicam na descrição', () => {
    for (const st of ['suspeito', 'so_equipe', 'pericia_escritorio', 'so_escritorio']) {
      expect(explicarDestinoDaMensagem({ zapStatus: st })).toBeNull();
    }
  });

  it('status desconhecido não inventa texto', () => {
    expect(explicarDestinoDaMensagem({ zapStatus: 'coisa_nova' })).toBeNull();
    expect(explicarDestinoDaMensagem({})).toBeNull();
  });

  it('erro reaproveita o aviso de falha, com a instrução da causa', () => {
    const t = explicarDestinoDaMensagem({
      zapStatus: 'erro',
      zapErro: 'uazapi 503: WhatsApp disconnected: session is not reconnectable',
      tipo: 'indeferido',
    });
    expect(t).toMatch(/Reconecte a instância/);
    expect(t).toMatch(/INDEFERIMENTO/);
  });

  it('sem_grupo carrega o motivo e o caminho de vincular', () => {
    const t = explicarDestinoDaMensagem({ zapStatus: 'sem_grupo', zapErro: 'lead sem grupo vinculado' });
    expect(t).toMatch(/lead sem grupo vinculado/);
    expect(t).toMatch(/vincular grupo/);
  });

  it('todo desfecho que não entrega diz explicitamente que o cliente não foi avisado', () => {
    for (const st of ['retroativo', 'expirado', 'sem_grupo', 'vinculo_retroativo']) {
      expect(explicarDestinoDaMensagem({ zapStatus: st })).toMatch(/CLIENTE NÃO FOI AVISADO|NÃO FOI AVISADO/);
    }
  });
});

describe('avisoDeProcuracaoNaoEntregue', () => {
  it('separa a mensagem agendada de qualquer outra não entrega', () => {
    expect(avisoDeProcuracaoNaoEntregue('agendado')).toMatch(/vai junto com ela/);
    expect(avisoDeProcuracaoNaoEntregue('sem_grupo')).toMatch(/não saiu \(sem_grupo\)/);
  });
});
