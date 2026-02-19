import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { TimeBlockConfig, getDefaultTimeBlockConfigs } from '@/components/activities/TimeBlockSettingsDialog';

const DEFAULT_TYPES = ['tarefa','audiencia','prazo','acompanhamento','reuniao','diligencia'];

export function useTimeBlockSettings(targetUserId?: string) {
  const { user } = useAuthContext();
  const [configs, setConfigs] = useState<TimeBlockConfig[]>(getDefaultTimeBlockConfigs());
  const [loading, setLoading] = useState(true);

  const effectiveUserId = targetUserId || user?.id;

  const fetchSettings = useCallback(async (userId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('user_timeblock_settings')
      .select('*')
      .eq('user_id', userId);

    if (!error && data && data.length > 0) {
      const loaded: TimeBlockConfig[] = data.map(row => ({
        activityType: row.activity_type,
        label: row.label,
        color: row.color,
        days: (row.days as number[]) || [],
        startHour: row.start_hour,
        endHour: row.end_hour,
        isCustom: !DEFAULT_TYPES.includes(row.activity_type),
      }));
      setConfigs(loaded);
    } else {
      setConfigs(getDefaultTimeBlockConfigs());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!effectiveUserId) { setLoading(false); return; }
    fetchSettings(effectiveUserId);
  }, [effectiveUserId, fetchSettings]);

  const saveSettings = useCallback(async (newConfigs: TimeBlockConfig[], userId?: string) => {
    const uid = userId || effectiveUserId;
    if (!uid) return;

    setConfigs(newConfigs);

    const rows = newConfigs.map(c => ({
      user_id: uid,
      activity_type: c.activityType,
      label: c.label,
      color: c.color,
      days: c.days,
      start_hour: c.startHour,
      end_hour: c.endHour,
    }));

    await supabase.from('user_timeblock_settings').delete().eq('user_id', uid);
    const { error } = await supabase.from('user_timeblock_settings').insert(rows);

    if (error) {
      console.error('Error saving timeblock settings:', error);
    }

    await fetchSettings(uid);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveUserId, fetchSettings]);

  return { configs, loading, saveSettings };
}
