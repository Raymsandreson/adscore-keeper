import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { User, Session } from '@supabase/supabase-js';
import { cacheSet, cacheGet, CACHE_TTL } from '@/lib/offlineCache';

interface Profile {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
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
          // Try to restore from cache before showing error
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
            console.error('[AUTH] ❌ Falha na conexão com backend:', error);
          }
        } else {
          setConnectionError(null);
          console.log('[AUTH] ✅ Conexão com backend OK');
        }
        setLoading(false);
      }
    };

    // Safety timeout: if backend is unreachable, stop loading after 8s
    const timeout = setTimeout(() => {
      settle('Tempo limite excedido ao conectar com o servidor. O servidor pode estar sobrecarregado.');
    }, 8000);

    // Set up auth state listener BEFORE getting session
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          // Cache the session
          cacheSet('auth_session', { user: session.user, session }, CACHE_TTL.SESSION);
          
          setTimeout(async () => {
            const { data } = await supabase
              .from('profiles')
              .select('*')
              .eq('user_id', session.user.id)
              .single();
            setProfile(data);
            if (data) cacheSet('auth_profile', data, CACHE_TTL.PROFILE);
          }, 0);
        } else {
          setProfile(null);
        }
        setIsOfflineMode(false);
        settle();
      }
    );

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        cacheSet('auth_session', { user: session.user, session }, CACHE_TTL.SESSION);
        
        supabase
          .from('profiles')
          .select('*')
          .eq('user_id', session.user.id)
          .single()
          .then(({ data }) => {
            setProfile(data);
            if (data) cacheSet('auth_profile', data, CACHE_TTL.PROFILE);
          });
      }
      settle();
    }).catch((err) => {
      settle(`Erro ao obter sessão: ${err?.message || 'desconhecido'}`);
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
        data: {
          full_name: fullName,
        },
      },
    });
    return { data, error };
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { data, error };
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
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
    user,
    session,
    profile,
    loading,
    connectionError,
    isOfflineMode,
    signUp,
    signIn,
    signOut,
    updateProfile,
    retry,
    isAuthenticated: !!user,
  };
};
