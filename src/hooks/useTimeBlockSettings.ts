import { useState, useEffect, useCallback, useRef } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { useAuthContext } from '@/contexts/AuthContext';
import { TimeBlockConfig } from '@/components/activities/TimeBlockSettingsDialog';
import { toast } from 'sonner';

/**
 * Rotinas semanais por colaborador.
 * Persistência: Supabase EXTERNO (db). Cada bloco visual = 1 linha (days = [um único dia]).
 * Save = upsert por id; delete = delete por id. Sem delete-all+insert-all (sem flicker).
 */

type Row = {
  id: string;
  user_id: string;
  activity_type: string;
  days: number[];
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
};

const newId = () => (crypto as any).randomUUID?.() || `b_${Date.now()}_${Math.random().toString(36).slice(2)}`;

export function useTimeBlockSettings(targetUserId?: string) {
  const { user } = useAuthContext();
  const [configs, setConfigs] = useState<TimeBlockConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const lastSavedRef = useRef<Map<string, TimeBlockConfig>>(new Map());

  const effectiveUserId = targetUserId || user?.id;

  const fetchSettings = useCallback(async (userId: string, withSpinner = false) => {
    if (withSpinner) setLoading(true);

    const [typesRes, rowsRes] = await Promise.all([
      (db as any).from('activity_types').select('*').order('display_order', { ascending: true }),
      (db as any).from('user_timeblock_settings').select('*').eq('user_id', userId),
    ]);

    const typesData = typesRes.data || [];
    const rowsData: Row[] = rowsRes.data || [];

    if (!typesData.length || !rowsData.length) {
      setConfigs([]);
      lastSavedRef.current = new Map();
      if (withSpinner) setLoading(false);
      return;
    }

    // Auto-migração lazy: rows com days.length > 1 viram N rows single-day.
    // Faz uma única vez, em background, sem travar a UI.
    const multi = rowsData.filter(r => (r.days?.length ?? 0) > 1);
    if (multi.length > 0) {
      const newRows: any[] = [];
      const oldIds: string[] = [];
      multi.forEach(r => {
        oldIds.push(r.id);
        r.days.forEach(d => {
          newRows.push({
            id: newId(),
            user_id: r.user_id,
            activity_type: r.activity_type,
            days: [d],
            start_hour: r.start_hour,
            start_minute: r.start_minute ?? 0,
            end_hour: r.end_hour,
            end_minute: r.end_minute ?? 0,
          });
        });
      });
      // Aplica split no DB
      try {
        await (db as any).from('user_timeblock_settings').insert(newRows);
        await (db as any).from('user_timeblock_settings').delete().in('id', oldIds);
        // Re-fetch após split
        const re = await (db as any).from('user_timeblock_settings').select('*').eq('user_id', userId);
        rowsData.length = 0;
        (re.data || []).forEach((r: Row) => rowsData.push(r));
      } catch (e) {
        console.warn('[useTimeBlockSettings] split failed', e);
      }
    }

    const loaded: TimeBlockConfig[] = [];
    const snapshot = new Map<string, TimeBlockConfig>();
    rowsData.forEach(row => {
      const t = typesData.find((x: any) => x.key === row.activity_type);
      if (!t) return;
      const day = (row.days || [0])[0];
      const cfg: TimeBlockConfig = {
        blockId: row.id,
        activityType: row.activity_type,
        label: (t as any).label,
        color: (t as any).color,
        days: [day],
        startHour: row.start_hour,
        startMinute: row.start_minute ?? 0,
        endHour: row.end_hour,
        endMinute: row.end_minute ?? 0,
        isCustom: false,
      };
      loaded.push(cfg);
      snapshot.set(row.id, cfg);
    });
    loaded.sort((a, b) => (a.startHour + (a.startMinute ?? 0) / 60) - (b.startHour + (b.startMinute ?? 0) / 60));
    setConfigs(loaded);
    lastSavedRef.current = snapshot;

    if (withSpinner) setLoading(false);
  }, []);

  useEffect(() => {
    if (!effectiveUserId) { setLoading(false); return; }
    let cancelled = false;
    let channel: any = null;

    (async () => {
      try { await ensureExternalSession(); } catch {}
      if (cancelled) return;
      await fetchSettings(effectiveUserId, true);
      if (cancelled) return;

      channel = (db as any)
        .channel(`tb-settings-${effectiveUserId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'user_timeblock_settings',
            filter: `user_id=eq.${effectiveUserId}`,
          },
          () => { fetchSettings(effectiveUserId, false); }
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) (db as any).removeChannel(channel);
    };
  }, [effectiveUserId, fetchSettings]);

  /**
   * Save inteligente: faz DIFF entre o estado novo e o último salvo.
   * - Inserts: blocos novos
   * - Updates: blocos com mesmo id mas campos diferentes (upsert)
   * - Deletes: ids que sumiram
   * Não toca em quem não mudou → realtime devolve só os eventos relevantes.
   */
  const saveSettings = useCallback(async (newConfigs: TimeBlockConfig[], userId?: string) => {
    const uid = userId || effectiveUserId;
    if (!uid) return;

    const prev = lastSavedRef.current;
    const nextIds = new Set(newConfigs.map(c => c.blockId));
    const toDelete: string[] = [];
    prev.forEach((_, id) => { if (!nextIds.has(id)) toDelete.push(id); });

    const toUpsert: any[] = [];
    newConfigs.forEach(c => {
      const old = prev.get(c.blockId);
      const day = c.days[0] ?? 0;
      const changed = !old
        || old.startHour !== c.startHour
        || (old.startMinute ?? 0) !== (c.startMinute ?? 0)
        || old.endHour !== c.endHour
        || (old.endMinute ?? 0) !== (c.endMinute ?? 0)
        || old.activityType !== c.activityType
        || (old.days[0] ?? 0) !== day;
      if (changed) {
        toUpsert.push({
          id: c.blockId,
          user_id: uid,
          activity_type: c.activityType,
          days: [day],
          start_hour: c.startHour,
          start_minute: c.startMinute ?? 0,
          end_hour: c.endHour,
          end_minute: c.endMinute ?? 0,
        });
      }
    });

    try {
      if (toDelete.length) {
        const { error } = await (db as any).from('user_timeblock_settings').delete().in('id', toDelete);
        if (error) throw error;
      }
      if (toUpsert.length) {
        const { error } = await (db as any).from('user_timeblock_settings').upsert(toUpsert);
        if (error) throw error;
      }
      // Atualiza snapshot
      const snap = new Map<string, TimeBlockConfig>();
      newConfigs.forEach(c => snap.set(c.blockId, c));
      lastSavedRef.current = snap;
      setConfigs(newConfigs);
    } catch (e: any) {
      toast.error('Erro ao salvar rotina: ' + (e?.message || 'erro desconhecido'));
      await fetchSettings(uid, false);
    }
  }, [effectiveUserId, fetchSettings]);

  return { configs, loading, saveSettings };
}
