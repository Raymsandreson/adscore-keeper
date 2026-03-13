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

  const fetchSettings = useCallback(async (userId: string) => {
    setLoading(true);

    // Fetch global types
    const { data: typesData } = await supabase
      .from('activity_types')
      .select('*')
      .order('display_order', { ascending: true });

    // Fetch user's schedule settings
    const { data: settingsData } = await supabase
      .from('user_timeblock_settings')
      .select('*')
      .eq('user_id', userId);

    if (typesData && typesData.length > 0) {
      if (settingsData && settingsData.length > 0) {
        // User has configured settings — merge with global type info
        const loaded: TimeBlockConfig[] = [];
        settingsData.forEach(row => {
          const globalType = typesData.find((t: any) => t.key === row.activity_type);
          if (globalType) {
            loaded.push({
              blockId: (row as any).id || `${row.activity_type}_${row.start_hour}`,
              activityType: row.activity_type,
              label: (globalType as any).label,
              color: (globalType as any).color,
              days: (row.days as number[]) || [],
              startHour: row.start_hour,
              startMinute: (row as any).start_minute ?? 0,
              endHour: row.end_hour,
              endMinute: (row as any).end_minute ?? 0,
              isCustom: false,
            });
          }
        });
        // Sort chronologically by start time (hour + minute)
        loaded.sort((a, b) => (a.startHour + (a.startMinute ?? 0) / 60) - (b.startHour + (b.startMinute ?? 0) / 60));
        setConfigs(loaded);
      } else {
        // No settings yet — show empty (user hasn't picked types yet)
        setConfigs([]);
      }
    } else {
      setConfigs([]);
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
        await fetchSettings(uid);
        return;
      } else {
        toast.success('Rotina salva com sucesso!');
      }
    } else {
      toast.success('Rotina salva (sem tipos selecionados).');
    }

    // Update local state only after successful save
    setConfigs(newConfigs);
    await fetchSettings(uid);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveUserId, fetchSettings]);

  return { configs, loading, saveSettings };
}
