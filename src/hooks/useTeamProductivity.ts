import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from './useUserRole';
import { startOfDay, endOfDay, format } from 'date-fns';

export interface UserProductivity {
  userId: string;
  userName: string | null;
  email: string | null;
  contactsCreated: number;
  contactsLinked: number;
  dmsSent: number;
  dmsReceived: number;
  commentReplies: number;
  callsMade: number;
  stageChanges: number;
  followupsCreated: number;
  followupsDone: number;
  leadsCreated: number;
  leadsClosed: number;
  leadsProgressed: number;
  checklistItemsChecked: number;
  activitiesCompleted: number;
  activitiesOverdue: number;
  sessionMinutes: number;
  pageVisits: number;
  totalActions: number;
  // Meta traffic metrics
  metaLeadsReceived: number;
  metaLeadsQualified: number;
  metaCreativesUploaded: number;
}

interface ActivityLogEntry {
  id: string;
  user_id: string;
  action_type: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, any>;
  created_at: string;
  user_name?: string | null;
  user_email?: string | null;
}

interface DailyMetric {
  date: string;
  replies: number;
  dms: number;
  contacts: number;
  stageChanges: number;
  followups: number;
}

interface UserSession {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  end_reason: string | null;
  last_activity_at: string;
  user_name?: string | null;
  user_email?: string | null;
}

interface TeamProductivitySummary {
  totalContactsCreated: number;
  totalDmsSent: number;
  totalCommentReplies: number;
  totalStageChanges: number;
  totalFollowups: number;
  totalLeadsClosed: number;
  totalPageVisits: number;
  totalCallsMade: number;
  totalChecklistItems: number;
}

export function useTeamProductivity(dateRange: { start: Date; end: Date }) {
  const { isAdmin } = useUserRole();
  const [productivity, setProductivity] = useState<UserProductivity[]>([]);
  const [timeline, setTimeline] = useState<ActivityLogEntry[]>([]);
  const [dailyMetrics, setDailyMetrics] = useState<DailyMetric[]>([]);
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [summary, setSummary] = useState<TeamProductivitySummary>({
    totalContactsCreated: 0,
    totalDmsSent: 0,
    totalCommentReplies: 0,
    totalStageChanges: 0,
    totalFollowups: 0,
    totalLeadsClosed: 0,
    totalPageVisits: 0,
    totalCallsMade: 0,
    totalChecklistItems: 0,
  });
  const [loading, setLoading] = useState(true);

  const fetchProductivity = useCallback(async () => {
    if (!isAdmin) { setLoading(false); return; }

    try {
      const startDate = startOfDay(dateRange.start).toISOString();
      const endDate = endOfDay(dateRange.end).toISOString();

      // Fetch all data sources in parallel
      const [
        contactsRes,
        contactLeadsRes,
        dmsRes,
        repliesRes,
        stageHistoryRes,
        followupsRes,
        leadsRes,
        sessionsRes,
        activitiesRes,
        catContactsRes,
        completedActivitiesRes,
        overdueActivitiesRes,
        metaDailyRes,
      ] = await Promise.all([
        // Contacts created (has created_by)
        supabase.from('contacts').select('id, created_by, created_at')
          .gte('created_at', startDate).lte('created_at', endDate)
          .not('created_by', 'is', null),
        // Contacts linked to leads
        supabase.from('contact_leads').select('id, created_at')
          .gte('created_at', startDate).lte('created_at', endDate),
        // DMs sent (has user_id)
        supabase.from('dm_history').select('id, user_id, action_type, created_at')
          .gte('created_at', startDate).lte('created_at', endDate),
        // Comment replies (has replied_by)
        supabase.from('instagram_comments').select('id, replied_by, replied_at')
          .gte('replied_at', startDate).lte('replied_at', endDate)
          .not('replied_by', 'is', null),
        // Stage changes (now with changed_by for per-user tracking)
        supabase.from('lead_stage_history').select('id, lead_id, changed_at, to_stage, changed_by')
          .gte('changed_at', startDate).lte('changed_at', endDate),
        // Followups
        supabase.from('lead_followups').select('id, created_at, followup_type, outcome')
          .gte('created_at', startDate).lte('created_at', endDate),
        // Leads created (has created_by)
        supabase.from('leads').select('id, created_by, created_at, status, lead_name')
          .gte('created_at', startDate).lte('created_at', endDate),
        // Sessions
        supabase.from('user_sessions').select('*')
          .lte('started_at', endDate)
          .or(`ended_at.is.null,ended_at.gte.${startDate}`)
          .order('started_at', { ascending: false }),
        // Activity log for page visits and other actions
        supabase.from('user_activity_log').select('*')
          .gte('created_at', startDate).lte('created_at', endDate)
          .order('created_at', { ascending: false }),
        // CAT contacts (calls, has contacted_by)
        supabase.from('cat_lead_contacts').select('id, contacted_by, contact_channel, created_at')
          .gte('created_at', startDate).lte('created_at', endDate)
          .not('contacted_by', 'is', null),
        // Lead activities - completed
        supabase.from('lead_activities').select('id, assigned_to, status, deadline, completed_at, completed_by')
          .eq('status', 'concluida')
          .gte('completed_at', startDate).lte('completed_at', endDate),
        // Lead activities - overdue (pendente with deadline before now)
        supabase.from('lead_activities').select('id, assigned_to, status, deadline')
          .eq('status', 'pendente')
          .lt('deadline', format(new Date(), 'yyyy-MM-dd'))
          .not('deadline', 'is', null),
        // Meta daily metrics for traffic productivity
        supabase.from('meta_daily_metrics').select('*')
          .gte('metric_date', format(dateRange.start, 'yyyy-MM-dd'))
          .lte('metric_date', format(dateRange.end, 'yyyy-MM-dd')),
      ]);

      const contacts = contactsRes.data || [];
      const contactLeads = contactLeadsRes.data || [];
      const dms = dmsRes.data || [];
      const replies = repliesRes.data || [];
      const stageHistory = stageHistoryRes.data || [];
      const followups = followupsRes.data || [];
      const leads = leadsRes.data || [];
      const sessionsData = sessionsRes.data || [];
      const activities = activitiesRes.data || [];
      const catContacts = catContactsRes.data || [];
      const completedActivities = completedActivitiesRes.data || [];
      const overdueActivities = overdueActivitiesRes.data || [];
      const metaDailyMetrics = (metaDailyRes.data as any[]) || [];

      // Gather all user IDs
      const allUserIds = new Set<string>();
      contacts.forEach(c => c.created_by && allUserIds.add(c.created_by));
      dms.forEach(d => d.user_id && allUserIds.add(d.user_id));
      replies.forEach(r => r.replied_by && allUserIds.add(r.replied_by));
      leads.forEach(l => l.created_by && allUserIds.add(l.created_by));
      sessionsData.forEach(s => allUserIds.add(s.user_id));
      activities.forEach(a => allUserIds.add(a.user_id));
      catContacts.forEach(c => c.contacted_by && allUserIds.add(c.contacted_by));
      stageHistory.forEach(s => (s as any).changed_by && allUserIds.add((s as any).changed_by));
      completedActivities.forEach(a => a.completed_by && allUserIds.add(a.completed_by));
      overdueActivities.forEach(a => a.assigned_to && allUserIds.add(a.assigned_to));
      metaDailyMetrics.forEach(m => m.user_id && allUserIds.add(m.user_id));

      // Fetch profiles
      let profileMap = new Map<string, { full_name: string | null; email: string | null }>();
      if (allUserIds.size > 0) {
        const { data: profiles } = await supabase.from('profiles')
          .select('user_id, full_name, email')
          .in('user_id', Array.from(allUserIds));
        profileMap = new Map(profiles?.map(p => [p.user_id, { full_name: p.full_name, email: p.email }]) || []);
      }

      // Build per-user map
      const userMap = new Map<string, UserProductivity>();
      const getUser = (userId: string): UserProductivity => {
        if (!userMap.has(userId)) {
          userMap.set(userId, {
            userId,
            userName: profileMap.get(userId)?.full_name || null,
            email: profileMap.get(userId)?.email || null,
            contactsCreated: 0, contactsLinked: 0, dmsSent: 0, dmsReceived: 0,
            commentReplies: 0, callsMade: 0, stageChanges: 0, leadsProgressed: 0,
            followupsCreated: 0, followupsDone: 0, leadsCreated: 0, leadsClosed: 0,
            checklistItemsChecked: 0, activitiesCompleted: 0, activitiesOverdue: 0,
            sessionMinutes: 0, pageVisits: 0, totalActions: 0,
            metaLeadsReceived: 0, metaLeadsQualified: 0, metaCreativesUploaded: 0,
          });
        }
        return userMap.get(userId)!;
      };

      // Count contacts created per user
      contacts.forEach(c => { if (c.created_by) { getUser(c.created_by).contactsCreated++; } });

      // Count DMs per user
      dms.forEach(d => {
        if (d.user_id) {
          const u = getUser(d.user_id);
          if (d.action_type !== 'received') u.dmsSent++;
          else u.dmsReceived++;
        }
      });

      // Count replies per user
      replies.forEach(r => { if (r.replied_by) { getUser(r.replied_by).commentReplies++; } });

      // Count leads created per user
      leads.forEach(l => {
        if (l.created_by) {
          getUser(l.created_by).leadsCreated++;
        }
      });

      // Count leads closed per user - deduplicate by lead_id
      const CLOSED_PATTERNS = ['closed', 'fechado', 'fechados', 'done'];
      const isClosedStageId = (id: string) => {
        const lower = id.toLowerCase();
        return CLOSED_PATTERNS.some(p => lower === p || lower.startsWith(p + '_'));
      };
      const closedByUser = new Map<string, Set<string>>();
      stageHistory.forEach(s => {
        const changedBy = (s as any).changed_by;
        const toStage = (s as any).to_stage;
        const leadId = (s as any).lead_id;
        if (changedBy && toStage && isClosedStageId(toStage) && leadId) {
          if (!closedByUser.has(changedBy)) closedByUser.set(changedBy, new Set());
          closedByUser.get(changedBy)!.add(leadId);
        }
      });
      closedByUser.forEach((leadIds, uId) => {
        getUser(uId).leadsClosed = leadIds.size;
      });

      // Count calls from CAT contacts
      catContacts.forEach(c => {
        if (c.contacted_by) {
          const u = getUser(c.contacted_by);
          if (c.contact_channel === 'phone' || c.contact_channel === 'ligacao') {
            u.callsMade++;
          }
          u.totalActions++;
        }
      });

      // Sessions - merge intervals per user (with inactivity grace) to avoid under/overcount
      const nowMs = Date.now();
      const rangeStartMs = new Date(startDate).getTime();
      const rangeEndMs = new Date(endDate).getTime();
      const SESSION_INACTIVITY_GRACE_MS = 5 * 60 * 1000;
      const sessionIntervalsByUser = new Map<string, { start: number; end: number }[]>();

      sessionsData.forEach(s => {
        if (!s.started_at) return;
        const start = new Date(s.started_at).getTime();
        const endedAtMs = s.ended_at ? new Date(s.ended_at).getTime() : null;
        const durationEndMs = typeof s.duration_seconds === 'number' ? start + s.duration_seconds * 1000 : null;
        const lastActivityMs = s.last_activity_at ? new Date(s.last_activity_at).getTime() : null;
        const inferredEndMs = lastActivityMs ? lastActivityMs + SESSION_INACTIVITY_GRACE_MS : nowMs;

        const rawEnd = endedAtMs === null
          ? nowMs
          : (durationEndMs ?? endedAtMs ?? Math.min(inferredEndMs, nowMs));
        const boundedStart = Math.max(start, rangeStartMs);
        const boundedEnd = Math.min(rawEnd, rangeEndMs, nowMs);
        if (boundedEnd <= boundedStart) return;

        const list = sessionIntervalsByUser.get(s.user_id) || [];
        list.push({ start: boundedStart, end: boundedEnd });
        sessionIntervalsByUser.set(s.user_id, list);
      });

      sessionIntervalsByUser.forEach((intervals, userId) => {
        intervals.sort((a, b) => a.start - b.start);
        const merged: { start: number; end: number }[] = [];

        intervals.forEach(iv => {
          const last = merged[merged.length - 1];
          if (last && iv.start <= last.end) {
            last.end = Math.max(last.end, iv.end);
          } else {
            merged.push({ ...iv });
          }
        });

        const totalMinutes = merged.reduce((acc, m) => acc + Math.round((m.end - m.start) / 1000 / 60), 0);
        getUser(userId).sessionMinutes = totalMinutes;
      });

      // Activity log for page visits (tracked but not counted in totalActions)
      activities.forEach(a => {
        const u = getUser(a.user_id);
        if (a.action_type === 'page_visit') u.pageVisits++;
        if (a.action_type === 'checklist_item_checked') u.checklistItemsChecked++;
        if (a.action_type === 'checklist_item_unchecked') {
          u.checklistItemsChecked = Math.max(0, u.checklistItemsChecked - 1);
        }
      });

      // Stage changes per user (now has changed_by) + unique leads progressed
      const userLeadsProgressedMap = new Map<string, Set<string>>();
      stageHistory.forEach(s => {
        const changedBy = (s as any).changed_by;
        const leadId = (s as any).lead_id;
        if (changedBy) {
          getUser(changedBy).stageChanges++;
          allUserIds.add(changedBy);
          if (leadId) {
            if (!userLeadsProgressedMap.has(changedBy)) userLeadsProgressedMap.set(changedBy, new Set());
            userLeadsProgressedMap.get(changedBy)!.add(leadId);
          }
        }
      });
      userLeadsProgressedMap.forEach((leadSet, userId) => {
        getUser(userId).leadsProgressed = leadSet.size;
      });
      // Followups (no user_id, count globally)

      // Count completed activities per user
      completedActivities.forEach(a => {
        if (a.completed_by) {
          getUser(a.completed_by).activitiesCompleted++;
        }
      });

      // Count overdue activities per user
      overdueActivities.forEach(a => {
        if (a.assigned_to) {
          getUser(a.assigned_to).activitiesOverdue++;
        }
      });

      // Meta daily metrics per user
      metaDailyMetrics.forEach(m => {
        if (m.user_id) {
          const u = getUser(m.user_id);
          u.metaLeadsReceived += m.leads_received || 0;
          u.metaLeadsQualified += m.leads_qualified || 0;
          u.metaCreativesUploaded += (m.manual_creatives_uploaded || 0) + (m.creatives_active || 0);
        }
      });

      // Compute total actions for each user (non-negative, and never reduced by overdue)
      userMap.forEach(u => {
        u.totalActions = Math.max(0,
          u.contactsCreated + u.contactsLinked + u.dmsSent + u.dmsReceived +
          u.commentReplies + u.callsMade + u.leadsCreated + u.leadsClosed +
          u.followupsCreated + u.followupsDone + u.checklistItemsChecked +
          u.activitiesCompleted +
          u.metaLeadsReceived + u.metaLeadsQualified + u.metaCreativesUploaded
        );
      });

      const productivityList = Array.from(userMap.values())
        .sort((a, b) => b.totalActions - a.totalActions);

      setProductivity(productivityList);

      // Summary
      setSummary({
        totalContactsCreated: contacts.length,
        totalDmsSent: dms.filter(d => d.action_type !== 'received').length,
        totalCommentReplies: replies.length,
        totalStageChanges: stageHistory.length,
        totalFollowups: followups.length,
        totalLeadsClosed: stageHistory.filter(s => isClosedStageId((s as any).to_stage || '')).length,
        totalPageVisits: activities.filter(a => a.action_type === 'page_visit').length,
        totalCallsMade: catContacts.filter(c => c.contact_channel === 'phone' || c.contact_channel === 'ligacao').length,
        totalChecklistItems: activities.filter(a => a.action_type === 'checklist_item_checked').length,
      });

      // Timeline
      const timelineWithNames: ActivityLogEntry[] = activities.map(a => ({
        ...a,
        metadata: (a.metadata || {}) as Record<string, any>,
        user_name: profileMap.get(a.user_id)?.full_name,
        user_email: profileMap.get(a.user_id)?.email,
      }));
      setTimeline(timelineWithNames.slice(0, 100));

      // Sessions with names
      setSessions(sessionsData.map(s => ({
        ...s,
        user_name: profileMap.get(s.user_id)?.full_name,
        user_email: profileMap.get(s.user_id)?.email,
      })));

      // Daily metrics
      const dailyMap = new Map<string, DailyMetric>();
      const getDay = (dateStr: string) => {
        const key = format(new Date(dateStr), 'yyyy-MM-dd');
        if (!dailyMap.has(key)) dailyMap.set(key, { date: key, replies: 0, dms: 0, contacts: 0, stageChanges: 0, followups: 0 });
        return dailyMap.get(key)!;
      };
      replies.forEach(r => { if (r.replied_at) getDay(r.replied_at).replies++; });
      dms.forEach(d => getDay(d.created_at).dms++);
      contacts.forEach(c => getDay(c.created_at).contacts++);
      stageHistory.forEach(s => getDay(s.changed_at).stageChanges++);
      followups.forEach(f => getDay(f.created_at).followups++);

      setDailyMetrics(Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)));
    } catch (error) {
      console.error('Error fetching team productivity:', error);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, dateRange]);

  useEffect(() => { fetchProductivity(); }, [fetchProductivity]);

  return { productivity, timeline, dailyMetrics, sessions, summary, loading, refetch: fetchProductivity };
}
