import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from './useUserRole';
import { startOfDay, endOfDay, format } from 'date-fns';

interface UserProductivity {
  userId: string;
  userName: string | null;
  email: string | null;
  replies: number;
  dmsSent: number;
  leadsCreated: number;
  sessionMinutes: number;
  totalActions: number;
  pageVisits: number;
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
  leads: number;
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

export function useTeamProductivity(dateRange: { start: Date; end: Date }) {
  const { isAdmin } = useUserRole();
  const [productivity, setProductivity] = useState<UserProductivity[]>([]);
  const [timeline, setTimeline] = useState<ActivityLogEntry[]>([]);
  const [dailyMetrics, setDailyMetrics] = useState<DailyMetric[]>([]);
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProductivity = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    try {
      const startDate = startOfDay(dateRange.start).toISOString();
      const endDate = endOfDay(dateRange.end).toISOString();

      // Fetch activity logs
      const { data: activities, error: activitiesError } = await supabase
        .from('user_activity_log')
        .select('*')
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .order('created_at', { ascending: false });

      if (activitiesError) throw activitiesError;

      // Fetch user sessions
      const { data: sessionsData, error: sessionsError } = await supabase
        .from('user_sessions')
        .select('*')
        .gte('started_at', startDate)
        .lte('started_at', endDate)
        .order('started_at', { ascending: false });

      if (sessionsError) throw sessionsError;

      // Get unique user IDs from both activities and sessions
      const activityUserIds = (activities || []).map(a => a.user_id);
      const sessionUserIds = (sessionsData || []).map(s => s.user_id);
      const userIds = [...new Set([...activityUserIds, ...sessionUserIds])];

      // Fetch user profiles
      let profileMap = new Map<string, { full_name: string | null; email: string | null }>();
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, full_name, email')
          .in('user_id', userIds);

        profileMap = new Map(profiles?.map(p => [p.user_id, { full_name: p.full_name, email: p.email }]) || []);
      }

      // Calculate productivity per user
      const userProductivityMap = new Map<string, UserProductivity>();

      // Initialize from sessions
      (sessionsData || []).forEach(session => {
        const existing = userProductivityMap.get(session.user_id) || {
          userId: session.user_id,
          userName: profileMap.get(session.user_id)?.full_name || null,
          email: profileMap.get(session.user_id)?.email || null,
          replies: 0,
          dmsSent: 0,
          leadsCreated: 0,
          sessionMinutes: 0,
          totalActions: 0,
          pageVisits: 0,
        };

        if (session.duration_seconds) {
          existing.sessionMinutes += Math.round(session.duration_seconds / 60);
        }

        userProductivityMap.set(session.user_id, existing);
      });

      // Add activity data
      (activities || []).forEach(activity => {
        const existing = userProductivityMap.get(activity.user_id) || {
          userId: activity.user_id,
          userName: profileMap.get(activity.user_id)?.full_name || null,
          email: profileMap.get(activity.user_id)?.email || null,
          replies: 0,
          dmsSent: 0,
          leadsCreated: 0,
          sessionMinutes: 0,
          totalActions: 0,
          pageVisits: 0,
        };

        existing.totalActions++;

        switch (activity.action_type) {
          case 'comment_reply':
            existing.replies++;
            break;
          case 'dm_sent':
          case 'dm_copied':
            existing.dmsSent++;
            break;
          case 'lead_created':
            existing.leadsCreated++;
            break;
          case 'page_visit':
            existing.pageVisits++;
            break;
          case 'workflow_session_end':
            const duration = (activity.metadata as any)?.duration_seconds || 0;
            existing.sessionMinutes += Math.round(duration / 60);
            break;
        }

        userProductivityMap.set(activity.user_id, existing);
      });

      const productivityList = Array.from(userProductivityMap.values())
        .sort((a, b) => b.totalActions - a.totalActions);

      setProductivity(productivityList);

      // Set timeline with user names
      const timelineWithNames: ActivityLogEntry[] = (activities || []).map(a => ({
        ...a,
        metadata: (a.metadata || {}) as Record<string, any>,
        user_name: profileMap.get(a.user_id)?.full_name,
        user_email: profileMap.get(a.user_id)?.email,
      }));
      setTimeline(timelineWithNames.slice(0, 100));

      // Set sessions with user names
      const sessionsWithNames: UserSession[] = (sessionsData || []).map(s => ({
        ...s,
        user_name: profileMap.get(s.user_id)?.full_name,
        user_email: profileMap.get(s.user_id)?.email,
      }));
      setSessions(sessionsWithNames);

      // Calculate daily metrics
      const dailyMap = new Map<string, DailyMetric>();
      
      (activities || []).forEach(activity => {
        const dateKey = format(new Date(activity.created_at), 'yyyy-MM-dd');
        const existing = dailyMap.get(dateKey) || { date: dateKey, replies: 0, dms: 0, leads: 0 };

        switch (activity.action_type) {
          case 'comment_reply':
            existing.replies++;
            break;
          case 'dm_sent':
          case 'dm_copied':
            existing.dms++;
            break;
          case 'lead_created':
            existing.leads++;
            break;
        }

        dailyMap.set(dateKey, existing);
      });

      const sortedDailyMetrics = Array.from(dailyMap.values())
        .sort((a, b) => a.date.localeCompare(b.date));

      setDailyMetrics(sortedDailyMetrics);
    } catch (error) {
      console.error('Error fetching team productivity:', error);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, dateRange]);

  useEffect(() => {
    fetchProductivity();
  }, [fetchProductivity]);

  return {
    productivity,
    timeline,
    dailyMetrics,
    sessions,
    loading,
    refetch: fetchProductivity,
  };
}
