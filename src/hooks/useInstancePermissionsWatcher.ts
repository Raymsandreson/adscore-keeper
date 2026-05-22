import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function useInstancePermissionsWatcher(userId: string | null | undefined) {
  const reloadingRef = useRef(false);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`user-perms:${userId}`)
      .on('broadcast', { event: 'instances-updated' }, () => {
        if (reloadingRef.current) return;
        reloadingRef.current = true;
        toast.info('Suas permissões foram atualizadas. Recarregando…', { duration: 1500 });
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);
}
