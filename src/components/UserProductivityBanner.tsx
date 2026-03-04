import { useState, useEffect, useMemo, useCallback } from 'react';
import { useMyProductivity } from '@/hooks/useMyProductivity';
import { useSession } from '@/contexts/SessionContext';
import { useMyTeamRanking } from '@/hooks/useMyTeamRanking';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTimeBlockSettings } from '@/hooks/useTimeBlockSettings';
import { useAuthContext } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { MemberProductivitySheet } from '@/components/team/MemberProductivitySheet';
import { DailyReportDialog } from '@/components/team/DailyReportDialog';
import type { UserProductivity } from '@/hooks/useTeamProductivity';
import { startOfDay, endOfDay } from 'date-fns';
import { Progress } from '@/components/ui/progress';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { MetricDetailSheet, type MetricKey } from '@/components/MetricDetailSheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  ChevronDown,
  ChevronUp,
  Trophy,
  MessageSquare,
  Send,
  Users,
  Target,
  Phone,
  ListChecks,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowRightLeft,
  Briefcase,
  Medal,
  Eye,
  Circle,
  FileText,
} from 'lucide-react';

const METRICS = [
  { key: 'commentReplies', label: 'Comentários Enviados', icon: MessageSquare, color: 'text-blue-500' },
  { key: 'dmsSent', label: 'DMs', icon: Send, color: 'text-violet-500' },
  { key: 'contactsCreated', label: 'Contatos', icon: Users, color: 'text-teal-500' },
  { key: 'leadsCreated', label: 'Leads', icon: Target, color: 'text-indigo-500' },
  { key: 'callsMade', label: 'Ligações', icon: Phone, color: 'text-green-500', hasBreakdown: true },
  { key: 'stageChanges', label: 'Fases', icon: ArrowRightLeft, color: 'text-amber-500' },
  { key: 'leadsProgressed', label: 'Leads Progr.', icon: Briefcase, color: 'text-purple-500' },
  { key: 'checklistItemsChecked', label: 'Passos', icon: ListChecks, color: 'text-cyan-500' },
  { key: 'activitiesCompleted', label: 'Ativ. Concl.', icon: CheckCircle2, color: 'text-emerald-500' },
  { key: 'activitiesOverdue', label: 'Atrasadas', icon: AlertTriangle, color: 'text-red-500' },
  { key: 'leadsClosed', label: 'Fechados', icon: Trophy, color: 'text-yellow-500' },
] as const;

// Pages where the banner should NOT be shown
const HIDDEN_ROUTES = ['/dashboard', '/expense-form'];

export function UserProductivityBanner() {
  const { user, profile } = useAuthContext();
  const { sessionStartedAt } = useSession();
  const { data, goals, goalProgress, loading } = useMyProductivity(sessionStartedAt);
  const { ranking, myTeams, selectedTeamId, selectTeam, myPosition, loading: rankingLoading, fetchRanking } = useMyTeamRanking();
  const { configs: timeBlocks } = useTimeBlockSettings();
  const [expanded, setExpanded] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [rankingFetched, setRankingFetched] = useState(false);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [metricSheetOpen, setMetricSheetOpen] = useState(false);
  const [selectedMetricKey, setSelectedMetricKey] = useState<MetricKey | null>(null);
  const [watchedUserIds, setWatchedUserIds] = useState<Set<string>>(new Set());
  const [showUserPicker, setShowUserPicker] = useState(false);
  const [allMembers, setAllMembers] = useState<{ userId: string; name: string }[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [showBlockPicker, setShowBlockPicker] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const today = useMemo(() => ({ start: startOfDay(new Date()), end: endOfDay(new Date()) }), []);

  const memberForSheet = useMemo<(UserProductivity & { displayName: string }) | null>(() => {
    if (!user) return null;
    return {
      userId: user.id,
      userName: profile?.full_name || null,
      email: user.email || null,
      displayName: profile?.full_name?.split(' ')[0] || 'Você',
      commentReplies: data.commentReplies,
      dmsSent: data.dmsSent,
      contactsCreated: data.contactsCreated,
      leadsCreated: data.leadsCreated,
      leadsClosed: data.leadsClosed,
      leadsProgressed: data.leadsProgressed,
      callsMade: data.callsMade,
      stageChanges: data.stageChanges,
      checklistItemsChecked: data.checklistItemsChecked,
      activitiesCompleted: data.activitiesCompleted,
      activitiesOverdue: data.activitiesOverdue,
      sessionMinutes: data.sessionMinutes,
      totalActions: data.totalActions,
      contactsLinked: 0,
      dmsReceived: 0,
      followupsCreated: 0,
      followupsDone: 0,
      pageVisits: 0,
      metaLeadsReceived: 0,
      metaLeadsQualified: 0,
      metaCreativesUploaded: 0,
    };
  }, [user, profile, data]);

  // Reset expanded on navigation
  useEffect(() => {
    setExpanded(false);
  }, [location.pathname]);

  // Fetch ranking when expanded or when watching users
  useEffect(() => {
    if ((expanded || watchedUserIds.size > 0) && !rankingFetched) {
      fetchRanking();
      setRankingFetched(true);
    }
  }, [expanded, rankingFetched, fetchRanking, watchedUserIds.size]);

  // Fetch all members when picker opens
  const fetchAllMembers = useCallback(async () => {
    if (membersLoaded || !user) return;
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, full_name')
      .neq('user_id', user.id)
      .order('full_name');
    if (profiles) {
      setAllMembers(profiles.map(p => ({ userId: p.user_id, name: p.full_name || 'Sem nome' })));
    }
    setMembersLoaded(true);
  }, [user, membersLoaded]);

  // Current time block activity
  const currentActivity = useMemo(() => {
    if (!timeBlocks.length) return null;
    const now = new Date();
    const jsDay = now.getDay();
    const currentDay = jsDay === 0 ? 6 : jsDay - 1;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    
    return timeBlocks.find(block => {
      const blockStart = block.startHour * 60 + (block.startMinute ?? 0);
      const blockEnd = block.endHour * 60 + (block.endMinute ?? 0);
      return block.days.includes(currentDay) && currentMinutes >= blockStart && currentMinutes < blockEnd;
    }) || null;
  }, [timeBlocks]);

  // Countdown timer for current activity block
  const [countdown, setCountdown] = useState('');
  useEffect(() => {
    if (!currentActivity) { setCountdown(''); return; }
    const tick = () => {
      const now = new Date();
      const endMs = new Date(now);
      endMs.setHours(currentActivity.endHour, currentActivity.endMinute ?? 0, 0, 0);
      const diff = endMs.getTime() - now.getTime();
      if (diff <= 0) { setCountdown('0min'); return; }
      const totalMins = Math.floor(diff / 60000);
      const hrs = Math.floor(totalMins / 60);
      const mins = totalMins % 60;
      setCountdown(hrs > 0 ? `${hrs}h${mins > 0 ? `${String(mins).padStart(2,'0')}min` : ''}` : `${mins}min`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [currentActivity]);

  // All blocks for today, sorted by time
  const todayBlocks = useMemo(() => {
    if (!timeBlocks.length) return [];
    const now = new Date();
    const jsDay = now.getDay();
    const dayOfWeek = jsDay === 0 ? 6 : jsDay - 1; // Convert to 0=Mon
    return timeBlocks
      .filter(b => b.days.includes(dayOfWeek))
      .sort((a, b) => (a.startHour * 60 + (a.startMinute ?? 0)) - (b.startHour * 60 + (b.startMinute ?? 0)));
  }, [timeBlocks]);

  const navigateToActivitiesWithType = useCallback((activityType: string) => {
    localStorage.setItem('page_state_activities_filterType', JSON.stringify([activityType]));
    setShowBlockPicker(false);
    if (location.pathname === '/') {
      // Force re-render by dispatching storage event
      window.dispatchEvent(new Event('storage'));
      window.location.reload();
    } else {
      navigate('/');
    }
  }, [navigate, location.pathname]);

  const filteredRanking = useMemo(() => {
    if (watchedUserIds.size === 0) return ranking;
    return ranking.filter(e => e.isCurrentUser || watchedUserIds.has(e.userId));
  }, [ranking, watchedUserIds]);

  const watchedUsersData = useMemo(() => {
    if (watchedUserIds.size === 0) return [];
    const result: Array<{ userId: string; userName: string | null; totalPoints: number; leadsCreated: number; checklistItemsChecked: number; stageChanges: number; leadsClosed: number; contactsCreated: number; inRanking: boolean }> = [];
    watchedUserIds.forEach(id => {
      const rankEntry = ranking.find(r => r.userId === id);
      if (rankEntry && !rankEntry.isCurrentUser) {
        result.push({ ...rankEntry, inRanking: true });
      } else if (!rankEntry) {
        const member = allMembers.find(m => m.userId === id);
        result.push({
          userId: id,
          userName: member?.name || null,
          totalPoints: 0, leadsCreated: 0, checklistItemsChecked: 0,
          stageChanges: 0, leadsClosed: 0, contactsCreated: 0,
          inRanking: false,
        });
      }
    });
    return result;
  }, [ranking, watchedUserIds, allMembers]);

  // Fetch time block settings for watched users
  interface WatchedBlockInfo {
    label: string; color: string; activityType: string;
    startHour: number; startMinute: number; endHour: number; endMinute: number;
    isCurrent: boolean;
  }
  const [watchedUserBlocks, setWatchedUserBlocks] = useState<Record<string, { current: WatchedBlockInfo | null; todayBlocks: WatchedBlockInfo[] }>>({});
  const [expandedWatchedRoutine, setExpandedWatchedRoutine] = useState<Set<string>>(new Set());
  const [watchedBlockActivities, setWatchedBlockActivities] = useState<Record<string, { title: string; status: string; leadName: string | null }[]>>({});
  const [watchedBlockMetrics, setWatchedBlockMetrics] = useState<Record<string, {
    calls: number; callsAnswered: number; callsUnanswered: number;
    leads: number; contacts: number; dms: number; comments: number;
    stageChanges: number; checklistItems: number; activitiesCompleted: number;
    leadNames: string[];
  }>>({});
  // Logged-in user's block expansion state
  const [expandedMyBlocks, setExpandedMyBlocks] = useState<Set<string>>(new Set());
  const [blockMetricSheet, setBlockMetricSheet] = useState<{
    open: boolean; metricKey: import('@/components/MetricDetailSheet').MetricKey | null;
    userId: string; userName: string; dateRange: { start: Date; end: Date };
  }>({ open: false, metricKey: null, userId: '', userName: '', dateRange: { start: new Date(), end: new Date() } });
  
  useEffect(() => {
    if (watchedUserIds.size === 0) {
      setWatchedUserBlocks({});
      return;
    }
    const userIdsArr = Array.from(watchedUserIds);
    
    const fetchBlocks = async () => {
      const { data: settingsData } = await supabase
        .from('user_timeblock_settings')
        .select('*')
        .in('user_id', userIdsArr);
      
      const { data: typesData } = await supabase
        .from('activity_types')
        .select('key, label, color');
      
      if (!settingsData || !typesData) return;
      
      const now = new Date();
      const jsDay = now.getDay();
      const currentDay = jsDay === 0 ? 6 : jsDay - 1;
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      
      const result: Record<string, { current: WatchedBlockInfo | null; todayBlocks: WatchedBlockInfo[] }> = {};
      
      userIdsArr.forEach(uid => {
        const userSettings = settingsData.filter((s: any) => s.user_id === uid);
        const todaySettings = userSettings.filter((s: any) => {
          const days = (s.days as number[]) || [];
          return days.includes(currentDay);
        });
        
        const blocks: WatchedBlockInfo[] = todaySettings.map((s: any) => {
          const typeInfo = typesData.find((t: any) => t.key === s.activity_type);
          const startMin = s.start_hour * 60 + (s.start_minute ?? 0);
          const endMin = s.end_hour * 60 + (s.end_minute ?? 0);
          return {
            label: typeInfo?.label || s.activity_type,
            color: typeInfo?.color || '#888',
            activityType: s.activity_type,
            startHour: s.start_hour,
            startMinute: s.start_minute ?? 0,
            endHour: s.end_hour,
            endMinute: s.end_minute ?? 0,
            isCurrent: currentMinutes >= startMin && currentMinutes < endMin,
          };
        }).sort((a: WatchedBlockInfo, b: WatchedBlockInfo) => (a.startHour * 60 + a.startMinute) - (b.startHour * 60 + b.startMinute));
        
        result[uid] = {
          current: blocks.find(b => b.isCurrent) || null,
          todayBlocks: blocks,
        };
      });
      
      setWatchedUserBlocks(result);
    };
    
    fetchBlocks();
    const interval = setInterval(fetchBlocks, 60000);
    return () => clearInterval(interval);
  }, [watchedUserIds]);

  // Countdown for watched users (updates every second)
  const [watchedCountdowns, setWatchedCountdowns] = useState<Record<string, string>>({});
  useEffect(() => {
    const entries = Object.entries(watchedUserBlocks).filter(([, v]) => v.current !== null);
    if (entries.length === 0) { setWatchedCountdowns({}); return; }
    
    const tick = () => {
      const now = new Date();
      const result: Record<string, string> = {};
      entries.forEach(([id, v]) => {
        const block = v.current!;
        const endMs = new Date(now);
        endMs.setHours(block.endHour, block.endMinute, 0, 0);
        const diff = endMs.getTime() - now.getTime();
        if (diff <= 0) { result[id] = '0min'; return; }
        const totalMins = Math.floor(diff / 60000);
        const hrs = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        result[id] = hrs > 0 ? `${hrs}h${mins > 0 ? `${String(mins).padStart(2, '0')}min` : ''}` : `${mins}min`;
      });
      setWatchedCountdowns(result);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [watchedUserBlocks]);

  // Fetch activities AND metrics for a watched user's time block
  const fetchWatchedBlockActivities = useCallback(async (userId: string, activityType: string, blockStartH?: number, blockStartM?: number, blockEndH?: number, blockEndM?: number) => {
    const key = `${userId}_${activityType}_${blockStartH ?? 0}${blockStartM ?? 0}_${blockEndH ?? 23}${blockEndM ?? 59}`;
    const todayStart = startOfDay(new Date()).toISOString();
    const todayEnd = endOfDay(new Date()).toISOString();

    // Calculate block time range for metrics
    const now = new Date();
    const blockStart = new Date(now);
    blockStart.setHours(blockStartH ?? 0, blockStartM ?? 0, 0, 0);
    const blockEnd = new Date(now);
    blockEnd.setHours(blockEndH ?? 23, blockEndM ?? 59, 59, 999);
    const bStart = blockStart.toISOString();
    const bEnd = blockEnd.toISOString();

    const [activitiesRes, callsRes, leadsRes, contactsRes, dmsRes, commentsRes, stageRes, checklistRes, completedRes] = await Promise.all([
      supabase.from('lead_activities').select('title, status, lead_name')
        .eq('assigned_to', userId).eq('activity_type', activityType)
        .gte('created_at', todayStart).lte('created_at', todayEnd)
        .order('created_at', { ascending: false }).limit(20),
      supabase.from('call_records').select('id, call_result')
        .eq('user_id', userId).gte('created_at', bStart).lte('created_at', bEnd),
      supabase.from('leads').select('id, lead_name')
        .eq('created_by', userId).gte('created_at', bStart).lte('created_at', bEnd),
      supabase.from('contacts').select('id')
        .eq('created_by', userId).gte('created_at', bStart).lte('created_at', bEnd),
      supabase.from('dm_history').select('id')
        .eq('user_id', userId).neq('action_type', 'received')
        .gte('created_at', bStart).lte('created_at', bEnd),
      supabase.from('instagram_comments').select('id')
        .eq('replied_by', userId).gte('replied_at', bStart).lte('replied_at', bEnd),
      supabase.from('lead_stage_history').select('id')
        .eq('changed_by', userId).gte('changed_at', bStart).lte('changed_at', bEnd),
      supabase.from('user_activity_log').select('id')
        .eq('user_id', userId).eq('action_type', 'checklist_item_checked')
        .gte('created_at', bStart).lte('created_at', bEnd),
      supabase.from('lead_activities').select('id')
        .eq('status', 'concluida').eq('completed_by', userId)
        .gte('completed_at', bStart).lte('completed_at', bEnd),
    ]);

    const calls = callsRes.data || [];
    setWatchedBlockActivities(prev => ({
      ...prev,
      [key]: (activitiesRes.data || []).map(d => ({ title: d.title, status: d.status, leadName: d.lead_name })),
    }));
    const leadsData = leadsRes.data || [];
    setWatchedBlockMetrics(prev => ({
      ...prev,
      [key]: {
        calls: calls.length,
        callsAnswered: calls.filter(c => c.call_result === 'atendida').length,
        callsUnanswered: calls.filter(c => c.call_result !== 'atendida').length,
        leads: leadsData.length,
        contacts: (contactsRes.data || []).length,
        dms: (dmsRes.data || []).length,
        comments: (commentsRes.data || []).length,
        stageChanges: (stageRes.data || []).length,
        checklistItems: (checklistRes.data || []).length,
        activitiesCompleted: (completedRes.data || []).length,
        leadNames: leadsData.map((l: any) => l.lead_name || 'Sem nome').filter(Boolean),
      },
    }));
  }, []);

  const toggleWatchedRoutine = (userId: string) => {
    setExpandedWatchedRoutine(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const [expandedWatchedBlocks, setExpandedWatchedBlocks] = useState<Set<string>>(new Set());
  const toggleWatchedBlock = (userId: string, activityType: string, startH?: number, startM?: number, endH?: number, endM?: number) => {
    const key = `${userId}_${activityType}_${startH ?? 0}${startM ?? 0}_${endH ?? 23}${endM ?? 59}`;
    setExpandedWatchedBlocks(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        fetchWatchedBlockActivities(userId, activityType, startH, startM, endH, endM);
      }
      return next;
    });
  };

  const toggleMyBlock = (activityType: string, startH: number, startM: number, endH: number, endM: number) => {
    if (!user) return;
    const key = `${user.id}_${activityType}_${startH}${startM}_${endH}${endM}`;
    setExpandedMyBlocks(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        fetchWatchedBlockActivities(user.id, activityType, startH, startM, endH, endM);
      }
      return next;
    });
  };

  const filteredMembers = useMemo(() => {
    if (!memberSearch.trim()) return allMembers;
    const q = memberSearch.toLowerCase();
    return allMembers.filter(m => m.name.toLowerCase().includes(q));
  }, [allMembers, memberSearch]);

  // Don't show for unauthenticated users or on certain pages
  if (!user || loading || HIDDEN_ROUTES.some(r => location.pathname.startsWith(r))) {
    return null;
  }

  const firstName = profile?.full_name?.split(' ')[0] || 'Usuário';

  const toggleWatchedUser = (userId: string) => {
    setWatchedUserIds(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };


  const openMetricSheet = (key: MetricKey) => {
    setSelectedMetricKey(key);
    setMetricSheetOpen(true);
  };

  // Key metrics for compact view
  const compactMetrics = [
    { key: 'leadsCreated' as MetricKey, label: 'Leads', value: data.leadsCreated, icon: Target, color: 'text-indigo-500' },
    { key: 'checklistItemsChecked' as MetricKey, label: 'Passos', value: data.checklistItemsChecked, icon: ListChecks, color: 'text-cyan-500' },
    { key: 'stageChanges' as MetricKey, label: 'Fases', value: data.stageChanges, icon: ArrowRightLeft, color: 'text-amber-500' },
    { key: 'leadsClosed' as MetricKey, label: 'Fechados', value: data.leadsClosed, icon: Trophy, color: 'text-yellow-500' },
    { key: 'contactsCreated' as MetricKey, label: 'Contatos', value: data.contactsCreated, icon: Users, color: 'text-teal-500' },
  ];

  // Goal items for detail view
  const goalItems = [
    { label: 'Comentários Enviados', current: data.commentReplies, target: goals.target_replies },
    { label: 'DMs', current: data.dmsSent, target: goals.target_dms },
    { label: 'Leads', current: data.leadsCreated, target: goals.target_leads },
    { label: 'Tempo', current: data.sessionMinutes, target: goals.target_session_minutes, suffix: 'min' },
  ];

  const progressColor = goalProgress >= 100 ? 'text-green-500' : goalProgress >= 50 ? 'text-amber-500' : 'text-red-500';

  const positionIcon = (pos: number) => {
    if (pos === 1) return '🥇';
    if (pos === 2) return '🥈';
    if (pos === 3) return '🥉';
    return `${pos}º`;
  };

  return (
    <>
    <div className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {/* Compact bar - always visible */}
      <div className="flex items-center gap-3 px-4 py-2">
        {/* User & goal progress */}
        <div className="flex items-center gap-2 min-w-0">
          <Trophy className="h-4 w-4 text-primary flex-shrink-0" />
          <span className="text-sm font-medium truncate">{firstName}</span>
          <Badge variant="outline" className={`text-xs font-bold ${progressColor} flex-shrink-0`}>
            <AnimatedNumber value={goalProgress} suffix="%" />
          </Badge>
          {myPosition && (
            <Badge variant="secondary" className="text-xs font-bold flex-shrink-0">
              {positionIcon(myPosition)}
            </Badge>
          )}
        </div>

        {/* Current activity from routine - clickable popover */}
        {todayBlocks.length > 0 && (
          <Popover open={showBlockPicker} onOpenChange={setShowBlockPicker}>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-1 flex-shrink-0 rounded-md px-1.5 py-0.5 hover:bg-muted/50 transition-colors">
                {currentActivity ? (
                  <div className="flex items-center gap-1.5">
                    <Badge 
                      className="text-[10px] h-5 px-1.5 border-0 font-medium cursor-pointer"
                      style={{ backgroundColor: currentActivity.color + '22', color: currentActivity.color }}
                    >
                      {currentActivity.label}
                    </Badge>
                    {countdown && (
                      <span className="text-[10px] font-mono font-bold text-destructive tabular-nums">
                        ⏱ {countdown}
                      </span>
                    )}
                  </div>
                ) : (
                  <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-medium cursor-pointer text-muted-foreground">
                    Rotina
                  </Badge>
                )}
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-2 max-h-[70vh] overflow-y-auto" align="start">
              <p className="text-xs font-medium mb-2 text-muted-foreground">Blocos de hoje:</p>
              <div className="space-y-1">
                {todayBlocks.map((block, i) => {
                  const isCurrent = currentActivity?.blockId === block.blockId && currentActivity?.startHour === block.startHour;
                  const fmt = (h: number, m: number = 0) => `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
                  const blockKey = user ? `${user.id}_${block.activityType}_${block.startHour}${block.startMinute ?? 0}_${block.endHour}${block.endMinute ?? 0}` : '';
                  const isBlockExpanded = expandedMyBlocks.has(blockKey);
                  const metrics = watchedBlockMetrics[blockKey];
                  const activities = watchedBlockActivities[blockKey];
                  return (
                    <div key={block.blockId || `${block.activityType}_${i}`}>
                      <button
                        onClick={() => toggleMyBlock(block.activityType, block.startHour, block.startMinute ?? 0, block.endHour, block.endMinute ?? 0)}
                        className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60 ${isCurrent ? 'ring-1 ring-primary bg-muted/40' : ''}`}
                      >
                        <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${block.color}`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">{block.label}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {fmt(block.startHour, block.startMinute)}–{fmt(block.endHour, block.endMinute)}
                          </div>
                        </div>
                        {isCurrent && (
                          <Badge variant="secondary" className="text-[9px] h-4 px-1">Agora</Badge>
                        )}
                        <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${isBlockExpanded ? 'rotate-180' : ''}`} />
                      </button>
                      {isBlockExpanded && (
                        <div className="ml-5 mt-1 mb-2">
                          {metrics ? (
                            <div className="flex flex-wrap gap-1.5 py-1">
                              {(() => {
                                const now = new Date();
                                const bStart = new Date(now); bStart.setHours(block.startHour, block.startMinute ?? 0, 0, 0);
                                const bEnd = new Date(now); bEnd.setHours(block.endHour, block.endMinute ?? 0, 0, 0);
                                const openSheet = (mk: MetricKey) => {
                                  setBlockMetricSheet({ open: true, metricKey: mk, userId: user?.id || '', userName: firstName, dateRange: { start: bStart, end: bEnd } });
                                };
                                const badgeItems: { key: MetricKey; val: number; icon: React.ElementType; color: string; label?: string }[] = [
                                  { key: 'callsMade', val: metrics.calls, icon: Phone, color: 'text-green-500', label: ` (${metrics.callsAnswered}✅ ${metrics.callsUnanswered}❌)` },
                                  { key: 'leadsCreated', val: metrics.leads, icon: Target, color: 'text-indigo-500' },
                                  { key: 'contactsCreated', val: metrics.contacts, icon: Users, color: 'text-teal-500' },
                                  { key: 'dmsSent', val: metrics.dms, icon: Send, color: 'text-violet-500' },
                                  { key: 'commentReplies', val: metrics.comments, icon: MessageSquare, color: 'text-blue-500' },
                                  { key: 'stageChanges', val: metrics.stageChanges, icon: ArrowRightLeft, color: 'text-amber-500' },
                                  { key: 'checklistItemsChecked', val: metrics.checklistItems, icon: ListChecks, color: 'text-cyan-500' },
                                  { key: 'activitiesCompleted', val: metrics.activitiesCompleted, icon: CheckCircle2, color: 'text-emerald-500' },
                                ];
                                const visibleBadges = badgeItems.filter(b => b.val > 0);
                                if (visibleBadges.length === 0) return <span className="text-[10px] text-muted-foreground italic">Sem métricas neste bloco</span>;
                                return visibleBadges.map(b => (
                                  <Badge key={b.key} variant="outline" className="text-[9px] h-4 px-1.5 gap-0.5 cursor-pointer hover:bg-muted transition-colors"
                                    onClick={(e) => { e.stopPropagation(); openSheet(b.key); }}>
                                    <b.icon className={`h-2.5 w-2.5 ${b.color}`} /> {b.val}{b.label || ''}
                                  </Badge>
                                ));
                              })()}
                            </div>
                          ) : (
                            <p className="text-[10px] text-muted-foreground py-1">Carregando...</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        )}

        {/* Progress bar */}
        <div className="w-20 flex-shrink-0">
          <Progress value={goalProgress} className="h-2" />
        </div>

        {/* Divider */}
        <div className="h-4 w-px bg-border flex-shrink-0" />

        {/* Compact metrics */}
        <div className="flex items-center gap-3 overflow-x-auto flex-1 min-w-0">
          {compactMetrics.map(m => (
            <div
              key={m.label}
              className="flex items-center gap-1 flex-shrink-0 cursor-pointer hover:bg-muted/50 rounded-md px-1.5 py-0.5 transition-colors"
              onClick={() => openMetricSheet(m.key)}
            >
              <m.icon className={`h-3.5 w-3.5 ${m.color}`} />
              <AnimatedNumber value={m.value} className="text-sm font-semibold" />
              <span className="text-xs text-muted-foreground hidden sm:inline">{m.label}</span>
            </div>
          ))}
        </div>

        {/* Session time */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {data.sessionMinutes >= 60
              ? `${Math.floor(data.sessionMinutes / 60)}h${data.sessionMinutes % 60 > 0 ? ` ${data.sessionMinutes % 60}min` : ''}`
              : `${data.sessionMinutes}min`}
          </span>
        </div>

        {/* Points */}
        <Badge variant="secondary" className="text-xs font-bold flex-shrink-0">
          <AnimatedNumber value={data.totalActions} suffix=" pts" />
        </Badge>

        {/* Watch users picker */}
        <Popover open={showUserPicker} onOpenChange={(open) => {
          if (open) {
            fetchAllMembers();
            if (!rankingFetched) {
              fetchRanking();
              setRankingFetched(true);
            }
          } else {
            setMemberSearch('');
          }
          setShowUserPicker(open);
        }}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" title="Acompanhar membros">
              <Eye className={`h-3.5 w-3.5 ${watchedUserIds.size > 0 ? 'text-primary' : ''}`} />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="end">
            <p className="text-xs font-medium mb-2">Acompanhar membros:</p>
            <Input
              placeholder="Buscar membro..."
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              className="h-7 text-xs mb-2"
            />
            {!membersLoaded ? (
              <p className="text-xs text-muted-foreground text-center py-2">Carregando...</p>
            ) : filteredMembers.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-2">Nenhum membro encontrado</p>
            ) : (
              <div className="space-y-0.5 max-h-[250px] overflow-y-auto">
                {filteredMembers.map(member => {
                  const rankEntry = ranking.find(r => r.userId === member.userId);
                  return (
                    <label
                      key={member.userId}
                      className="flex items-center gap-2 p-1.5 rounded-md hover:bg-muted/50 cursor-pointer text-xs"
                    >
                      <Checkbox
                        checked={watchedUserIds.has(member.userId)}
                        onCheckedChange={() => toggleWatchedUser(member.userId)}
                      />
                      <span className="truncate flex-1">{member.name.split(' ')[0]}</span>
                      {rankEntry && (
                        <span className="text-muted-foreground text-[10px]">{rankEntry.totalPoints} pts</span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
            {watchedUserIds.size > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full mt-2 h-6 text-[10px]"
                onClick={() => setWatchedUserIds(new Set())}
              >
                Limpar seleção ({watchedUserIds.size})
              </Button>
            )}
          </PopoverContent>
        </Popover>

        {/* Daily report */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 flex-shrink-0"
          onClick={() => setReportOpen(true)}
          title="Relatório diário"
        >
          <FileText className="h-4 w-4" />
        </Button>

        {/* Expand/collapse */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 flex-shrink-0"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>

      {/* Watched users compact bars */}
      {watchedUsersData.length > 0 && (
        <div className="border-t">
          {watchedUsersData.map(wu => {
            const globalPos = ranking.findIndex(r => r.userId === wu.userId) + 1;
            const wuBlocks = watchedUserBlocks[wu.userId];
            const currentBlock = wuBlocks?.current;
            const isRoutineExpanded = expandedWatchedRoutine.has(wu.userId);
            return (
              <div key={wu.userId} className="border-b last:border-b-0">
                <div className="flex items-center gap-3 px-4 py-1.5 bg-muted/30">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold text-muted-foreground w-5 text-center">{positionIcon(globalPos)}</span>
                    <span className="text-xs font-medium truncate max-w-[120px]">{wu.userName?.split(' ')[0] || '?'}</span>
                  </div>
                  {/* Current activity badge - clickable to expand routine */}
                  {currentBlock ? (
                    <button
                      onClick={() => toggleWatchedRoutine(wu.userId)}
                      className="flex items-center gap-1.5 flex-shrink-0 rounded-md px-1 py-0.5 hover:bg-muted/50 transition-colors"
                    >
                      <Badge
                        className="text-[10px] h-5 px-1.5 text-white font-semibold cursor-pointer"
                        style={{ backgroundColor: currentBlock.color }}
                      >
                        {currentBlock.label}
                      </Badge>
                      {watchedCountdowns[wu.userId] && (
                        <span className="text-[10px] font-medium text-orange-500 flex items-center gap-0.5">
                          <Clock className="h-3 w-3" />
                          {watchedCountdowns[wu.userId]}
                        </span>
                      )}
                      <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${isRoutineExpanded ? 'rotate-180' : ''}`} />
                    </button>
                  ) : wuBlocks && wuBlocks.todayBlocks.length > 0 ? (
                    <button
                      onClick={() => toggleWatchedRoutine(wu.userId)}
                      className="flex items-center gap-1 flex-shrink-0 rounded-md px-1 py-0.5 hover:bg-muted/50 transition-colors"
                    >
                      <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-medium cursor-pointer text-muted-foreground">
                        Rotina
                      </Badge>
                      <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${isRoutineExpanded ? 'rotate-180' : ''}`} />
                    </button>
                  ) : null}
                  <div className="h-3 w-px bg-border flex-shrink-0" />
                  <div className="flex items-center gap-3 overflow-x-auto flex-1 min-w-0">
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Target className="h-3 w-3 text-indigo-500" />
                      <span className="text-xs font-semibold">{wu.leadsCreated}</span>
                      <span className="text-[10px] text-muted-foreground hidden sm:inline">Leads</span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <ListChecks className="h-3 w-3 text-cyan-500" />
                      <span className="text-xs font-semibold">{wu.checklistItemsChecked}</span>
                      <span className="text-[10px] text-muted-foreground hidden sm:inline">Passos</span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <ArrowRightLeft className="h-3 w-3 text-amber-500" />
                      <span className="text-xs font-semibold">{wu.stageChanges}</span>
                      <span className="text-[10px] text-muted-foreground hidden sm:inline">Fases</span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Trophy className="h-3 w-3 text-yellow-500" />
                      <span className="text-xs font-semibold">{wu.leadsClosed}</span>
                      <span className="text-[10px] text-muted-foreground hidden sm:inline">Fechados</span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Users className="h-3 w-3 text-teal-500" />
                      <span className="text-xs font-semibold">{wu.contactsCreated}</span>
                      <span className="text-[10px] text-muted-foreground hidden sm:inline">Contatos</span>
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-[10px] h-4 px-1 flex-shrink-0">
                    {wu.totalPoints} pts
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 flex-shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => toggleWatchedUser(wu.userId)}
                  >
                    <span className="text-xs">✕</span>
                  </Button>
                </div>
                {/* Expanded routine blocks */}
                {isRoutineExpanded && wuBlocks && (
                  <div className="px-4 py-2 bg-muted/10 border-t space-y-1 ml-7">
                    <p className="text-[10px] font-medium text-muted-foreground mb-1">Blocos de hoje:</p>
                    {wuBlocks.todayBlocks.map((block, i) => {
                      const fmt = (h: number, m: number = 0) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                      const blockKey = `${wu.userId}_${block.activityType}_${block.startHour}${block.startMinute}_${block.endHour}${block.endMinute}`;
                      const isBlockExpanded = expandedWatchedBlocks.has(blockKey);
                      const activities = watchedBlockActivities[blockKey];
                      const metrics = watchedBlockMetrics[blockKey];
                      return (
                        <div key={`${block.activityType}_${i}`}>
                          <button
                            onClick={() => toggleWatchedBlock(wu.userId, block.activityType, block.startHour, block.startMinute, block.endHour, block.endMinute)}
                            className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60 ${block.isCurrent ? 'ring-1 ring-primary bg-muted/40' : ''}`}
                          >
                            <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: block.color }} />
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium truncate">{block.label}</div>
                              <div className="text-[10px] text-muted-foreground">
                                {fmt(block.startHour, block.startMinute)}–{fmt(block.endHour, block.endMinute)}
                              </div>
                            </div>
                            {block.isCurrent && (
                              <Badge variant="secondary" className="text-[9px] h-4 px-1">Agora</Badge>
                            )}
                            <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${isBlockExpanded ? 'rotate-180' : ''}`} />
                          </button>
                          {isBlockExpanded && (
                            <div className="ml-5 mt-1 mb-2">
                              {metrics ? (
                                <div className="flex flex-wrap gap-1.5 py-1">
                                  {(() => {
                                    const now = new Date();
                                    const bStart = new Date(now); bStart.setHours(block.startHour, block.startMinute, 0, 0);
                                    const bEnd = new Date(now); bEnd.setHours(block.endHour, block.endMinute, 0, 0);
                                    const openSheet = (mk: import('@/components/MetricDetailSheet').MetricKey) => {
                                      setBlockMetricSheet({ open: true, metricKey: mk, userId: wu.userId, userName: wu.userName?.split(' ')[0] || '?', dateRange: { start: bStart, end: bEnd } });
                                    };
                                    const badgeItems: { key: import('@/components/MetricDetailSheet').MetricKey; val: number; icon: React.ElementType; color: string; label?: string }[] = [
                                      { key: 'callsMade', val: metrics.calls, icon: Phone, color: 'text-green-500', label: ` (${metrics.callsAnswered}✅ ${metrics.callsUnanswered}❌)` },
                                      { key: 'leadsCreated', val: metrics.leads, icon: Target, color: 'text-indigo-500' },
                                      { key: 'contactsCreated', val: metrics.contacts, icon: Users, color: 'text-teal-500' },
                                      { key: 'dmsSent', val: metrics.dms, icon: Send, color: 'text-violet-500' },
                                      { key: 'commentReplies', val: metrics.comments, icon: MessageSquare, color: 'text-blue-500' },
                                      { key: 'stageChanges', val: metrics.stageChanges, icon: ArrowRightLeft, color: 'text-amber-500' },
                                      { key: 'checklistItemsChecked', val: metrics.checklistItems, icon: ListChecks, color: 'text-cyan-500' },
                                      { key: 'activitiesCompleted', val: metrics.activitiesCompleted, icon: CheckCircle2, color: 'text-emerald-500' },
                                    ];
                                    const visibleBadges = badgeItems.filter(b => b.val > 0);
                                    if (visibleBadges.length === 0) return <span className="text-[10px] text-muted-foreground italic">Sem métricas neste bloco</span>;
                                    return visibleBadges.map(b => (
                                      <Badge key={b.key} variant="outline" className="text-[9px] h-4 px-1.5 gap-0.5 cursor-pointer hover:bg-muted transition-colors"
                                        onClick={() => openSheet(b.key)}>
                                        <b.icon className={`h-2.5 w-2.5 ${b.color}`} /> {b.val}{b.label || ''}
                                      </Badge>
                                    ));
                                  })()}
                                </div>
                              ) : (
                                <p className="text-[10px] text-muted-foreground py-1">Carregando...</p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Expanded detail view */}
      {expanded && (
        <div className="px-4 pb-3 border-t">
          <div className="grid grid-cols-3 gap-4 mt-3">
            {/* All metrics */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Métricas de Hoje</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {METRICS.map(m => {
                  const value = data[m.key as keyof typeof data] as number;
                  const isCallMetric = m.key === 'callsMade';
                  return (
                    <div key={m.key} className="flex items-center gap-1.5 p-1.5 rounded-md bg-muted/50 cursor-pointer hover:bg-muted transition-colors" onClick={() => openMetricSheet(m.key as MetricKey)}
                      title={isCallMetric ? `✅ Atendidas: ${data.callsAnswered} | ❌ Não atendidas: ${data.callsUnanswered}` : undefined}
                    >
                      <m.icon className={`h-3.5 w-3.5 ${m.color} flex-shrink-0`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <AnimatedNumber value={value} className="text-sm font-bold leading-none" />
                          {isCallMetric && value > 0 && (
                            <span className="text-[9px] text-muted-foreground whitespace-nowrap">
                              ({data.callsAnswered}✅ {data.callsUnanswered}❌)
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground truncate">{m.label}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Goal progress */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Meta Diária — <AnimatedNumber value={goalProgress} suffix="%" className={progressColor} />
              </p>
              <div className="space-y-2">
                {goalItems.map(g => {
                  const pct = g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 100;
                  return (
                    <div key={g.label} className="space-y-0.5">
                      <div className="flex justify-between text-xs">
                        <span>{g.label}</span>
                        <span className="font-medium">
                          {g.current}{g.suffix || ''} / {g.target}{g.suffix || ''}
                        </span>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Team Ranking */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Medal className="h-3.5 w-3.5" />
                  Ranking do Time
                  {watchedUserIds.size > 0 && (
                    <Badge variant="outline" className="text-[9px] h-3.5 px-1 ml-1">
                      {watchedUserIds.size} selecionado{watchedUserIds.size > 1 ? 's' : ''}
                    </Badge>
                  )}
                </p>
                <div className="flex items-center gap-1">
                  {ranking.length > 0 && (
                    <Popover open={showUserPicker} onOpenChange={setShowUserPicker}>
                      <PopoverTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6" title="Selecionar usuários">
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-56 p-2" align="end">
                        <p className="text-xs font-medium mb-2">Acompanhar usuários:</p>
                        <div className="space-y-1 max-h-[200px] overflow-y-auto">
                          {ranking.filter(e => !e.isCurrentUser).map(entry => (
                            <label
                              key={entry.userId}
                              className="flex items-center gap-2 p-1.5 rounded-md hover:bg-muted/50 cursor-pointer text-xs"
                            >
                              <Checkbox
                                checked={watchedUserIds.has(entry.userId)}
                                onCheckedChange={() => toggleWatchedUser(entry.userId)}
                              />
                              <span className="truncate">{entry.userName?.split(' ')[0] || '?'}</span>
                              <span className="ml-auto text-muted-foreground">{entry.totalPoints} pts</span>
                            </label>
                          ))}
                        </div>
                        {watchedUserIds.size > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full mt-2 h-6 text-[10px]"
                            onClick={() => setWatchedUserIds(new Set())}
                          >
                            Limpar seleção
                          </Button>
                        )}
                      </PopoverContent>
                    </Popover>
                  )}
                  {myTeams.length > 1 && (
                    <Select value={selectedTeamId || ''} onValueChange={selectTeam}>
                      <SelectTrigger className="h-6 text-[10px] w-auto min-w-[100px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {myTeams.map(t => (
                          <SelectItem key={t.teamId} value={t.teamId}>
                            <span className="flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.teamColor }} />
                              {t.teamName}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>

              {rankingLoading ? (
                <div className="text-xs text-muted-foreground text-center py-4">Carregando...</div>
              ) : ranking.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-4">
                  Você não está em nenhum time
                </div>
              ) : (
                <div className="space-y-1 max-h-[140px] overflow-y-auto">
                  {filteredRanking.map((entry, idx) => {
                    // Show global position from full ranking
                    const globalPos = ranking.findIndex(r => r.userId === entry.userId) + 1;
                    return (
                      <div
                        key={entry.userId}
                        className={`flex items-center gap-2 p-1.5 rounded-md text-xs ${
                          entry.isCurrentUser ? 'bg-primary/10 ring-1 ring-primary/20' : 
                          watchedUserIds.has(entry.userId) ? 'bg-accent/50 ring-1 ring-accent/30' : 'bg-muted/50'
                        }`}
                      >
                        <span className="w-5 text-center font-bold text-muted-foreground">
                          {positionIcon(globalPos)}
                        </span>
                        <span className={`flex-1 truncate ${entry.isCurrentUser ? 'font-semibold' : ''}`}>
                          {entry.isCurrentUser ? 'Você' : (entry.userName?.split(' ')[0] || '?')}
                        </span>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span title="Leads">{entry.leadsCreated}L</span>
                          <span title="DMs">{entry.dmsSent}💬</span>
                          <span title="Passos">{entry.checklistItemsChecked}P</span>
                          <span title="Fases">{entry.stageChanges}F</span>
                          <span title="Ligações">{entry.callsMade}📞</span>
                        </div>
                        <Badge variant="secondary" className="text-[10px] h-4 px-1">
                          {entry.totalPoints} pts
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>

    <MemberProductivitySheet
      member={memberForSheet}
      open={detailSheetOpen}
      onOpenChange={setDetailSheetOpen}
      dateRange={today}
    />
    <MetricDetailSheet
      open={metricSheetOpen}
      onOpenChange={setMetricSheetOpen}
      metricKey={selectedMetricKey}
    />
    <MetricDetailSheet
      open={blockMetricSheet.open}
      onOpenChange={(v) => setBlockMetricSheet(prev => ({ ...prev, open: v }))}
      metricKey={blockMetricSheet.metricKey}
      targetUserId={blockMetricSheet.userId}
      targetUserName={blockMetricSheet.userName}
      dateRangeOverride={blockMetricSheet.dateRange}
    />
    <DailyReportDialog
      open={reportOpen}
      onOpenChange={setReportOpen}
      userId={user?.id || ''}
      userName={profile?.full_name || 'Usuário'}
      productivity={data}
      goals={goals}
      goalProgress={goalProgress}
    />
    </>
  );
}
