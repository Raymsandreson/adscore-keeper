import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase } from '@/integrations/supabase/external-client';

interface ProfileInfo {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

export function useProfileNames() {
  const [profiles, setProfiles] = useState<Record<string, ProfileInfo>>({});
  const [loading, setLoading] = useState(false);

  const fetchProfileNames = useCallback(async (userIds: (string | null | undefined)[]) => {
    const validIds = userIds.filter((id): id is string => !!id);
    if (validIds.length === 0) return;

    // Filter out already fetched profiles
    const newIds = validIds.filter(id => !profiles[id]);
    if (newIds.length === 0) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id, full_name, email')
        .in('user_id', newIds);

      if (error) throw error;

      const newProfiles: Record<string, ProfileInfo> = {};
      data?.forEach(profile => {
        newProfiles[profile.user_id] = profile;
      });

      // Fallback no Externo: colunas de usuário gravadas em tabelas do Externo
      // (created_by, assigned_to, ...) guardam o ext_uuid, que não existe no
      // profiles do Cloud. Sem isso, metade da equipe fica sem nome.
      const missing = newIds.filter(id => !newProfiles[id]);
      if (missing.length > 0) {
        const { data: extData } = await (externalSupabase as any)
          .from('profiles')
          .select('user_id, full_name, email')
          .in('user_id', missing);
        (extData as ProfileInfo[] | null)?.forEach(profile => {
          newProfiles[profile.user_id] = profile;
        });
      }

      setProfiles(prev => ({ ...prev, ...newProfiles }));
    } catch (error) {
      console.error('Error fetching profile names:', error);
    } finally {
      setLoading(false);
    }
  }, [profiles]);

  const getDisplayName = useCallback((userId: string | null | undefined): string | null => {
    if (!userId) return null;
    const profile = profiles[userId];
    if (!profile) return null;
    return profile.full_name || profile.email?.split('@')[0] || 'Usuário';
  }, [profiles]);

  return { profiles, loading, fetchProfileNames, getDisplayName };
}
