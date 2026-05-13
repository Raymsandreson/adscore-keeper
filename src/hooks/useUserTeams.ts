import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';

export interface UserTeam {
  id: string;
  name: string;
  color: string;
}

/**
 * Returns the Cloud teams a given user belongs to.
 * If no userId is provided, falls back to the authenticated user.
 */
export function useUserTeams(targetUserId?: string) {
  const { user } = useAuthContext();
  const [teams, setTeams] = useState<UserTeam[]>([]);
  const [loading, setLoading] = useState(true);

  const effectiveUserId = targetUserId || user?.id;

  const refetch = useCallback(async () => {
    if (!effectiveUserId) { setTeams([]); setLoading(false); return; }
    setLoading(true);
    const { data: memberships } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', effectiveUserId);
    const teamIds = (memberships || []).map((m: any) => m.team_id);
    if (teamIds.length === 0) { setTeams([]); setLoading(false); return; }
    const { data: teamRows } = await supabase
      .from('teams')
      .select('id, name, color')
      .in('id', teamIds);
    setTeams((teamRows || []) as UserTeam[]);
    setLoading(false);
  }, [effectiveUserId]);

  useEffect(() => { refetch(); }, [refetch]);

  return { teams, loading, refetch };
}
