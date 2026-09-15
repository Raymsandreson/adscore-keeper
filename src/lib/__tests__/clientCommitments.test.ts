import { describe, it, expect } from 'vitest';
import {
  buildReminderText,
  commitmentChargeDate,
  isCommitmentDueToCharge,
  isCommitmentOpen,
  isCommitmentOverdue,
  isCommitmentDismissed,
  isSameCommitmentTitle,
  type ClientCommitment,
} from '@/lib/clientCommitments';

const base: Pick<ClientCommitment, 'status' | 'due_date'> = {
  status: 'combinado',
  due_date: null,
};

describe('isCommitmentOpen', () => {
  it('combinado e cobrado contam como em aberto', () => {
    expect(isCommitmentOpen('combinado')).toBe(true);
    expect(isCommitmentOpen('cobrado')).toBe(true);
  });

  it('feito, desistiu e descartada saem da lista de aberto', () => {
    expect(isCommitmentOpen('feito')).toBe(false);
    expect(isCommitmentOpen('desistiu')).toBe(false);
    expect(isCommitmentOpen('descartada')).toBe(false);
  });
});

describe('isCommitmentDismissed', () => {
  it('só "descartada" é erro da IA — o resto é pendência de verdade', () => {
    expect(isCommitmentDismissed('descartada')).toBe(true);
    expect(isCommitmentDismissed('feito')).toBe(false);
    expect(isCommitmentDismissed('desistiu')).toBe(false);
    expect(isCommitmentDismissed('combinado')).toBe(false);
  });
});

describe('isCommitmentOverdue', () => {
  it('sem prazo nunca vence — a maioria das promessas do WhatsApp não tem data', () => {
    expect(isCommitmentOverdue(base, '2026-08-06')).toBe(false);
  });

  it('prazo anterior a hoje vence', () => {
    expect(isCommitmentOverdue({ ...base, due_date: '2026-08-05' }, '2026-08-06')).toBe(true);
  });

  it('prazo hoje ainda não venceu', () => {
    expect(isCommitmentOverdue({ ...base, due_date: '2026-08-06' }, '2026-08-06')).toBe(false);
  });

  it('pendência já resolvida ou descartada não aparece como vencida', () => {
    expect(isCommitmentOverdue({ status: 'feito', due_date: '2020-01-01' }, '2026-08-06')).toBe(false);
    expect(isCommitmentOverdue({ status: 'desistiu', due_date: '2020-01-01' }, '2026-08-06')).toBe(false);
    expect(isCommitmentOverdue({ status: 'descartada', due_date: '2020-01-01' }, '2026-08-06')).toBe(false);
  });
});

describe('buildReminderText', () => {
  it('usa só o primeiro nome do cliente', () => {
    const txt = buildReminderText({ kind: 'avaliação', title: 'Avaliar o escritório no Google' }, 'BRUNO JOSÉ DE ATAÍDE SANTOS');
    expect(txt.startsWith('Oi, BRUNO!')).toBe(true);
  });

  it('sem nome do cliente, não deixa saudação quebrada', () => {
    const txt = buildReminderText({ kind: 'depoimento', title: 'Gravar o vídeo' }, '   ');
    expect(txt.startsWith('Oi! ')).toBe(true);
    expect(txt).not.toContain('undefined');
  });

  it('casa pela palavra-chave do título quando o kind da IA é genérico', () => {
    const txt = buildReminderText({ kind: 'outro', title: 'Gravar o vídeo de depoimento' }, 'Maria');
    expect(txt).toContain('vídeo de depoimento');
  });

  it('cobrança de documento cita o que foi pedido', () => {
    const txt = buildReminderText({ kind: 'documento', title: 'Mandar a carteira de trabalho' }, 'Maria');
    expect(txt).toContain('Mandar a carteira de trabalho');
  });

  it('rótulo que a IA inventou e não casa com nada cai no texto genérico', () => {
    const txt = buildReminderText({ kind: 'providência qualquer', title: 'Confirmar o endereço novo' }, 'João Silva');
    expect(txt).toContain('Confirmar o endereço novo');
    expect(txt.startsWith('Oi, João!')).toBe(true);
  });

  it('kind vazio não quebra', () => {
    const txt = buildReminderText({ kind: '', title: 'Falar com o vizinho testemunha' }, 'Ana');
    expect(txt.length).toBeGreaterThan(20);
    expect(txt).toContain('Falar com o vizinho testemunha');
  });
});

describe('isSameCommitmentTitle', () => {
  it('mesma promessa com verbo trocado conta como repetida (caso real de produção)', () => {
    expect(isSameCommitmentTitle(
      'Fazer a visita do caso do Morumbi',
      'Realizar a visita do caso do Morumbi'
    )).toBe(true);
    expect(isSameCommitmentTitle(
      'Fazer ligação de vídeo durante a visita',
      'Fazer uma ligação de vídeo durante a visita'
    )).toBe(true);
  });

  it('acento e caixa não separam a mesma pendência', () => {
    expect(isSameCommitmentTitle('Enviar o LAUDO médico', 'enviar o laudo medico')).toBe(true);
  });

  it('pendências diferentes no mesmo tema continuam separadas', () => {
    expect(isSameCommitmentTitle(
      'Fazer a visita do caso do Morumbi',
      'Fazer a visita do caso de Itatiba'
    )).toBe(false);
    expect(isSameCommitmentTitle(
      'Mandar a carteira de trabalho',
      'Mandar o comprovante de residência'
    )).toBe(false);
  });

  it('título só de palavras vazias não casa com nada — melhor duplicar que fundir errado', () => {
    expect(isSameCommitmentTitle('fazer', 'realizar')).toBe(false);
  });

  it('título vazio nunca casa', () => {
    expect(isSameCommitmentTitle('', 'Gravar o vídeo')).toBe(false);
  });
});

describe('commitmentChargeDate', () => {
  const semPrazo = { due_date: null, promised_at: '2026-09-11T15:12:27.470Z' };

  it('com prazo, cobra no próprio dia do prazo — é retorno, não "cadê?"', () => {
    expect(commitmentChargeDate({ due_date: '2026-09-08', promised_at: '2026-09-04T18:39:10Z' }))
      .toBe('2026-09-08');
  });

  it('sem prazo, cobra no dia seguinte ao da promessa', () => {
    expect(commitmentChargeDate(semPrazo)).toBe('2026-09-12');
  });

  it('vira o mês sem escorregar', () => {
    expect(commitmentChargeDate({ due_date: null, promised_at: '2026-08-31T20:47:54Z' }))
      .toBe('2026-09-01');
  });

  it('promessa de madrugada não antecipa a cobrança um dia', () => {
    expect(commitmentChargeDate({ due_date: null, promised_at: '2026-09-11T00:30:00Z' }))
      .toBe('2026-09-12');
  });

  it('sem prazo e sem promessa válida não inventa data', () => {
    expect(commitmentChargeDate({ due_date: null, promised_at: '' })).toBeNull();
    expect(commitmentChargeDate({ due_date: null, promised_at: 'ontem' })).toBeNull();
  });
});

describe('isCommitmentDueToCharge', () => {
  const aberta = { status: 'combinado' as const, due_date: '2026-09-11', promised_at: '2026-09-04T18:00:00Z' };

  it('no dia do prazo já pode cobrar', () => {
    expect(isCommitmentDueToCharge(aberta, '2026-09-11')).toBe(true);
  });

  it('antes do prazo não cobra — atropelar o cliente estraga a confiança', () => {
    expect(isCommitmentDueToCharge(aberta, '2026-09-10')).toBe(false);
  });

  it('prazo vencido continua cobrável', () => {
    expect(isCommitmentDueToCharge(aberta, '2026-09-15')).toBe(true);
  });

  it('pendência já concluída nunca é cobrada', () => {
    expect(isCommitmentDueToCharge({ ...aberta, status: 'feito' }, '2026-09-15')).toBe(false);
  });

  it('"cobrado" continua em aberto e pode voltar a ser cobrada', () => {
    expect(isCommitmentDueToCharge({ ...aberta, status: 'cobrado' }, '2026-09-15')).toBe(true);
  });

  it('sem prazo, só a partir do dia seguinte à promessa', () => {
    const semPrazo = { status: 'combinado' as const, due_date: null, promised_at: '2026-09-11T15:12:00Z' };
    expect(isCommitmentDueToCharge(semPrazo, '2026-09-11')).toBe(false);
    expect(isCommitmentDueToCharge(semPrazo, '2026-09-12')).toBe(true);
  });
});
