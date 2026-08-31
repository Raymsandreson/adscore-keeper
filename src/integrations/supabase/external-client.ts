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

let anonSignInPromise: Promise<void> | null = null;

export function ensureExternalSession(): Promise<void> {
  if (anonSignInPromise) return anonSignInPromise;
  anonSignInPromise = (async () => {
    const { data } = await externalSupabase.auth.getSession();
    if (data.session) return;
    const { error } = await externalSupabase.auth.signInAnonymously();
    if (error) {
      console.warn('[externalSupabase] signInAnonymously failed:', error.message);
      anonSignInPromise = null;
      throw error;
    }
  })();
  return anonSignInPromise;
}
