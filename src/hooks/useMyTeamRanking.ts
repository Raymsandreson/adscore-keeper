import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { startOfDay, endOfDay, format } from 'date-fns';

export interface TeamRankingEntry {
  userId: string;
  userName: string | null;
  totalPoints: number;
  leadsCreated: number;
  checklistItemsChecked: number;
  stageChanges: number;
  leadsClosed: number;
  contactsCreated: number;
  callsMade: number;
  dmsSent: number;
  isCurrentUser: boolean;
}

export interface MyTeamInfo {
  teamId: string;
  teamName: string;
  teamColor: string;
  boardId: string | null;
}

export function useMyTeamRanking() {
  const { user } = useAuthContext();
  const [ranking, setRanking] = useState<TeamRankingEntry[]>([]);
  const [myTeams, setMyTeams] = useState<MyTeamInfo[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [myPosition, setMyPosition] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchRanking = useCallback(async (teamId?: string) => {
    if (!user) return;
    setLoading(true);

    try {
      // 1. Get user's teams
      const { data: myTeamEntries } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', user.id);

      if (!myTeamEntries?.length) {
        setLoading(false);
        return;
      }

      const teamIds = myTeamEntries.map(t => t.team_id);

      // 2. Get team details
      const { data: teamsData } = await supabase
        .from('teams')
        .select('id, name, color, board_id')
        .in('id', teamIds);

      const teams: MyTeamInfo[] = (teamsData || []).map(t => ({
        teamId: t.id,
        teamName: t.name,
        teamColor: t.color || '#3b82f6',
        boardId: t.board_id || null,
      }));
      setMyTeams(teams);

      const activeTeamId = teamId || selectedTeamId || teams[0]?.teamId;
      if (!activeTeamId) { setLoading(false); return; }
      if (!selectedTeamId) setSelectedTeamId(activeTeamId);

      // 3. Get members of selected team
      const { data: teamMembersData } = await supabase
        .from('team_members')
        .select('user_id')
        .eq('team_id', activeTeamId);

      const memberIds = teamMembersData?.map(m => m.user_id) || [];
      if (!memberIds.length) { setLoading(false); return; }

      // 4. Get profiles
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', memberIds);

      const profileMap = new Map(profiles?.map(p => [p.user_id, p.full_name]) || []);

      // 5. Get today's stats for all members
      const now = new Date();
      const startDate = startOfDay(now).toISOString();
      const endDate = endOfDay(now).toISOString();

      const [contactsRes, leadsRes, activityRes, stageRes, callsRes, dmsRes] = await Promise.all([
        supabase.from('contacts').select('id, created_by')
          .in('created_by', memberIds)
          .gte('created_at', startDate).lte('created_at', endDate),
        supabase.from('leads').select('id, created_by, status')
          .in('created_by', memberIds)
          .gte('created_at', startDate).lte('created_at', endDate),
        supabase.from('user_activity_log').select('user_id, action_type')
          .in('user_id', memberIds)
          .gte('created_at', startDate).lte('created_at', endDate),
        supabase.from('lead_stage_history').select('id, changed_by, to_stage')
          .in('changed_by', memberIds)
          .gte('changed_at', startDate).lte('changed_at', endDate),
        supabase.from('call_records').select('id, user_id')
          .in('user_id', memberIds)
          .gte('created_at', startDate).lte('created_at', endDate),
        supabase.from('dm_history').select('id, user_id')
          .in('user_id', memberIds)
          .gte('created_at', startDate).lte('created_at', endDate),
      ]);

      // Build per-member stats
      const statsMap = new Map<string, { leads: number; checklist: number; stages: number; closed: number; contacts: number; calls: number; dms: number }>();
      memberIds.forEach(id => statsMap.set(id, { leads: 0, checklist: 0, stages: 0, closed: 0, contacts: 0, calls: 0, dms: 0 }));

      (contactsRes.data || []).forEach(c => {
        if (c.created_by && statsMap.has(c.created_by)) statsMap.get(c.created_by)!.contacts++;
      });
      (leadsRes.data || []).forEach(l => {
        if (l.created_by && statsMap.has(l.created_by)) {
          statsMap.get(l.created_by)!.leads++;
        }
      });
      // Count closed - deduplicate by lead_id (one close per lead)
      const CLOSED_PATTERNS = ['closed', 'fechado', 'fechados', 'done'];
      const isClosedStageId = (id: string) => {
        const lower = id.toLowerCase();
        return CLOSED_PATTERNS.some(p => lower === p || lower.startsWith(p + '_'));
      };
      const closedByUser = new Map<string, Set<string>>();
      (stageRes.data || []).forEach(s => {
        const changedBy = (s as any).changed_by;
        const toStage = (s as any).to_stage;
        const leadId = (s as any).lead_id;
        if (changedBy && statsMap.has(changedBy) && toStage && isClosedStageId(toStage) && leadId) {
          if (!closedByUser.has(changedBy)) closedByUser.set(changedBy, new Set());
          closedByUser.get(changedBy)!.add(leadId);
        }
      });
      closedByUser.forEach((leadIds, userId) => {
        if (statsMap.has(userId)) statsMap.get(userId)!.closed = leadIds.size;
      });
      (activityRes.data || []).forEach(a => {
        if (statsMap.has(a.user_id)) {
          if (a.action_type === 'checklist_item_checked') statsMap.get(a.user_id)!.checklist++;
          if (a.action_type === 'checklist_item_unchecked') {
            const currentChecklist = statsMap.get(a.user_id)!.checklist;
            statsMap.get(a.user_id)!.checklist = Math.max(0, currentChecklist - 1);
          }
        }
      });
      (stageRes.data || []).forEach(s => {
        const changedBy = (s as any).changed_by;
        if (changedBy && statsMap.has(changedBy)) statsMap.get(changedBy)!.stages++;
      });
      (callsRes.data || []).forEach(c => {
        if (c.user_id && statsMap.has(c.user_id)) statsMap.get(c.user_id)!.calls++;
      });
      (dmsRes.data || []).forEach(d => {
        if (d.user_id && statsMap.has(d.user_id)) statsMap.get(d.user_id)!.dms++;
      });

      // Build ranking
      const entries: TeamRankingEntry[] = memberIds.map(id => {
        const s = statsMap.get(id)!;
        // Ensure no individual metric goes negative
        const safeChecklist = Math.max(0, s.checklist);
        const rawTotal = s.leads + safeChecklist + s.stages + s.contacts + s.closed + s.calls + s.dms;
        return {
          userId: id,
          userName: profileMap.get(id) || null,
          totalPoints: Math.max(0, rawTotal),
          leadsCreated: s.leads,
          checklistItemsChecked: safeChecklist,
          stageChanges: s.stages,
          leadsClosed: s.closed,
          contactsCreated: s.contacts,
          callsMade: s.calls,
          dmsSent: s.dms,
          isCurrentUser: id === user.id,
        };
      }).sort((a, b) => b.totalPoints - a.totalPoints);

      setRanking(entries);
      const pos = entries.findIndex(e => e.isCurrentUser);
      setMyPosition(pos >= 0 ? pos + 1 : null);
    } catch (error) {
      console.error('Error fetching team ranking:', error);
    } finally {
      setLoading(false);
    }
  }, [user, selectedTeamId]);

  const selectTeam = useCallback((teamId: string) => {
    setSelectedTeamId(teamId);
    fetchRanking(teamId);
  }, [fetchRanking]);

  return { ranking, myTeams, selectedTeamId, selectTeam, myPosition, loading, fetchRanking };
}
