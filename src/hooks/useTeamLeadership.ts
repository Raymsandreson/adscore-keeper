import { useEffect, useState } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';

export interface ManagedTeam {
  id: string | null;
  name: string;
}

export interface TeamLeadership {
  loading: boolean;
  isManager: boolean;
  isDirector: boolean;
  /** Times que o usuário gerencia (gestor). Diretoria vê todos via 'gerencial'. */
  managedTeams: ManagedTeam[];
  /** Pode disparar "mensagem pra todos" (gestor de algum time ou diretoria). */
  canBroadcast: boolean;
}

const EMPTY: TeamLeadership = {
  loading: false,
  isManager: false,
  isDirector: false,
  managedTeams: [],
  canBroadcast: false,
};

/**
 * Descobre a liderança do usuário LOGADO (Cloud UUID) no Supabase Externo:
 * - team_managers.manager_user_id → gestor de time(s)
 * - org_directors.user_id → diretoria
 * Fonte de verdade das duas tabelas é o Externo (mesma usada pelo relatório
 * diário do Railway e pelo grupo 'gerencial' do telão).
 */
export function useTeamLeadership(): TeamLeadership {
  const { user } = useAuthContext();
  const [state, setState] = useState<TeamLeadership>({ ...EMPTY, loading: true });

  useEffect(() => {
    if (!user?.id) {
      setState({ ...EMPTY, loading: false });
      return;
    }
    let cancelled = false;
    (async () => {
      setState((s) => ({ ...s, loading: true }));
      try {
        await ensureExternalSession();
        const [{ data: mgr }, { data: dir }] = await Promise.all([
          ((externalSupabase as any).from('team_managers') as any)
            .select('team_id, team_name')
            .eq('manager_user_id', user.id),
          ((externalSupabase as any).from('org_directors') as any)
            .select('user_id')
            .eq('user_id', user.id)
            .maybeSingle(),
        ]);
        if (cancelled) return;
        const managedTeams: ManagedTeam[] = (mgr || [])
          .filter((r: any) => r.team_name)
          .map((r: any) => ({ id: r.team_id ?? null, name: r.team_name as string }));
        const isManager = managedTeams.length > 0;
        const isDirector = !!dir;
        setState({
          loading: false,
          isManager,
          isDirector,
          managedTeams,
          canBroadcast: isManager || isDirector,
        });
      } catch (e) {
        console.warn('[useTeamLeadership] falha:', e);
        if (!cancelled) setState({ ...EMPTY, loading: false });
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  return state;
}
