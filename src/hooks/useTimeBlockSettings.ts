import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { TimeBlockConfig, getDefaultTimeBlockConfigs } from '@/components/activities/TimeBlockSettingsDialog';

export function useTimeBlockSettings(targetUserId?: string) {
  const { user } = useAuthContext();
  const [configs, setConfigs] = useState<TimeBlockConfig[]>(getDefaultTimeBlockConfigs());
  const [loading, setLoading] = useState(true);

  // Use targetUserId if provided (admin editing another user), otherwise use own user id
  const effectiveUserId = targetUserId || user?.id;
  const effectiveUserIdRef = useRef(effectiveUserId);
  effectiveUserIdRef.current = effectiveUserId;

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
        isCustom: !['tarefa','audiencia','prazo','acompanhamento','reuniao','diligencia'].includes(row.activity_type),
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

  const saveSettings = useCallback(async (newConfigs: TimeBlockConfig[]) => {
    const userId = effectiveUserIdRef.current;
    if (!userId) return;

    // Optimistically update UI
    setConfigs(newConfigs);

    const upsertRows = newConfigs.map(c => ({
      user_id: userId,
      activity_type: c.activityType,
      label: c.label,
      color: c.color,
      days: c.days,
      start_hour: c.startHour,
      end_hour: c.endHour,
    }));

    // First delete all existing rows for this user, then insert fresh
    const { error: deleteError } = await supabase
      .from('user_timeblock_settings')
      .delete()
      .eq('user_id', userId);

    if (deleteError) {
      console.error('Error deleting timeblock settings:', deleteError);
    }

    const { error: insertError } = await supabase
      .from('user_timeblock_settings')
      .insert(upsertRows);

    if (insertError) {
      console.error('Error inserting timeblock settings:', insertError);
      // Refetch to restore correct state
      await fetchSettings(userId);
      return;
    }

    // Refetch to confirm DB state
    await fetchSettings(userId);
  }, [fetchSettings]);

  return { configs, loading, saveSettings };
}
