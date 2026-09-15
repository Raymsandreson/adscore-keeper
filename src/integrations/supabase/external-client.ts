import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const EXTERNAL_URL = 'https://kmedldlepwiityjsdahz.supabase.co';

/**
 * URL de uma edge function do Externo. Existe para quem precisa chamar a
 * function COM O TOKEN DO CLOUD (o login de verdade) em vez da sessão anônima
 * que `db.functions.invoke` manda — caso de jm-doc-url, que assina PDF de autos.
 */
export function externalFunctionUrl(nome: string): string {
  return `${EXTERNAL_URL}/functions/v1/${nome}`;
}
const EXTERNAL_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImttZWRsZGxlcHdpaXR5anNkYWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTExOTAsImV4cCI6MjA5MDQ2NzE5MH0.s51bWtABFjJGfGyuPFWr5Tp8CzbxPD5eieFUqUVuQTs';

export const externalSupabase = createClient<Database>(EXTERNAL_URL, EXTERNAL_ANON_KEY, {
  auth: {
    storage: localStorage,
    storageKey: 'sb-external-auth',
    persistSession: true,
    autoRefreshToken: true,
  },
  realtime: {
    // Volume real: ~30+ mensagens/min entre múltiplas instâncias, com picos
    // bem acima disso. Com eventsPerSecond=10 (default), o servidor passa
    // a "throttle" eventos durante picos e o cliente vê mensagens chegando
    // com atraso ou simplesmente não chegando até o próximo poll de 30s.
    // 200 evt/s é o máximo aceito por cliente Supabase Realtime.
    params: { eventsPerSecond: 200 },
  },
});

// =============================================================================
// Sessão no Externo (10/09/2026).
//
// ANTES: `signInAnonymously()`. Qualquer pessoa com a chave anon (que vai no
// bundle) fazia o mesmo e virava `authenticated`: 6.277 anônimos contra 55
// reais; `auth.uid()` não era ninguém; as policies `is_admin(auth.uid())` do
// Externo nunca batiam.
//
// AGORA: quem está logado no Cloud pede ao Railway (`external-session`) uma
// sessão do seu usuário espelho no Externo (o de `auth_uuid_mapping`) e a
// aplica com `setSession`. O refresh_token mantém viva sozinho. Uma sessão
// anônima já gravada é TROCADA pela de verdade; sem login no Cloud (páginas
// públicas) ou com o Railway fora, cai no anônimo como antes — até o
// sign-in anônimo ser desligado no Auth do Externo.
//
// `obterSessaoExterna` é a decisão pura, com as dependências injetadas, para
// o teste cobrir os quatro caminhos sem rede.
// =============================================================================
import { supabase as cloudSupabase } from './client';

const RAILWAY_URL =
  import.meta.env.VITE_RAILWAY_URL || 'https://adscore-keeper-production.up.railway.app';

export interface SessaoEmitida { access_token: string; refresh_token: string }

export interface SessaoExternaDeps {
  /** Sessão gravada no cliente do Externo, se houver, e se é anônima. */
  sessaoAtual: () => Promise<{ anonima: boolean } | null>;
  /** JWT de quem está logado no Cloud; null em página pública. */
  tokenDoCloud: () => Promise<string | null>;
  /** Pede ao Railway a sessão do usuário espelho. Rejeita/null quando não dá. */
  pedirAoRailway: (tokenCloud: string) => Promise<SessaoEmitida | null>;
  /** Aplica a sessão no cliente do Externo. false se o Externo recusou. */
  aplicar: (s: SessaoEmitida) => Promise<boolean>;
  /** Último recurso (até o sign-in anônimo ser desligado). */
  entrarAnonimo: () => Promise<boolean>;
}

export type SessaoExternaResultado =
  | 'real'                  // já tinha sessão de verdade
  | 'trocada_pelo_railway'  // veio (ou substituiu a anônima) pela rota nova
  | 'anonima_mantida'       // Railway não deu; a anônima que já existia segue
  | 'anonima_nova';         // sem login no Cloud ou Railway fora, e sem sessão nenhuma

export async function obterSessaoExterna(d: SessaoExternaDeps): Promise<SessaoExternaResultado> {
  const atual = await d.sessaoAtual();
  if (atual && !atual.anonima) return 'real';

  const token = await d.tokenDoCloud().catch(() => null);
  if (token) {
    const emitida = await d.pedirAoRailway(token).catch((e) => {
      console.warn('[externalSupabase] external-session falhou:', e instanceof Error ? e.message : e);
      return null;
    });
    if (emitida && (await d.aplicar(emitida))) return 'trocada_pelo_railway';
  }

  if (atual) return 'anonima_mantida';
  if (await d.entrarAnonimo()) return 'anonima_nova';
  throw new Error('sem sessão no Externo');
}

const depsReais: SessaoExternaDeps = {
  sessaoAtual: async () => {
    const { data } = await externalSupabase.auth.getSession();
    if (!data.session) return null;
    return { anonima: !!data.session.user?.is_anonymous };
  },
  tokenDoCloud: async () => {
    const { data } = await cloudSupabase.auth.getSession();
    return data.session?.access_token || null;
  },
  pedirAoRailway: async (tokenCloud) => {
    const r = await fetch(`${RAILWAY_URL}/functions/external-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenCloud}` },
      body: '{}',
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success || !j.access_token || !j.refresh_token) {
      throw new Error(j?.error || `external-session ${r.status}`);
    }
    return { access_token: j.access_token, refresh_token: j.refresh_token };
  },
  aplicar: async (s) => {
    const { error } = await externalSupabase.auth.setSession(s);
    if (error) console.warn('[externalSupabase] setSession recusou:', error.message);
    return !error;
  },
  entrarAnonimo: async () => {
    const { error } = await externalSupabase.auth.signInAnonymously();
    if (error) console.warn('[externalSupabase] signInAnonymously failed:', error.message);
    return !error;
  },
};

let sessaoPromise: Promise<void> | null = null;
let tentarDeNovoEm = 0;
const RETENTATIVA_MS = 60_000;

export function ensureExternalSession(): Promise<void> {
  if (sessaoPromise) return sessaoPromise;
  sessaoPromise = (async () => {
    const resultado = await obterSessaoExterna(depsReais).catch((e) => {
      sessaoPromise = null;
      throw e;
    });
    // Ficou no anônimo: tenta de novo a rota de verdade daqui a pouco, em vez de
    // carregar a sessão fraca a sessão inteira do navegador.
    if (resultado === 'anonima_mantida' || resultado === 'anonima_nova') {
      tentarDeNovoEm = Date.now() + RETENTATIVA_MS;
      setTimeout(() => { if (Date.now() >= tentarDeNovoEm) sessaoPromise = null; }, RETENTATIVA_MS);
    }
  })();
  return sessaoPromise;
}

// Login e logout no Cloud mandam no Externo: sair de um é sair do outro; entrar
// libera a próxima chamada a pedir a sessão de verdade.
try {
  cloudSupabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      sessaoPromise = null;
      void externalSupabase.auth.signOut({ scope: 'local' }).catch(() => {});
    } else if (event === 'SIGNED_IN') {
      sessaoPromise = null;
    }
  });
} catch {
  // ambiente sem auth (testes com mock parcial): a rota continua funcionando por demanda
}
