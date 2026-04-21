import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

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
  const notifiedInstances = useRef<Set<string>>(new Set());

  const sendWhatsAppAlert = useCallback(async (message: string) => {
    try {
      const { data: raymInst } = await supabase
        .from('whatsapp_instances')
        .select('id, instance_name, instance_token, owner_phone')
        .ilike('instance_name', '%raym%')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (!raymInst?.id || !raymInst?.owner_phone) return;

      await cloudFunctions.invoke('send-whatsapp', {
        body: {
          phone: raymInst.owner_phone,
          message,
          instance_id: raymInst.id,
        },
      });
    } catch (err) {
      console.error('Error sending WhatsApp alert:', err);
    }
  }, []);

  const notifyOfflineViaWhatsApp = useCallback(async (offlineInstances: InstanceStatus[]) => {
    const newOffline = offlineInstances.filter(i => !notifiedInstances.current.has(i.id));
    if (newOffline.length === 0) return;

    try {
      const { data: raymInst } = await supabase
        .from('whatsapp_instances')
        .select('id, instance_name, instance_token, owner_phone')
        .ilike('instance_name', '%raym%')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (!raymInst?.id) return;

      const offlineIds = newOffline.map(i => i.id);
      const { data: offlineInsts } = await supabase
        .from('whatsapp_instances')
        .select('id, instance_name, owner_phone')
        .in('id', offlineIds);

      if (!offlineInsts) return;

      const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const message = `⚠️ *Alerta de Desconexão* ⚠️\n\nAs seguintes instâncias estão *offline* desde ${now}:\n\n${newOffline.map(i => `❌ ${i.instance_name}`).join('\n')}\n\nAcesse o sistema para reconectar via QR Code.\n🔗 https://adscore-keeper.lovable.app/whatsapp`;

      const phonesNotified = new Set<string>();
      for (const inst of offlineInsts) {
        if (inst.owner_phone && !phonesNotified.has(inst.owner_phone)) {
          phonesNotified.add(inst.owner_phone);
          await cloudFunctions.invoke('send-whatsapp', {
            body: {
              phone: inst.owner_phone,
              message,
              instance_id: raymInst.id,
            },
          });
        }
      }

      for (const inst of newOffline) {
        notifiedInstances.current.add(inst.id);
      }
    } catch (err) {
      console.error('Error notifying offline instances:', err);
    }
  }, []);

  const notifyReconnectedViaWhatsApp = useCallback(async (reconnectedInstances: InstanceStatus[]) => {
    if (reconnectedInstances.length === 0) return;
    const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const message = `✅ *Instâncias Reconectadas* ✅\n\nAs seguintes instâncias voltaram a ficar *online* às ${now}:\n\n${reconnectedInstances.map(i => `🟢 ${i.instance_name}`).join('\n')}\n\nTudo funcionando normalmente! 🚀`;
    await sendWhatsAppAlert(message);
  }, [sendWhatsAppAlert]);

  const checkStatus = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const { data, error } = await cloudFunctions.invoke('check-whatsapp-status');
      if (error) throw error;
      const now = new Date();
      const reconnected: InstanceStatus[] = [];
      const enriched: InstanceStatus[] = (data || []).map((s: any) => {
        if (!s.connected) {
          if (!disconnectedTimestamps.current[s.id]) {
            disconnectedTimestamps.current[s.id] = now;
          }
          return { ...s, disconnected_since: disconnectedTimestamps.current[s.id] };
        } else {
          // Detect reconnection: was disconnected and notified, now connected
          if (notifiedInstances.current.has(s.id)) {
            reconnected.push(s);
            notifiedInstances.current.delete(s.id);
          }
          delete disconnectedTimestamps.current[s.id];
          return { ...s, disconnected_since: null };
        }
      });
      setStatuses(enriched);
      setLastChecked(now);

      // Auto-notify offline instances via WhatsApp
      const offline = enriched.filter(s => !s.connected);
      if (offline.length > 0) {
        notifyOfflineViaWhatsApp(offline);
      }

      // Notify reconnected instances
      if (reconnected.length > 0) {
        notifyReconnectedViaWhatsApp(reconnected);
        // Auto-process queued group creations when instances come back online
        cloudFunctions.invoke('process-group-queue').catch(err => 
          console.warn('Auto-process queue failed:', err)
        );
      }
    } catch (err) {
      console.error('Error checking WhatsApp status:', err);
    } finally {
      setLoading(false);
    }
  }, [enabled, notifyOfflineViaWhatsApp, notifyReconnectedViaWhatsApp]);

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
