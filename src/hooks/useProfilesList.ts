import { supabase } from '@/integrations/supabase/client';
import { useSharedFetch } from '@/lib/sharedFetch';

export interface ProfileItem {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
}

const EMPTY: ProfileItem[] = [];

/**
 * Lista de perfis do escritório. Compartilhada entre instâncias
 * (src/lib/sharedFetch.ts) — são 23 componentes consumidores, e alguns
 * montam em lista, o que multiplicava a mesma requisição.
 */
export function useProfilesList(): ProfileItem[] {
  const { data } = useSharedFetch<ProfileItem[]>(
    'profiles_list',
    async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, user_id, full_name, email')
        .order('full_name');
      if (error) throw error;
      return (data as ProfileItem[]) || EMPTY;
    },
    EMPTY,
  );
  return data;
}
