import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ProfileItem {
  id: string;
  full_name: string | null;
  email: string | null;
}

export function useProfilesList() {
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);

  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, full_name, email')
      .order('full_name')
      .then(({ data }) => {
        if (data) setProfiles(data);
      });
  }, []);

  return profiles;
}
