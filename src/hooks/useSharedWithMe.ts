import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';

export interface SharedConversation {
  id: string;
  phone: string;
  instance_name: string;
  shared_by: string;
  shared_with: string;
  identify_sender: boolean;
  can_reshare: boolean;
  created_at: string;
  acknowledged_at?: string | null;
}

export function useSharedWithMe() {
  const { user } = useAuthContext();
  const [items, setItems] = useState<SharedConversation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('whatsapp_conversation_shares')
      .select('*')
      .eq('shared_with', user.id)
      .order('created_at', { ascending: false });
    setItems((data || []) as any as SharedConversation[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Realtime: refresh when new shares arrive for me
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`shares-with-me-${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'whatsapp_conversation_shares',
        filter: `shared_with=eq.${user.id}`,
      }, () => { load(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, load]);

  return { items, loading, reload: load };
}
