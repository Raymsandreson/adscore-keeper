import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { useAuthContext } from '@/contexts/AuthContext';
import { toast } from 'sonner';

/**
 * Bloqueia usuários desativados (org_user_status.active = false no Externo):
 * ao abrir o app já logado, é deslogado na hora.
 */
export function UserStatusGuard() {
  const { user } = useAuthContext();

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        await ensureExternalSession();
        const { data } = await (externalSupabase.from('org_user_status') as any)
          .select('active')
          .eq('user_id', user.id)
          .maybeSingle();
        if (!cancelled && data && data.active === false) {
          toast.error('Seu acesso foi desativado. Fale com o administrador.');
          await supabase.auth.signOut();
          window.location.assign('/auth');
        }
      } catch (e) {
        console.error('[UserStatusGuard] Failed to check status:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  return null;
}
