import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';

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
        const { data, error } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) throw error;
        setRole((data?.role as AppRole) || 'member');
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
