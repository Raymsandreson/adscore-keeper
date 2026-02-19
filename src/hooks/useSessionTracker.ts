import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';

const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes without interaction = end session
const HEARTBEAT_INTERVAL = 2 * 60 * 1000; // 2 minutes - check if still active

export function useSessionTracker() {
  const { user } = useAuthContext();
  const sessionIdRef = useRef<string | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const lastHeartbeatActivityRef = useRef<number>(Date.now()); // tracks last real interaction sent to DB
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasRecentActivityRef = useRef<boolean>(false); // true if user interacted since last heartbeat

  // Start a new session
  const startSession = useCallback(async () => {
    if (!user) return;

    try {
      // End any existing active session first
      if (sessionIdRef.current) {
        await endSession('new_session');
      }

      const { data, error } = await supabase
        .from('user_sessions')
        .insert({
          user_id: user.id,
          started_at: new Date().toISOString(),
          last_activity_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (error) {
        console.error('Error starting session:', error);
        return;
      }

      sessionIdRef.current = data.id;
      lastActivityRef.current = Date.now();
      console.log('[Session] Started:', data.id);
    } catch (error) {
      console.error('Error starting session:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]); // use user.id to avoid recreating on object reference changes

  // End current session
  const endSession = useCallback(async (reason: string = 'logout') => {
    if (!sessionIdRef.current) return;

    try {
      const now = new Date();
      const sessionId = sessionIdRef.current;
      
      // Get session start time to calculate duration
      const { data: session } = await supabase
        .from('user_sessions')
        .select('started_at, last_activity_at')
        .eq('id', sessionId)
        .single();

      if (session) {
        const startedAt = new Date(session.started_at);
        // Use last_activity_at for duration so idle time isn't counted
        const lastActive = session.last_activity_at ? new Date(session.last_activity_at) : now;
        const durationSeconds = Math.round((lastActive.getTime() - startedAt.getTime()) / 1000);

        await supabase
          .from('user_sessions')
          .update({
            ended_at: now.toISOString(),
            duration_seconds: durationSeconds,
            end_reason: reason,
          })
          .eq('id', sessionId);

        console.log('[Session] Ended:', sessionId, reason, `${durationSeconds}s`);
      }

      sessionIdRef.current = null;
    } catch (error) {
      console.error('Error ending session:', error);
    }
  }, []); // no deps - uses ref which is always current

  // Update last activity timestamp
  const updateActivity = useCallback(async () => {
    if (!sessionIdRef.current || !user) return;

    lastActivityRef.current = Date.now();
    hasRecentActivityRef.current = true;

    try {
      await supabase
        .from('user_sessions')
        .update({
          last_activity_at: new Date().toISOString(),
        })
        .eq('id', sessionIdRef.current);
    } catch (error) {
      console.error('Error updating activity:', error);
    }

    // Reset inactivity timer
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    inactivityTimerRef.current = setTimeout(() => {
      endSession('inactivity');
    }, INACTIVITY_TIMEOUT);
  }, [user, endSession]);

  // Log page navigation
  const logPageVisit = useCallback(async (pagePath: string) => {
    if (!user) return;

    try {
      await supabase
        .from('user_activity_log')
        .insert({
          user_id: user.id,
          action_type: 'page_visit',
          entity_type: 'page',
          metadata: { path: pagePath, timestamp: new Date().toISOString() },
        });
    } catch (error) {
      console.error('Error logging page visit:', error);
    }

    updateActivity();
  }, [user, updateActivity]);

  // Setup event listeners for activity detection
  useEffect(() => {
    if (!user) return;

    const handleActivity = () => {
      hasRecentActivityRef.current = true;
      lastActivityRef.current = Date.now();

      // Reset inactivity timer on real interaction
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
      inactivityTimerRef.current = setTimeout(() => {
        endSession('inactivity');
      }, INACTIVITY_TIMEOUT);
    };

    // Track user interactions
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach(event => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    // Start session on mount
    startSession();

    // Heartbeat: only update DB if user had real activity since last heartbeat
    heartbeatTimerRef.current = setInterval(() => {
      if (sessionIdRef.current && hasRecentActivityRef.current) {
        hasRecentActivityRef.current = false;
        supabase
          .from('user_sessions')
          .update({ last_activity_at: new Date().toISOString() })
          .eq('id', sessionIdRef.current)
          .then(() => {});
      }
    }, HEARTBEAT_INTERVAL);

    // Handle page visibility change (tab switch, minimize) - no state reset, just mark active
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        handleActivity();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Handle before unload (closing tab/browser)
    const handleBeforeUnload = () => {
      if (sessionIdRef.current) {
        const payload = JSON.stringify({
          session_id: sessionIdRef.current,
          end_reason: 'tab_close',
        });
        navigator.sendBeacon(
          `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/end_session_beacon`,
          payload
        );
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Set initial inactivity timer
    inactivityTimerRef.current = setTimeout(() => {
      endSession('inactivity');
    }, INACTIVITY_TIMEOUT);

    return () => {
      events.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
      }

      // End session on cleanup
      endSession('logout');
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]); // only re-run when user ID changes, not on every render

  return {
    sessionId: sessionIdRef.current,
    logPageVisit,
    updateActivity,
    endSession,
  };
}
