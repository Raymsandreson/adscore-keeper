import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { TimeBlockConfig, getDefaultTimeBlockConfigs } from '@/components/activities/TimeBlockSettingsDialog';

export function useTimeBlockSettings(targetUserId?: string) {
  const { user } = useAuthContext();
  const [configs, setConfigs] = useState<TimeBlockConfig[]>(getDefaultTimeBlockConfigs());
  const [loading, setLoading] = useState(true);

  // Use targetUserId if provided (admin editing another user), otherwise use own user id
  const effectiveUserId = targetUserId || user?.id;

  const fetchSettings = useCallback(async () => {
    if (!effectiveUserId) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('user_timeblock_settings')
      .select('*')
      .eq('user_id', effectiveUserId);

    if (!error && data && data.length > 0) {
      const loaded: TimeBlockConfig[] = data.map(row => ({
        activityType: row.activity_type,
        label: row.label,
        color: row.color,
        days: (row.days as number[]) || [],
        startHour: row.start_hour,
        endHour: row.end_hour,
      }));
      setConfigs(loaded);
    } else {
      setConfigs(getDefaultTimeBlockConfigs());
    }
    setLoading(false);
  }, [effectiveUserId]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const saveSettings = useCallback(async (newConfigs: TimeBlockConfig[]) => {
    if (!effectiveUserId) return;
    setConfigs(newConfigs);

    const upsertRows = newConfigs.map(c => ({
      user_id: effectiveUserId,
      activity_type: c.activityType,
      label: c.label,
      color: c.color,
      days: c.days,
      start_hour: c.startHour,
      end_hour: c.endHour,
    }));

    await supabase
      .from('user_timeblock_settings')
      .upsert(upsertRows, { onConflict: 'user_id,activity_type' });
  }, [effectiveUserId]);

  return { configs, loading, saveSettings };
}
