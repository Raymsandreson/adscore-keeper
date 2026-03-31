import { useState, useEffect } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';

type AppRole = 'admin' | 'member';

interface UserRole {
  role: AppRole;
  isAdmin: boolean;
  isMember: boolean;
  loading: boolean;
}

const CLOUD_URL = 'https://gliigkupoebmlbwyvijp.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsaWlna3Vwb2VibWxid3l2aWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMDAxNDcsImV4cCI6MjA4MTU3NjE0N30.HnhqYYFjW9DjFUsUkrZDuCShCOU2P73o_DqvkVyVr38';

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
        // Fetch role from external DB via edge function
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
          setRole((data?.role as AppRole) || 'member');
        } else {
          console.error('Error fetching user role via sync:', res.status);
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
