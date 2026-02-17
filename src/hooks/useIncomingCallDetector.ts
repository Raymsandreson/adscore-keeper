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
          // Only trigger on 'offer' (ringing) events that haven't been dismissed
          if (event.event_type === 'offer' && !dismissedCallIds.current.has(event.call_id)) {
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

  // Auto-clear when call ends (accept or terminal state)
  useEffect(() => {
    if (!activeCall) return;

    const channel = supabase
      .channel(`call_end_${activeCall.call_id}`)
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'call_events_pending',
        },
        () => {
          // Pending events cleaned up = call ended
          setActiveCall(null);
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
  }, [activeCall?.call_id]);

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
