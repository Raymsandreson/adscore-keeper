import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { User, Session } from '@supabase/supabase-js';
import { cacheSet, cacheGet, cacheRemove, CACHE_TTL } from '@/lib/offlineCache';

interface Profile {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
}

const AUTH_STORAGE_KEY = 'sb-gliigkupoebmlbwyvijp-auth-token';

const isInvalidAuthError = (err: unknown) => {
  const message = err instanceof Error ? err.message : String((err as any)?.message || err || '');
  const code = (err as any)?.code;

  return (
    message.includes('Refresh Token') ||
    message.includes('refresh token') ||
    message.includes('bad_jwt') ||
    message.includes('JWT') ||
    message.includes('missing sub claim') ||
    code === 'refresh_token_not_found' ||
    code === 'bad_jwt'
  );
};

const clearLocalAuthState = async () => {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // ignore local signout failures
  }

  localStorage.removeItem(AUTH_STORAGE_KEY);
  cacheRemove('auth_session');
  cacheRemove('auth_profile');
};

// Sync user to external DB - sends user data from session
async function syncUserToExternal(user: User): Promise<Profile | null> {
  try {
    const CLOUD_URL = 'https://gliigkupoebmlbwyvijp.supabase.co';
    const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsaWlna3Vwb2VibWxid3l2aWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMDAxNDcsImV4cCI6MjA4MTU3NjE0N30.HnhqYYFjW9DjFUsUkrZDuCShCOU2P73o_DqvkVyVr38';
    const res = await fetch(`${CLOUD_URL}/functions/v1/sync-user-to-external`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,
        'apikey': ANON_KEY,
      },
      body: JSON.stringify({
        user_id: user.id,
        email: user.email,
        full_name: user.user_metadata?.full_name || '',
      }),
    });
    if (res.ok) {
      const data = await res.json();
      console.log('[AUTH] ✅ User synced to external DB:', data.profile?.full_name);
      return data.profile;
    } else {
      console.warn('[AUTH] ⚠️ Sync failed:', res.status, await res.text());
    }
  } catch (err) {
    console.warn('[AUTH] ⚠️ Sync error:', err);
  }
  return null;
}

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isOfflineMode, setIsOfflineMode] = useState(false);

  const initialize = () => {
    setLoading(true);
    setConnectionError(null);
    setIsOfflineMode(false);

    let settled = false;
    const settle = (error?: string) => {
      if (!settled) {
        settled = true;
        if (error) {
          const cachedSession = cacheGet<{ user: User; session: Session }>('auth_session');
          const cachedProfile = cacheGet<Profile>('auth_profile');
          if (cachedSession?.data) {
            console.log('[AUTH] ⚡ Restaurando sessão do cache offline');
            setUser(cachedSession.data.user);
            setSession(cachedSession.data.session);
            if (cachedProfile?.data) setProfile(cachedProfile.data);
            setIsOfflineMode(true);
            setConnectionError(null);
          } else {
            setConnectionError(error);
          }
        } else {
          setConnectionError(null);
        }
        setLoading(false);
      }
    };

    const resetToLoggedOut = async () => {
      await clearLocalAuthState();
      setUser(null);
      setSession(null);
      setProfile(null);
      setIsOfflineMode(false);
    };

    const timeout = setTimeout(() => {
      settle('Tempo limite excedido ao conectar com o servidor.');
    }, 8000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if ((_event === 'TOKEN_REFRESHED' || _event === 'SIGNED_OUT') && !session) {
          console.warn('[AUTH] Sessão ausente após evento de auth, limpando estado local...');
          await resetToLoggedOut();
          settle();
          return;
        }

        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          cacheSet('auth_session', { user: session.user, session }, CACHE_TTL.SESSION);

          setTimeout(async () => {
            const syncedProfile = await syncUserToExternal(session.user);
            if (syncedProfile) {
              setProfile(syncedProfile);
              cacheSet('auth_profile', syncedProfile, CACHE_TTL.PROFILE);
            } else {
              const cached = cacheGet<Profile>('auth_profile');
              if (cached?.data) setProfile(cached.data);
            }
          }, 0);
        } else {
          setProfile(null);
        }
        setIsOfflineMode(false);
        settle();
      }
    );

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        cacheSet('auth_session', { user: session.user, session }, CACHE_TTL.SESSION);

        const syncedProfile = await syncUserToExternal(session.user);
        if (syncedProfile) {
          setProfile(syncedProfile);
          cacheSet('auth_profile', syncedProfile, CACHE_TTL.PROFILE);
        } else {
          const cached = cacheGet<Profile>('auth_profile');
          if (cached?.data) setProfile(cached.data);
        }
      }
      settle();
    }).catch(async (err) => {
      if (isInvalidAuthError(err)) {
        console.warn('[AUTH] Token inválido detectado, limpando sessão local...');
        await resetToLoggedOut();
        settle();
      } else {
        settle(`Erro ao obter sessão: ${(err as any)?.message || 'desconhecido'}`);
      }
    });

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  };

  useEffect(() => {
    const cleanup = initialize();
    return cleanup;
  }, []);

  const signUp = async (email: string, password: string, fullName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: fullName },
      },
    });
    return { data, error };
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    return { data, error };
  };

  const signOut = async () => {
    // Clear local state FIRST to prevent race conditions with onAuthStateChange
    setUser(null);
    setSession(null);
    setProfile(null);
    setIsOfflineMode(false);
    setConnectionError(null);
    await clearLocalAuthState();

    try {
      await supabase.auth.signOut();
    } catch {
      // Network errors during signout are fine - local state already cleared
    }
    return { error: null };
  };

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!user) return { error: new Error('No user logged in') };

    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('user_id', user.id)
      .select()
      .single();

    if (data) {
      setProfile(data);
      cacheSet('auth_profile', data, CACHE_TTL.PROFILE);
    }
    return { data, error };
  };

  const retry = () => {
    setIsOfflineMode(false);
    initialize();
  };

  return {
    user, session, profile, loading, connectionError, isOfflineMode,
    signUp, signIn, signOut, updateProfile, retry,
    isAuthenticated: !!user,
  };
};
