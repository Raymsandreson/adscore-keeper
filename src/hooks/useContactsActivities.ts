/**
 * Atividades em aberto de VÁRIOS contatos numa consulta só.
 *
 * Irmã de `useContactsPendencies`, mas do outro lado do balcão: pendência é o
 * que o CLIENTE ficou de fazer; atividade (`lead_activities`) é tarefa NOSSA.
 * Numa lista de contatos as duas perguntas aparecem juntas — "temos algo em
 * aberto com essa pessoa?" — e antes as duas exigiam abrir a ficha.
 *
 * Aberta = qualquer status que não seja `concluida`. Atrasada = prazo já
 * passou, mesma régua da página de Atividades (`useLeadActivities`, filtro
 * `overdue`): `deadline < início de hoje`.
 */
import { useEffect, useMemo, useState } from 'react';
import { db } from '@/integrations/supabase';

export interface ActivitySummary {
  /** Não concluídas. */
  open: number;
  /** Subconjunto do aberto com prazo vencido. */
  overdue: number;
}

export const EMPTY_ACTIVITY_SUMMARY: ActivitySummary = { open: 0, overdue: 0 };

export function useContactsActivities(contactIds: string[]) {
  const [byContact, setByContact] = useState<Record<string, ActivitySummary>>({});
  const [loading, setLoading] = useState(false);

  // O array chega recriado a cada render da lista; sem a chave estável a
  // consulta se refaria em laço.
  const key = useMemo(
    () => Array.from(new Set(contactIds.filter(Boolean))).sort().join(','),
    [contactIds]
  );

  useEffect(() => {
    if (!key) {
      setByContact({});
      return;
    }
    const ids = key.split(',');
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const { data, error } = await (db as any)
          .from('lead_activities')
          .select('contact_id, status, deadline')
          .in('contact_id', ids)
          .neq('status', 'concluida');
        if (error) throw error;
        if (cancelled) return;

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const acc: Record<string, ActivitySummary> = {};
        for (const row of ((data || []) as { contact_id: string | null; deadline: string | null }[])) {
          if (!row.contact_id) continue;
          const cur = acc[row.contact_id] || { open: 0, overdue: 0 };
          cur.open += 1;
          if (row.deadline && new Date(row.deadline) < todayStart) cur.overdue += 1;
          acc[row.contact_id] = cur;
        }
        setByContact(acc);
      } catch {
        console.warn('[useContactsActivities] falha ao contar atividades');
        if (!cancelled) setByContact({});
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [key]);

  return { byContact, loading };
}
