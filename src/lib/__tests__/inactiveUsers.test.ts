import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const eq = vi.fn();
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));

vi.mock('@/integrations/supabase', () => ({
  db: { from },
  ensureExternalSession: vi.fn(async () => {}),
}));

const { filterAssignableMembers, setInactiveUserIds, ASSIGNEE_BLOCKLIST } =
  await import('../assigneeBlocklist');
const { fetchInactiveUserIds, invalidateInactiveUserIds } = await import('../inactiveUsers');

const BLOQUEADO = Array.from(ASSIGNEE_BLOCKLIST)[0];

beforeEach(() => {
  from.mockClear();
  select.mockClear();
  eq.mockClear();
  invalidateInactiveUserIds();
  setInactiveUserIds(new Set());
});

afterEach(() => {
  setInactiveUserIds(new Set());
});

describe('filterAssignableMembers', () => {
  it('descarta quem está na lista fixa e quem foi desativado na aba Times', () => {
    setInactiveUserIds(new Set(['desativado']));
    const membros = [{ user_id: 'ativo' }, { user_id: 'desativado' }, { user_id: BLOQUEADO }];
    expect(filterAssignableMembers(membros)).toEqual([{ user_id: 'ativo' }]);
  });
});

describe('fetchInactiveUserIds', () => {
  it('publica os desativados para o filtro e busca uma vez só', async () => {
    eq.mockResolvedValue({ data: [{ user_id: 'saiu' }], error: null });

    const [a, b] = await Promise.all([fetchInactiveUserIds(), fetchInactiveUserIds()]);

    expect(a).toEqual(new Set(['saiu']));
    expect(b).toBe(a);
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('org_user_status');
    expect(eq).toHaveBeenCalledWith('active', false);
    expect(filterAssignableMembers([{ user_id: 'saiu' }, { user_id: 'ficou' }]))
      .toEqual([{ user_id: 'ficou' }]);

    // Cache: a segunda rodada não bate no banco de novo.
    await fetchInactiveUserIds();
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('não cacheia falha — a próxima chamada tenta de novo', async () => {
    eq.mockResolvedValueOnce({ data: null, error: new Error('rls') });
    await expect(fetchInactiveUserIds()).rejects.toThrow('rls');

    eq.mockResolvedValueOnce({ data: [{ user_id: 'saiu' }], error: null });
    expect(await fetchInactiveUserIds()).toEqual(new Set(['saiu']));
    expect(from).toHaveBeenCalledTimes(2);
  });
});
