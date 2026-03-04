import { useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';

export type ActivityType = 
  | 'comment_reply'
  | 'dm_sent'
  | 'dm_copied'
  | 'lead_created'
  | 'lead_moved'
  | 'lead_updated'
  | 'contact_created'
  | 'contact_updated'
  | 'contact_classified'
  | 'follow_requested'
  | 'workflow_session_start'
  | 'workflow_session_end'
  | 'page_visit'
  | 'login'
  | 'logout'
  | 'button_click'
  | 'form_submit'
  | 'filter_applied'
  | 'export_data'
  | 'search_performed'
  | 'checklist_item_checked'
  | 'checklist_item_unchecked';

export type EntityType = 'comment' | 'lead' | 'contact' | 'dm' | 'workflow';

interface LogActivityParams {
  actionType: ActivityType;
  entityType?: EntityType;
  entityId?: string;
  metadata?: Record<string, any>;
}

interface QueuedActivity {
  user_id: string;
  action_type: string;
  entity_type?: string;
  entity_id?: string;
  metadata: Record<string, any>;
}

const BATCH_INTERVAL = 5000; // Flush every 5 seconds
const MAX_BATCH_SIZE = 20;

export function useActivityLogger() {
  const { user } = useAuthContext();
  const queueRef = useRef<QueuedActivity[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (queueRef.current.length === 0) return;
    
    const batch = queueRef.current.splice(0, MAX_BATCH_SIZE);
    
    try {
      const { error } = await supabase
        .from('user_activity_log')
        .insert(batch);

      if (error) {
        console.error('Error flushing activity batch:', error);
      }
    } catch (error) {
      console.error('Error flushing activity batch:', error);
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flush();
    }, BATCH_INTERVAL);
  }, [flush]);

  const logActivity = useCallback(({
    actionType,
    entityType,
    entityId,
    metadata = {},
  }: LogActivityParams) => {
    if (!user) return;

    queueRef.current.push({
      user_id: user.id,
      action_type: actionType,
      entity_type: entityType,
      entity_id: entityId,
      metadata,
    });

    // Flush immediately if batch is full, otherwise schedule
    if (queueRef.current.length >= MAX_BATCH_SIZE) {
      flush();
    } else {
      scheduleFlush();
    }
  }, [user, flush, scheduleFlush]);

  return { logActivity };
}
