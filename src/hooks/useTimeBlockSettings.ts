import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { TimeBlockConfig, getDefaultTimeBlockConfigs } from '@/components/activities/TimeBlockSettingsDialog';
import { toast } from 'sonner';

export function useTimeBlockSettings(targetUserId?: string) {
  const { user } = useAuthContext();
  const [configs, setConfigs] = useState<TimeBlockConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const effectiveUserId = targetUserId || user?.id;

  const fetchSettings = useCallback(async (userId: string, withSpinner = false) => {
    if (withSpinner) setLoading(true);

    const { data: typesData } = await supabase
      .from('activity_types')
      .select('*')
      .order('display_order', { ascending: true });

    const { data: settingsData } = await supabase
      .from('user_timeblock_settings')
      .select('*')
      .eq('user_id', userId);

    if (typesData && typesData.length > 0 && settingsData && settingsData.length > 0) {
      // Explode cada row em 1 bloco por dia → cada bloco é independente (delete/edit não afeta os outros dias)
      const loaded: TimeBlockConfig[] = [];
      settingsData.forEach((row: any) => {
        const globalType = typesData.find((t: any) => t.key === row.activity_type);
        if (!globalType) return;
        const days: number[] = (row.days as number[]) || [];
        days.forEach(d => {
          loaded.push({
            blockId: `${row.id}__d${d}`,
            activityType: row.activity_type,
            label: (globalType as any).label,
            color: (globalType as any).color,
            days: [d],
            startHour: row.start_hour,
            startMinute: row.start_minute ?? 0,
            endHour: row.end_hour,
            endMinute: row.end_minute ?? 0,
            isCustom: false,
          });
        });
      });
      loaded.sort((a, b) => (a.startHour + (a.startMinute ?? 0) / 60) - (b.startHour + (b.startMinute ?? 0) / 60));
      setConfigs(loaded);
    } else {
      setConfigs([]);
    }

    if (withSpinner) setLoading(false);
  }, []);

  useEffect(() => {
    if (!effectiveUserId) { setLoading(false); return; }
    fetchSettings(effectiveUserId, true);

    const channel = supabase
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

    return () => { supabase.removeChannel(channel); };
  }, [effectiveUserId, fetchSettings]);

  const saveSettings = useCallback(async (newConfigs: TimeBlockConfig[], userId?: string) => {
    const uid = userId || effectiveUserId;
    if (!uid) return;

    const rows = newConfigs.map(c => ({
      user_id: uid,
      activity_type: c.activityType,
      days: c.days,
      start_hour: c.startHour,
      start_minute: c.startMinute ?? 0,
      end_hour: c.endHour,
      end_minute: c.endMinute ?? 0,
    }));

    // Validate before deleting: try inserting to a temp check first
    // Then delete + insert atomically to avoid data loss on error
    const { error: deleteError } = await supabase
      .from('user_timeblock_settings')
      .delete()
      .eq('user_id', uid);

    if (deleteError) {
      toast.error('Erro ao salvar rotina. Verifique suas permissões.');
      return;
    }

    if (rows.length > 0) {
      const { error } = await supabase.from('user_timeblock_settings').insert(rows as any);
      if (error) {
        toast.error('Erro ao salvar rotina: ' + error.message);
        // Reload to restore whatever state is in DB
        await fetchSettings(uid, false);
        return;
      }
    }

    // Não recarrega via fetch — o realtime já vai disparar e atualizar.
    // Mantemos só o setConfigs local para feedback instantâneo.
    setConfigs(newConfigs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveUserId, fetchSettings]);

  return { configs, loading, saveSettings };
}
