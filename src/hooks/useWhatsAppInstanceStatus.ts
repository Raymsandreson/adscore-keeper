import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface InstanceStatus {
  id: string;
  instance_name: string;
  connected: boolean;
  status_raw: string | null;
}

export function useWhatsAppInstanceStatus(enabled: boolean = true) {
  const [statuses, setStatuses] = useState<InstanceStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const checkStatus = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('check-whatsapp-status');
      if (error) throw error;
      setStatuses(data || []);
      setLastChecked(new Date());
    } catch (err) {
      console.error('Error checking WhatsApp status:', err);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (enabled) {
      checkStatus();
      // Re-check every 60 seconds
      const interval = setInterval(checkStatus, 60000);
      return () => clearInterval(interval);
    }
  }, [checkStatus, enabled]);

  const connectedInstances = statuses.filter(s => s.connected);
  const disconnectedInstances = statuses.filter(s => !s.connected);

  return {
    statuses,
    connectedInstances,
    disconnectedInstances,
    loading,
    lastChecked,
    refetchStatus: checkStatus,
  };
}
