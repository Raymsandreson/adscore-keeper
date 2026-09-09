/**
 * A decisão de sessão no Externo (obterSessaoExterna), sem rede.
 *  1. sessão de verdade já gravada → não mexe;
 *  2. sessão anônima + login no Cloud → pede ao Railway e TROCA;
 *  3. login no Cloud mas Railway fora → mantém a anônima que existia;
 *  4. página pública (sem Cloud) e sem sessão → anônima nova (até desligar);
 *  5. Railway devolveu mas o Externo recusou o setSession → não conta como trocada.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../client', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({}) } } }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), setSession: async () => ({ error: null }), signInAnonymously: async () => ({ error: null }), signOut: async () => ({}) } }),
}));

import { obterSessaoExterna, type SessaoExternaDeps } from '../external-client';

const base = (over: Partial<SessaoExternaDeps>): SessaoExternaDeps => ({
  sessaoAtual: async () => null,
  tokenDoCloud: async () => null,
  pedirAoRailway: async () => null,
  aplicar: async () => true,
  entrarAnonimo: async () => true,
  ...over,
});

describe('obterSessaoExterna', () => {
  it('sessão de verdade já gravada: não mexe', async () => {
    const railway = vi.fn();
    const r = await obterSessaoExterna(base({ sessaoAtual: async () => ({ anonima: false }), tokenDoCloud: async () => 'jwt', pedirAoRailway: railway }));
    expect(r).toBe('real');
    expect(railway).not.toHaveBeenCalled();
  });

  it('anônima + login no Cloud: pede ao Railway e troca', async () => {
    const aplicar = vi.fn(async () => true);
    const r = await obterSessaoExterna(base({
      sessaoAtual: async () => ({ anonima: true }),
      tokenDoCloud: async () => 'jwt-cloud',
      pedirAoRailway: async (t) => (t === 'jwt-cloud' ? { access_token: 'a', refresh_token: 'r' } : null),
      aplicar,
    }));
    expect(r).toBe('trocada_pelo_railway');
    expect(aplicar).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' });
  });

  it('Railway fora: mantém a anônima que existia, sem criar outra', async () => {
    const anon = vi.fn(async () => true);
    const r = await obterSessaoExterna(base({
      sessaoAtual: async () => ({ anonima: true }),
      tokenDoCloud: async () => 'jwt',
      pedirAoRailway: async () => { throw new Error('502'); },
      entrarAnonimo: anon,
    }));
    expect(r).toBe('anonima_mantida');
    expect(anon).not.toHaveBeenCalled();
  });

  it('página pública sem sessão: anônima nova (enquanto o sign-in anônimo existir)', async () => {
    const railway = vi.fn();
    const r = await obterSessaoExterna(base({ pedirAoRailway: railway }));
    expect(r).toBe('anonima_nova');
    expect(railway).not.toHaveBeenCalled();
  });

  it('Externo recusou o setSession: não conta como trocada', async () => {
    const r = await obterSessaoExterna(base({
      sessaoAtual: async () => ({ anonima: true }),
      tokenDoCloud: async () => 'jwt',
      pedirAoRailway: async () => ({ access_token: 'a', refresh_token: 'r' }),
      aplicar: async () => false,
    }));
    expect(r).toBe('anonima_mantida');
  });
});
