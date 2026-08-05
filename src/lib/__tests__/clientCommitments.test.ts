import { describe, it, expect } from 'vitest';
import {
  buildReminderText,
  isCommitmentOpen,
  isCommitmentOverdue,
  kindMeta,
  COMMITMENT_KINDS,
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

  it('feito e desistiu saem da lista de aberto', () => {
    expect(isCommitmentOpen('feito')).toBe(false);
    expect(isCommitmentOpen('desistiu')).toBe(false);
  });
});

describe('isCommitmentOverdue', () => {
  it('sem prazo nunca vence — a maioria das combinações do WhatsApp não tem data', () => {
    expect(isCommitmentOverdue(base, '2026-08-05')).toBe(false);
  });

  it('prazo anterior a hoje vence', () => {
    expect(isCommitmentOverdue({ ...base, due_date: '2026-08-04' }, '2026-08-05')).toBe(true);
  });

  it('prazo hoje ainda não venceu', () => {
    expect(isCommitmentOverdue({ ...base, due_date: '2026-08-05' }, '2026-08-05')).toBe(false);
  });

  it('pendência já resolvida não aparece como vencida', () => {
    expect(isCommitmentOverdue({ status: 'feito', due_date: '2020-01-01' }, '2026-08-05')).toBe(false);
    expect(isCommitmentOverdue({ status: 'desistiu', due_date: '2020-01-01' }, '2026-08-05')).toBe(false);
  });
});

describe('buildReminderText', () => {
  it('usa só o primeiro nome do cliente', () => {
    const txt = buildReminderText({ kind: 'avaliacao_google', title: 'Avaliar no Google' }, 'BRUNO JOSÉ DE ATAÍDE SANTOS');
    expect(txt.startsWith('Oi, BRUNO!')).toBe(true);
  });

  it('sem nome do cliente, não deixa saudação quebrada', () => {
    const txt = buildReminderText({ kind: 'depoimento', title: 'Gravar depoimento' }, '   ');
    expect(txt.startsWith('Oi! ')).toBe(true);
    expect(txt).not.toContain('undefined');
  });

  it('cobrança de documento cita o que foi pedido', () => {
    const txt = buildReminderText({ kind: 'documento', title: 'Enviar RG e comprovante' }, 'Maria');
    expect(txt).toContain('Enviar RG e comprovante');
  });

  it('tipo desconhecido cai no texto genérico em vez de quebrar', () => {
    const txt = buildReminderText({ kind: 'outro', title: 'Confirmar endereço' }, 'João Silva');
    expect(txt).toContain('Confirmar endereço');
    expect(txt.startsWith('Oi, João!')).toBe(true);
  });

  it('todo tipo cadastrado gera texto não vazio', () => {
    for (const k of COMMITMENT_KINDS) {
      expect(buildReminderText({ kind: k.value, title: 'X' }, 'Ana').length).toBeGreaterThan(20);
    }
  });
});

describe('kindMeta', () => {
  it('devolve o meta do tipo', () => {
    expect(kindMeta('depoimento').label).toBe('Vídeo de depoimento');
  });

  it('tipo fora da lista cai em "Outro" em vez de undefined', () => {
    expect(kindMeta('inexistente' as never).value).toBe('outro');
  });
});
