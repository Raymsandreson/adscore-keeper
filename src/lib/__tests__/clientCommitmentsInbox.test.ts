import { describe, it, expect } from 'vitest';
import {
  bucketOf, commitmentDate, groupByBucket, countByDay,
  type InboxCommitment,
} from '@/lib/clientCommitmentsInbox';

const HOJE = '2026-08-10';

function item(over: Partial<InboxCommitment>): InboxCommitment {
  return {
    id: Math.random().toString(36).slice(2),
    lead_id: null, process_id: null, contact_id: null, phone: '5511999',
    instance_name: 'tst', title: 'x', kind: 'outro', status: 'combinado',
    due_date: null, promised_at: `${HOJE}T10:00:00Z`,
    source_message_id: null, source_message_text: null, notes: null,
    last_reminded_at: null, reminder_count: 0, done_at: null, done_by_name: null,
    created_by_name: null, created_at: `${HOJE}T10:00:00Z`,
    origin: 'ia', ai_confidence: 0.9,
    owner_user_id: null, lead_name: null,
    ...over,
  } as InboxCommitment;
}

describe('commitmentDate', () => {
  it('usa o prazo quando existe', () => {
    expect(commitmentDate({ due_date: '2026-08-12', promised_at: '2026-08-01T10:00:00Z' })).toBe('2026-08-12');
  });

  it('sem prazo, cai no dia em que foi combinada — senão a lista por data ficaria vazia', () => {
    expect(commitmentDate({ due_date: null, promised_at: '2026-08-01T10:00:00Z' })).toBe('2026-08-01');
  });
});

describe('bucketOf', () => {
  it('prazo passado é vencida', () => {
    expect(bucketOf({ due_date: '2026-08-09', promised_at: '', status: 'combinado' }, HOJE)).toBe('vencidas');
  });

  it('hoje, amanhã e a semana têm grupos próprios', () => {
    expect(bucketOf({ due_date: HOJE, promised_at: '', status: 'combinado' }, HOJE)).toBe('hoje');
    expect(bucketOf({ due_date: '2026-08-11', promised_at: '', status: 'combinado' }, HOJE)).toBe('amanha');
    expect(bucketOf({ due_date: '2026-08-15', promised_at: '', status: 'combinado' }, HOJE)).toBe('semana');
    expect(bucketOf({ due_date: '2026-08-17', promised_at: '', status: 'combinado' }, HOJE)).toBe('semana');
    expect(bucketOf({ due_date: '2026-08-18', promised_at: '', status: 'combinado' }, HOJE)).toBe('depois');
  });

  it('sem prazo cai pela data em que foi combinada — combinada semana passada já está vencida', () => {
    expect(bucketOf({ due_date: null, promised_at: '2026-08-03T10:00:00Z', status: 'combinado' }, HOJE)).toBe('vencidas');
  });

  it('sem prazo e sem data nenhuma vai para "sem data" em vez de sumir', () => {
    expect(bucketOf({ due_date: null, promised_at: '', status: 'combinado' }, HOJE)).toBe('sem_data');
  });
});

describe('groupByBucket', () => {
  it('resolvida e descartada não entram na caixa', () => {
    const g = groupByBucket([
      item({ status: 'feito', due_date: HOJE }),
      item({ status: 'descartada', due_date: HOJE }),
      item({ status: 'desistiu', due_date: HOJE }),
      item({ status: 'combinado', due_date: HOJE, title: 'única aberta' }),
    ], HOJE);
    expect(g).toHaveLength(1);
    expect(g[0].items).toHaveLength(1);
    expect(g[0].items[0].title).toBe('única aberta');
  });

  it('vencidas vêm antes de hoje, e cobrada continua sendo pendência', () => {
    const g = groupByBucket([
      item({ due_date: HOJE }),
      item({ due_date: '2026-08-01', status: 'cobrado' }),
    ], HOJE);
    expect(g.map((x) => x.bucket)).toEqual(['vencidas', 'hoje']);
  });

  it('dentro do grupo, a mais antiga primeiro', () => {
    const g = groupByBucket([
      item({ due_date: '2026-08-05', title: 'nova' }),
      item({ due_date: '2026-08-01', title: 'antiga' }),
    ], HOJE);
    expect(g[0].items.map((i) => i.title)).toEqual(['antiga', 'nova']);
  });

  it('lista vazia não gera grupo', () => {
    expect(groupByBucket([], HOJE)).toEqual([]);
  });
});

describe('countByDay', () => {
  it('conta só as em aberto, por dia', () => {
    const c = countByDay([
      item({ due_date: '2026-08-12' }),
      item({ due_date: '2026-08-12' }),
      item({ due_date: '2026-08-13' }),
      item({ due_date: '2026-08-13', status: 'feito' }),
    ]);
    expect(c['2026-08-12']).toBe(2);
    expect(c['2026-08-13']).toBe(1);
  });
});
