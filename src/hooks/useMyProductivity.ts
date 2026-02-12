import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { startOfDay, endOfDay, format } from 'date-fns';

export interface MyProductivity {
  commentReplies: number;
  dmsSent: number;
  contactsCreated: number;
  leadsCreated: number;
  leadsClosed: number;
  leadsProgressed: number;
  callsMade: number;
  stageChanges: number;
  checklistItemsChecked: number;
  activitiesCompleted: number;
  activitiesOverdue: number;
  sessionMinutes: number;
  totalActions: number;
}

export interface MyDailyGoals {
  target_replies: number;
  target_dms: number;
  target_leads: number;
  target_session_minutes: number;
  target_contacts: number;
  target_calls: number;
  target_activities: number;
  target_stage_changes: number;
  target_leads_closed: number;
  target_checklist_items: number;
}

const emptyProductivity: MyProductivity = {
  commentReplies: 0, dmsSent: 0, contactsCreated: 0, leadsCreated: 0,
  leadsClosed: 0, leadsProgressed: 0, callsMade: 0, stageChanges: 0,
  checklistItemsChecked: 0, activitiesCompleted: 0, activitiesOverdue: 0,
  sessionMinutes: 0, totalActions: 0,
};

const hardcodedDefaults: MyDailyGoals = {
  target_replies: 20, target_dms: 10, target_leads: 5, target_session_minutes: 60,
  target_contacts: 5, target_calls: 10, target_activities: 5, target_stage_changes: 10,
  target_leads_closed: 2, target_checklist_items: 10,
};

export function useMyProductivity() {
  const { user } = useAuthContext();
  const [data, setData] = useState<MyProductivity>(emptyProductivity);
  const [goals, setGoals] = useState<MyDailyGoals>(hardcodedDefaults);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!user) { setLoading(false); return; }

    const now = new Date();
    const startDate = startOfDay(now).toISOString();
    const endDate = endOfDay(now).toISOString();
    const userId = user.id;

    try {
      const [
        contactsRes, dmsRes, repliesRes, stageHistoryRes,
        leadsRes, sessionsRes, activitiesRes, catContactsRes,
        completedActivitiesRes, overdueActivitiesRes, goalsRes, defaultGoalsRes,
      ] = await Promise.all([
        supabase.from('contacts').select('id').eq('created_by', userId)
          .gte('created_at', startDate).lte('created_at', endDate),
        supabase.from('dm_history').select('id, action_type').eq('user_id', userId)
          .gte('created_at', startDate).lte('created_at', endDate),
        supabase.from('instagram_comments').select('id').eq('replied_by', userId)
          .gte('replied_at', startDate).lte('replied_at', endDate),
        supabase.from('lead_stage_history').select('id, lead_id')
          .eq('changed_by', userId)
          .gte('changed_at', startDate).lte('changed_at', endDate),
        supabase.from('leads').select('id, status').eq('created_by', userId)
          .gte('created_at', startDate).lte('created_at', endDate),
        supabase.from('user_sessions').select('duration_seconds').eq('user_id', userId)
          .gte('started_at', startDate).lte('started_at', endDate),
        supabase.from('user_activity_log').select('action_type').eq('user_id', userId)
          .gte('created_at', startDate).lte('created_at', endDate),
        supabase.from('cat_lead_contacts').select('id, contact_channel').eq('contacted_by', userId)
          .gte('created_at', startDate).lte('created_at', endDate),
        supabase.from('lead_activities').select('id').eq('completed_by', userId)
          .eq('status', 'concluida')
          .gte('completed_at', startDate).lte('completed_at', endDate),
        supabase.from('lead_activities').select('id').eq('assigned_to', userId)
          .eq('status', 'pendente')
          .lt('deadline', format(now, 'yyyy-MM-dd'))
          .not('deadline', 'is', null),
        supabase.from('workflow_daily_goals').select('*').eq('user_id', userId)
          .eq('goal_date', format(now, 'yyyy-MM-dd')).maybeSingle(),
        supabase.from('workflow_default_goals').select('*').limit(1).maybeSingle(),
      ]);

      const contacts = contactsRes.data || [];
      const dms = dmsRes.data || [];
      const replies = repliesRes.data || [];
      const stageHistory = stageHistoryRes.data || [];
      const leads = leadsRes.data || [];
      const sessions = sessionsRes.data || [];
      const activities = activitiesRes.data || [];
      const catContacts = catContactsRes.data || [];
      const completedActivities = completedActivitiesRes.data || [];
      const overdueActivities = overdueActivitiesRes.data || [];

      const dmsSent = dms.filter(d => d.action_type === 'sent').length;
      const callsMade = catContacts.filter(c => c.contact_channel === 'phone' || c.contact_channel === 'ligacao').length;
      const checklistChecked = activities.filter(a => a.action_type === 'checklist_item_checked').length;
      const checklistUnchecked = activities.filter(a => a.action_type === 'checklist_item_unchecked').length;
      const checklistItemsChecked = checklistChecked - checklistUnchecked;
      const sessionMinutes = sessions.reduce((acc, s) => acc + Math.round((s.duration_seconds || 0) / 60), 0);
      const uniqueLeadsProgressed = new Set(stageHistory.map(s => (s as any).lead_id)).size;
      const leadsClosed = leads.filter(l => ['converted', 'won', 'closed', 'fechado', 'done'].includes(l.status || '')).length;

      const prod: MyProductivity = {
        commentReplies: replies.length,
        dmsSent,
        contactsCreated: contacts.length,
        leadsCreated: leads.length,
        leadsClosed,
        leadsProgressed: uniqueLeadsProgressed,
        callsMade,
        stageChanges: stageHistory.length,
        checklistItemsChecked,
        activitiesCompleted: completedActivities.length,
        activitiesOverdue: overdueActivities.length,
        sessionMinutes,
        totalActions: contacts.length + dmsSent + replies.length + leads.length +
          callsMade + checklistItemsChecked + completedActivities.length - overdueActivities.length,
      };

      setData(prod);

      // Use user-specific goals if set, otherwise fall back to configurable defaults
      const dg = defaultGoalsRes.data;
      const fallback: MyDailyGoals = dg ? {
        target_replies: dg.target_replies ?? 20,
        target_dms: dg.target_dms ?? 10,
        target_leads: dg.target_leads ?? 5,
        target_session_minutes: dg.target_session_minutes ?? 60,
        target_contacts: (dg as any).target_contacts ?? 5,
        target_calls: (dg as any).target_calls ?? 10,
        target_activities: (dg as any).target_activities ?? 5,
        target_stage_changes: (dg as any).target_stage_changes ?? 10,
        target_leads_closed: (dg as any).target_leads_closed ?? 2,
        target_checklist_items: (dg as any).target_checklist_items ?? 10,
      } : hardcodedDefaults;

      if (goalsRes.data) {
        setGoals({
          target_replies: goalsRes.data.target_replies ?? fallback.target_replies,
          target_dms: goalsRes.data.target_dms ?? fallback.target_dms,
          target_leads: goalsRes.data.target_leads ?? fallback.target_leads,
          target_session_minutes: goalsRes.data.target_session_minutes ?? fallback.target_session_minutes,
          target_contacts: (goalsRes.data as any).target_contacts ?? fallback.target_contacts,
          target_calls: (goalsRes.data as any).target_calls ?? fallback.target_calls,
          target_activities: (goalsRes.data as any).target_activities ?? fallback.target_activities,
          target_stage_changes: (goalsRes.data as any).target_stage_changes ?? fallback.target_stage_changes,
          target_leads_closed: (goalsRes.data as any).target_leads_closed ?? fallback.target_leads_closed,
          target_checklist_items: (goalsRes.data as any).target_checklist_items ?? fallback.target_checklist_items,
        });
      } else {
        setGoals(fallback);
      }
    } catch (error) {
      console.error('Error fetching my productivity:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Overall goal progress (average of individual goal percentages)
  const goalProgress = (() => {
    const metrics = [
      { current: data.commentReplies, target: goals.target_replies },
      { current: data.dmsSent, target: goals.target_dms },
      { current: data.leadsCreated, target: goals.target_leads },
      { current: data.sessionMinutes, target: goals.target_session_minutes },
    ];
    const percentages = metrics.map(m => m.target > 0 ? Math.min(100, (m.current / m.target) * 100) : 100);
    return Math.round(percentages.reduce((a, b) => a + b, 0) / percentages.length);
  })();

  return { data, goals, goalProgress, loading, refetch: fetchData };
}
