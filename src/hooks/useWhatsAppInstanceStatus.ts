import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface InstanceStatus {
  id: string;
  instance_name: string;
  connected: boolean;
  status_raw: string | null;
  disconnected_since?: Date | null;
}

export function useWhatsAppInstanceStatus(enabled: boolean = true) {
  const [statuses, setStatuses] = useState<InstanceStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const disconnectedTimestamps = useRef<Record<string, Date>>({});

  const checkStatus = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('check-whatsapp-status');
      if (error) throw error;
      const now = new Date();
      const enriched: InstanceStatus[] = (data || []).map((s: any) => {
        if (!s.connected) {
          // Track first time we saw it disconnected
          if (!disconnectedTimestamps.current[s.id]) {
            disconnectedTimestamps.current[s.id] = now;
          }
          return { ...s, disconnected_since: disconnectedTimestamps.current[s.id] };
        } else {
          // Clear timestamp when reconnected
          delete disconnectedTimestamps.current[s.id];
          return { ...s, disconnected_since: null };
        }
      });
      setStatuses(enriched);
      setLastChecked(now);
    } catch (err) {
      console.error('Error checking WhatsApp status:', err);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (enabled) {
      checkStatus();
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
