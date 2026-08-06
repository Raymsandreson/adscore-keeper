import { describe, it, expect } from 'vitest';
import {
  buildReminderText,
  isCommitmentOpen,
  isCommitmentOverdue,
  isCommitmentDismissed,
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
