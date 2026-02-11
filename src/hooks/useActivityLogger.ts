import { useCallback } from 'react';
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

export function useActivityLogger() {
  const { user } = useAuthContext();

  const logActivity = useCallback(async ({
    actionType,
    entityType,
    entityId,
    metadata = {},
  }: LogActivityParams) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('user_activity_log')
        .insert({
          user_id: user.id,
          action_type: actionType,
          entity_type: entityType,
          entity_id: entityId,
          metadata,
        });

      if (error) {
        console.error('Error logging activity:', error);
      }
    } catch (error) {
      console.error('Error logging activity:', error);
    }
  }, [user]);

  return { logActivity };
}
