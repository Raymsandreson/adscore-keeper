import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';

export interface IncomingCallEvent {
  id: string;
  call_id: string;
  phone: string;
  contact_name: string | null;
  event_type: string;
  from_me: boolean | null;
  instance_name: string | null;
  created_at: string;
}

export function useIncomingCallDetector() {
  const { user } = useAuthContext();
  const [activeCall, setActiveCall] = useState<IncomingCallEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const dismissedCallIds = useRef<Set<string>>(new Set());
  const defaultInstanceNameRef = useRef<string | null>(null);
  const allowedInstanceNamesRef = useRef<string[] | null>(null); // null = not loaded yet

  // Fetch user's default instance OR allowed instances
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('default_instance_id')
        .eq('user_id', user.id)
        .single();

      if (profile?.default_instance_id) {
        // User has a main instance — only listen to that one
        const { data: inst } = await supabase
          .from('whatsapp_instances')
          .select('instance_name')
          .eq('id', profile.default_instance_id)
          .single();
        defaultInstanceNameRef.current = inst?.instance_name || null;
        allowedInstanceNamesRef.current = inst?.instance_name ? [inst.instance_name] : [];
      } else {
        // No main instance — load all instances the user has access to
        const { data: accessRows } = await supabase
          .from('whatsapp_instance_users')
          .select('instance_id')
          .eq('user_id', user.id);

        if (accessRows && accessRows.length > 0) {
          const ids = accessRows.map(r => r.instance_id);
          const { data: instances } = await supabase
            .from('whatsapp_instances')
            .select('instance_name')
            .in('id', ids)
            .eq('is_active', true);
          allowedInstanceNamesRef.current = (instances || []).map(i => i.instance_name);
        } else {
          allowedInstanceNamesRef.current = [];
        }
      }
    })();
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('incoming_calls_detector')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'call_events_pending',
        },
        (payload) => {
          const event = payload.new as IncomingCallEvent;
          // Block ALL events until allowed list is loaded (null = not loaded yet)
          const allowed = allowedInstanceNamesRef.current;
          if (allowed === null) return;
          // If allowed is empty array (no access), block all
          if (allowed.length === 0) return;
          // Filter: only trigger for allowed instances
          if (event.instance_name && !allowed.includes(event.instance_name)) return;
          if ((event.event_type === 'offer' || event.event_type === 'accept') && !dismissedCallIds.current.has(event.call_id)) {
            setActiveCall(event);
            setDismissed(false);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Auto-clear when call ends (pending cleanup or final call record creation)
  useEffect(() => {
    if (!activeCall) return;

    const normalizedActivePhone = activeCall.phone.replace(/\D/g, '');

    const channel = supabase
      .channel(`call_end_${activeCall.call_id}`)
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'call_events_pending',
        },
        (payload) => {
          const deletedEvent = payload.old as IncomingCallEvent;
          if (deletedEvent?.call_id === activeCall.call_id) {
            setActiveCall(null);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'call_records',
        },
        (payload) => {
          const record = payload.new as { contact_phone?: string | null; phone_used?: string | null };
          const recordPhone = (record.contact_phone || '').replace(/\D/g, '');
          const samePhone =
            !!recordPhone &&
            (recordPhone === normalizedActivePhone ||
              recordPhone.endsWith(normalizedActivePhone) ||
              normalizedActivePhone.endsWith(recordPhone));
          const sameInstance = !activeCall.instance_name || !record.phone_used || record.phone_used === activeCall.instance_name;

          if (samePhone && sameInstance) {
            setActiveCall(null);
          }
        }
      )
      .subscribe();

    // Auto-dismiss after 2 minutes if not interacted
    const timeout = setTimeout(() => {
      setActiveCall(null);
    }, 120000);

    return () => {
      supabase.removeChannel(channel);
      clearTimeout(timeout);
    };
  }, [activeCall]);

  const dismiss = useCallback(() => {
    if (activeCall) {
      dismissedCallIds.current.add(activeCall.call_id);
    }
    setDismissed(true);
    setActiveCall(null);
  }, [activeCall]);

  return {
    activeCall: dismissed ? null : activeCall,
    dismiss,
  };
}
