import { useState, useEffect, useCallback, useRef } from 'react';
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
  callsAnswered: number;
  callsUnanswered: number;
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
  leadsClosed: 0, leadsProgressed: 0, callsMade: 0, callsAnswered: 0, callsUnanswered: 0,
  stageChanges: 0, checklistItemsChecked: 0, activitiesCompleted: 0, activitiesOverdue: 0,
  sessionMinutes: 0, totalActions: 0,
};

const hardcodedDefaults: MyDailyGoals = {
  target_replies: 50, target_dms: 50, target_leads: 5, target_session_minutes: 60,
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
        outboundCommentsRes, sentCommentsRes, userDefaultGoalsRes, callRecordsRes,
      ] = await Promise.all([
        supabase.from('contacts').select('id').eq('created_by', userId)
          .gte('created_at', startDate).lte('created_at', endDate),
        supabase.from('dm_history').select('id, action_type').eq('user_id', userId)
          .gte('created_at', startDate).lte('created_at', endDate),
        supabase.from('instagram_comments').select('id').eq('replied_by', userId)
          .gte('replied_at', startDate).lte('replied_at', endDate),
        supabase.from('lead_stage_history').select('id, lead_id, to_stage')
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
        supabase.from('instagram_comments').select('id')
          .eq('comment_type', 'outbound_manual')
          .eq('replied_by', userId)
          .gte('created_at', startDate).lte('created_at', endDate),
        supabase.from('instagram_comments').select('id')
          .eq('comment_type', 'sent')
          .gte('created_at', startDate).lte('created_at', endDate),
        supabase.from('user_daily_goal_defaults').select('*').eq('user_id', userId).maybeSingle(),
        // Call records from call_records table
        supabase.from('call_records').select('id, call_result').eq('user_id', userId)
          .gte('created_at', startDate).lte('created_at', endDate),
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
      const outboundComments = outboundCommentsRes.data || [];
      const sentComments = sentCommentsRes.data || [];
      const userDefaults = userDefaultGoalsRes.data as any;
      const userTargetDays: number[] = userDefaults?.target_days ?? [1, 2, 3, 4, 5];

      // Count all outbound DM actions (copied, copied_and_opened, sent) — any DM registered by the user counts
      const dmsSent = dms.filter(d => d.action_type !== 'received').length;
      const catCalls = catContacts.filter(c => c.contact_channel === 'phone' || c.contact_channel === 'ligacao').length;
      const callRecords = callRecordsRes.data || [];
      const callsMade = catCalls + callRecords.length;
      const callsAnswered = catCalls + callRecords.filter(c => c.call_result === 'atendeu').length;
      const callsUnanswered = callRecords.filter(c => c.call_result !== 'atendeu').length;
      const checklistChecked = activities.filter(a => a.action_type === 'checklist_item_checked').length;
      const checklistUnchecked = activities.filter(a => a.action_type === 'checklist_item_unchecked').length;
      const checklistItemsChecked = checklistChecked - checklistUnchecked;
      const sessionMinutes = sessions.reduce((acc, s) => acc + Math.round((s.duration_seconds || 0) / 60), 0);
      const uniqueLeadsProgressed = new Set(stageHistory.map(s => (s as any).lead_id)).size;
      const CLOSED_STAGE_IDS = ['closed', 'fechado', 'done'];
      const leadsClosed = stageHistory.filter(s => CLOSED_STAGE_IDS.includes((s as any).to_stage)).length;
      // Total comment replies = replied on own posts + outbound_manual + sent (outbound on third-party posts)
      const totalCommentReplies = replies.length + outboundComments.length + sentComments.length;

      const prod: MyProductivity = {
        commentReplies: totalCommentReplies,
        dmsSent,
        contactsCreated: contacts.length,
        leadsCreated: leads.length,
        leadsClosed,
        leadsProgressed: uniqueLeadsProgressed,
        callsMade,
        callsAnswered,
        callsUnanswered,
        stageChanges: stageHistory.length,
        checklistItemsChecked,
        activitiesCompleted: completedActivities.length,
        activitiesOverdue: overdueActivities.length,
        sessionMinutes,
        totalActions: contacts.length + dmsSent + totalCommentReplies + leads.length +
          callsMade + checklistItemsChecked + completedActivities.length - overdueActivities.length,
      };

      setData(prod);

      // Priority: user-specific daily goals > per-user defaults > global defaults > hardcoded
      const ud = userDefaults as any;
      const dg = defaultGoalsRes.data;
      
      const fallback: MyDailyGoals = ud ? {
        target_replies: ud.target_replies ?? 20,
        target_dms: ud.target_dms ?? 10,
        target_leads: ud.target_leads ?? 5,
        target_session_minutes: ud.target_session_minutes ?? 60,
        target_contacts: ud.target_contacts ?? 5,
        target_calls: ud.target_calls ?? 10,
        target_activities: ud.target_activities ?? 5,
        target_stage_changes: ud.target_stage_changes ?? 10,
        target_leads_closed: ud.target_leads_closed ?? 2,
        target_checklist_items: ud.target_checklist_items ?? 10,
      } : dg ? {
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

      // Save daily goal snapshot (calculate progress with resolved goals)
      const resolvedGoals = goalsRes.data ? {
        target_replies: goalsRes.data.target_replies ?? fallback.target_replies,
        target_dms: goalsRes.data.target_dms ?? fallback.target_dms,
        target_leads: goalsRes.data.target_leads ?? fallback.target_leads,
        target_session_minutes: goalsRes.data.target_session_minutes ?? fallback.target_session_minutes,
      } : fallback;

      const baseCore = [
        { current: prod.commentReplies, target: resolvedGoals.target_replies },
        { current: prod.dmsSent, target: resolvedGoals.target_dms },
        { current: prod.leadsCreated, target: resolvedGoals.target_leads },
        { current: prod.sessionMinutes, target: resolvedGoals.target_session_minutes },
      ].filter(m => m.target > 0);

      const actTarget = (goalsRes.data as any)?.target_activities ?? fallback.target_activities;
      const actPercent = actTarget > 0 ? Math.min(100, (prod.activitiesCompleted / actTarget) * 100) : 0;
      const basePercentages = baseCore.map(m => Math.min(100, (m.current / m.target) * 100));
      const baseAvg = basePercentages.length > 0 ? basePercentages.reduce((a, b) => a + b, 0) / basePercentages.length : 100;

      // Only include activities if they help (don't dilute the score)
      const core = actTarget > 0 && actPercent >= baseAvg
        ? [...baseCore, { current: prod.activitiesCompleted, target: actTarget }]
        : baseCore;

      const progressPercent = core.length === 0 ? 100 :
        Math.round(core.map(m => Math.min(100, (m.current / m.target) * 100)).reduce((a, b) => a + b, 0) / core.length);
      
      // Upsert snapshot for today — only on target days
      const today = format(now, 'yyyy-MM-dd');
      const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
      if (userTargetDays.includes(dayOfWeek)) {
        supabase.from('daily_goal_snapshots').upsert({
          user_id: userId,
          snapshot_date: today,
          progress_percent: progressPercent,
          achieved: progressPercent >= 100,
          metrics_detail: {
            commentReplies: prod.commentReplies,
            dmsSent: prod.dmsSent,
            leadsCreated: prod.leadsCreated,
            sessionMinutes: prod.sessionMinutes,
          },
        } as any, { onConflict: 'user_id,snapshot_date' }).then(() => {});
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

  // Overall goal progress — uses core daily metrics
  const goalProgress = (() => {
    const baseCore = [
      { current: data.commentReplies, target: goals.target_replies },
      { current: data.dmsSent, target: goals.target_dms },
      { current: data.leadsCreated, target: goals.target_leads },
      { current: data.sessionMinutes, target: goals.target_session_minutes },
    ].filter(m => m.target > 0);

    const actPercent = goals.target_activities > 0 ? Math.min(100, (data.activitiesCompleted / goals.target_activities) * 100) : 0;
    const basePercentages = baseCore.map(m => Math.min(100, (m.current / m.target) * 100));
    const baseAvg = basePercentages.length > 0 ? basePercentages.reduce((a, b) => a + b, 0) / basePercentages.length : 100;

    const core = goals.target_activities > 0 && actPercent >= baseAvg
      ? [...baseCore, { current: data.activitiesCompleted, target: goals.target_activities }]
      : baseCore;

    if (core.length === 0) return 100;
    const percentages = core.map(m => Math.min(100, (m.current / m.target) * 100));
    return Math.round(percentages.reduce((a, b) => a + b, 0) / percentages.length);
  })();

  return { data, goals, goalProgress, loading, refetch: fetchData };
}
