import { useState, useEffect } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

type AppRole = 'admin' | 'member';

interface UserRole {
  role: AppRole;
  isAdmin: boolean;
  isMember: boolean;
  loading: boolean;
}

export function useUserRole(): UserRole {
  const { user } = useAuthContext();
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setRole(null);
      setLoading(false);
      return;
    }

    const fetchRole = async () => {
      try {
        // Use supabase client to invoke edge function with proper auth token
        const { data, error } = await supabase.functions.invoke('sync-user-to-external', {
          body: {
            user_id: user.id,
            email: user.email,
            full_name: user.user_metadata?.full_name || '',
          },
        });

        if (!error && data) {
          setRole((data?.role as AppRole) || 'member');
        } else {
          console.error('Error fetching user role via sync:', error);
          setRole('member');
        }
      } catch (error) {
        console.error('Error fetching user role:', error);
        setRole('member');
      } finally {
        setLoading(false);
      }
    };

    fetchRole();
  }, [user]);

  return {
    role: role || 'member',
    isAdmin: role === 'admin',
    isMember: role === 'member',
    loading,
  };
}
