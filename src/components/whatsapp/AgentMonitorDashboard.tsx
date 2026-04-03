import { useState, useEffect, useMemo, useCallback } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import {
  Bot, MessageCircle, Clock, TrendingUp, Search, RefreshCw,
  CheckCircle, XCircle, Zap,
  MapPin, Phone, PhoneCall, Megaphone, Sparkles,
  CalendarIcon, Inbox, BarChart3, Heart, AlertCircle, Eye, ClipboardList,
  Square, CheckSquare, StopCircle, ArrowRightLeft, UserPlus, PauseCircle,
  FastForward, Play
} from 'lucide-react';
import { CallQueuePanel } from './CallQueuePanel';
import { FollowupActivityPanel } from './FollowupActivityPanel';
import { AIEnrichmentMonitorPanel } from './AIEnrichmentMonitorPanel';
import { AIRealtimeFeed } from './AIRealtimeFeed';
import { AIActivitiesPanel } from './AIActivitiesPanel';
import { AIActivityPromptDialog } from './AIActivityPromptDialog';
import { DashboardChatPreview } from './DashboardChatPreview';
import { format, differenceInMinutes, subDays, startOfWeek, startOfMonth, startOfYear, endOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';

interface AgentData {
  id: string;
  shortcut_name: string;
  description: string | null;
  is_active: boolean | null;
}

interface ConversationDetail {
  phone: string;
  instance_name: string;
  agent_name: string;
  agent_id: string;
  is_active: boolean;
  is_blocked: boolean;
  human_paused: boolean;
  contact_name: string | null;
  lead_name: string | null;
  lead_id: string | null;
  lead_status: string | null;
  lead_city: string | null;
  lead_state: string | null;
  lead_acolhedor: string | null;
  board_id: string | null;
  board_name: string | null;
  stage_name: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  total_messages: number;
  inbound_count: number;
  outbound_count: number;
  followup_count: number;
  has_followup_config: boolean;
  time_without_response: number | null;
  campaign_name: string | null;
  activated_by: string | null;
  activated_at: string | null;
  whatsapp_group_id: string | null;
  created_at: string | null;
}

interface AgentStats {
  agent_id: string;
  agent_name: string;
  total_conversations: number;
  active_conversations: number;
  paused_conversations: number;
  inactive_conversations: number;
  total_messages_sent: number;
  total_messages_received: number;
  response_rate: number;
  conversations_by_stage: Record<string, number>;
  followups_sent: number;
  leads_closed: number;
  leads_refused: number;
  without_response_count: number;
}

interface ReferralData {
  id: string;
  ambassador_name: string;
  contact_name: string | null;
  lead_name: string | null;
  status: string;
  created_at: string;
  campaign_name: string | null;
}

type CaseStatus = 'sem_resposta' | 'em_andamento' | 'fechado' | 'recusado' | 'inviavel' | 'bloqueado' | 'pausado';

export function AgentMonitorDashboard() {
  const { toast } = useToast();
  const [agents, setAgents] = useState<AgentData[]>([]);
  const [conversations, setConversations] = useState<ConversationDetail[]>([]);
  const [agentStats, setAgentStats] = useState<AgentStats[]>([]);
  const [referrals, setReferrals] = useState<ReferralData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sheetResponseFilter, setSheetResponseFilter] = useState<'all' | 'responded' | 'waiting'>('all');
  const [sheetLeadFilter, setSheetLeadFilter] = useState<'all' | 'com_lead' | 'sem_lead'>('all');
  const [sheetAgentStatusFilter, setSheetAgentStatusFilter] = useState<'all' | 'ativo' | 'pausado'>('all');
  const [sheetFollowupFilter, setSheetFollowupFilter] = useState<'all' | 'com_followup' | 'sem_followup'>('all');
  const [generatingLeadId, setGeneratingLeadId] = useState<string | null>(null);
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const [promptDialogLead, setPromptDialogLead] = useState<{ id: string; name: string } | null>(null);

  // Filters
  const [agentFilter, setAgentFilter] = useState('all');
  const [instanceFilter, setInstanceFilter] = useState('all');
  const [boardFilter, setBoardFilter] = useState('all');
  const [campaignFilter, setCampaignFilter] = useState('all');
  const [caseStatusFilter, setCaseStatusFilter] = useState<CaseStatus | 'all'>('all');
  const [agentActiveFilter, setAgentActiveFilter] = useState<'all' | 'ativo' | 'pausado'>('all');
  const [followupConfigFilter, setFollowupConfigFilter] = useState<'all' | 'com_followup' | 'sem_followup'>('all');
  const [sheetStatusFilter, setSheetStatusFilter] = useState<CaseStatus | null>(null);

  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({ from: subDays(new Date(), 7), to: new Date() });
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [chatPreview, setChatPreview] = useState<ConversationDetail | null>(null);
  
  // Batch selection
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [batchAgentId, setBatchAgentId] = useState<string>('');
  const [batchProcessing, setBatchProcessing] = useState(false);

  const convKey = (c: { phone: string; instance_name: string }) => `${c.phone}|${c.instance_name}`;
  
  const toggleSelection = (c: ConversationDetail) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      const k = convKey(c);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const selectAll = (list: ConversationDetail[]) => {
    setSelectedKeys(new Set(list.map(convKey)));
  };

  const clearSelection = () => setSelectedKeys(new Set());

  const selectedConversations = useMemo(() => {
    return conversations.filter(c => selectedKeys.has(convKey(c)));
  }, [conversations, selectedKeys]);

  const batchAction = async (action: 'pause' | 'assign' | 'swap', agentId?: string) => {
    if (selectedConversations.length === 0) return;
    setBatchProcessing(true);
    try {
      // Get IDs from whatsapp_conversation_agents
      const keys = selectedConversations.map(c => ({ phone: c.phone, instance: c.instance_name }));
      
      for (const { phone, instance } of keys) {
        if (action === 'pause') {
          await supabase
            .from('whatsapp_conversation_agents')
            .update({ is_active: false } as any)
            .eq('phone', phone)
            .eq('instance_name', instance);
        } else if (action === 'assign' && agentId) {
          // Check if exists
          const { data: existing } = await supabase
            .from('whatsapp_conversation_agents')
            .select('id')
            .eq('phone', phone)
            .eq('instance_name', instance)
            .maybeSingle();
          
          if (existing) {
            await supabase
              .from('whatsapp_conversation_agents')
              .update({ agent_id: agentId, is_active: true, human_paused_until: null } as any)
              .eq('phone', phone)
              .eq('instance_name', instance);
          } else {
            await supabase
              .from('whatsapp_conversation_agents')
              .insert({ phone, instance_name: instance, agent_id: agentId, is_active: true } as any);
          }
        } else if (action === 'swap' && agentId) {
          await supabase
            .from('whatsapp_conversation_agents')
            .update({ agent_id: agentId } as any)
            .eq('phone', phone)
            .eq('instance_name', instance);
        }
      }
      
      toast({ title: 'Sucesso', description: `Ação aplicada em ${keys.length} conversas` });
      clearSelection();
      setBatchAgentId('');
      fetchData();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setBatchProcessing(false);
    }
  };

  // Boards data
  const [boards, setBoards] = useState<Array<{ id: string; name: string; stages: any[] }>>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const startDate = dateRange.from.toISOString();
      const endDate = endOfDay(dateRange.to).toISOString();

      // Parallel fetches
      const [agentsRes, convAgentsRes, messagesRes, leadsRes, boardsRes, followupsRes, referralsRes] = await Promise.all([
        supabase.from('wjia_command_shortcuts').select('id, shortcut_name, description, is_active, followup_steps, followup_repeat_forever').order('shortcut_name'),
        supabase.from('whatsapp_conversation_agents').select('*'),
        supabase.from('whatsapp_messages')
          .select('phone, instance_name, direction, created_at, contact_name, lead_id, campaign_name')
          .gte('created_at', startDate).lte('created_at', endDate).order('created_at', { ascending: false }),
        supabase.from('leads')
          .select('id, lead_name, lead_phone, status, lead_status, board_id, city, state, followup_count, campaign_name, acolhedor, whatsapp_group_id, created_at')
          .not('lead_phone', 'is', null),
        supabase.from('kanban_boards').select('id, name, stages'),
        supabase.from('lead_followups').select('lead_id, followup_type').gte('followup_date', startDate).lte('followup_date', endDate),
        supabase.from('ambassador_referrals')
          .select('id, ambassador_id, contact_id, lead_id, status, created_at, campaign_id, notes, member_user_id')
          .gte('created_at', startDate).lte('created_at', endDate).order('created_at', { ascending: false }),
      ]);

      // Campaign names for phones
      const agentPhones = (convAgentsRes.data || []).map((ca: any) => ca.phone);
      const { data: campaignMsgs } = await supabase
        .from('whatsapp_messages')
        .select('phone, instance_name, campaign_name')
        .in('phone', agentPhones)
        .not('campaign_name', 'is', null)
        .limit(2000);

      const campaignByPhone = new Map<string, string>();
      (campaignMsgs || []).forEach((m: any) => {
        const key = `${m.phone}|${m.instance_name}`;
        if (!campaignByPhone.has(key)) campaignByPhone.set(key, m.campaign_name);
      });

      const agentsData = agentsRes.data || [];
      const convAgents = convAgentsRes.data || [];
      const messages = messagesRes.data || [];
      const leads = leadsRes.data || [];
      const boardsData = boardsRes.data || [];
      const followups = followupsRes.data || [];

      setAgents(agentsData as AgentData[]);
      setBoards(boardsData.map((b: any) => ({ id: b.id, name: b.name, stages: b.stages || [] })));

      // Build maps
      const agentMap = new Map(agentsData.map((a: any) => [a.id, a.shortcut_name]));
      const agentFollowupMap = new Map(agentsData.map((a: any) => [a.id, !!(a.followup_steps && Array.isArray(a.followup_steps) && a.followup_steps.length > 0)]));
      const leadPhoneMap = new Map<string, any>();
      leads.forEach((l: any) => {
        if (l.lead_phone) {
          const normalized = l.lead_phone.replace(/\D/g, '');
          leadPhoneMap.set(normalized, l);
          if (normalized.length > 8) leadPhoneMap.set(normalized.slice(-8), l);
        }
      });
      const boardMap = new Map(boardsData.map((b: any) => [b.id, b]));

      // Group messages
      const msgByConv = new Map<string, any[]>();
      messages.forEach((m: any) => {
        const key = `${m.phone}|${m.instance_name}`;
        if (!msgByConv.has(key)) msgByConv.set(key, []);
        msgByConv.get(key)!.push(m);
      });

      const followupsByLead = new Map<string, number>();
      followups.forEach((f: any) => {
        followupsByLead.set(f.lead_id, (followupsByLead.get(f.lead_id) || 0) + 1);
      });

      // Build conversations
      const convDetails: ConversationDetail[] = [];
      convAgents.forEach((ca: any) => {
        const phoneClean = ca.phone?.replace(/\D/g, '') || '';
        if (ca.phone?.includes('@g.us') || phoneClean.startsWith('120363')) return;

        const agentName = agentMap.get(ca.agent_id) || 'Desconhecido';
        const key = `${ca.phone}|${ca.instance_name}`;
        const msgs = msgByConv.get(key) || [];
        const phoneNorm = ca.phone.replace(/\D/g, '');
        const lead = leadPhoneMap.get(phoneNorm) || leadPhoneMap.get(phoneNorm.slice(-8));

        const inboundMsgs = msgs.filter((m: any) => m.direction === 'inbound');
        const outboundMsgs = msgs.filter((m: any) => m.direction === 'outbound');
        const lastInbound = inboundMsgs[0]?.created_at || null;
        const lastOutbound = outboundMsgs[0]?.created_at || null;

        let boardName = null;
        let stageName = null;
        if (lead?.board_id) {
          const board = boardMap.get(lead.board_id);
          if (board) {
            boardName = board.name;
            const stages = board.stages as any[];
            if (stages && lead.status) {
              const stage = stages.find((s: any) => s.id === lead.status);
              stageName = stage?.name || lead.status;
            }
          }
        }

        const isPaused = ca.human_paused_until && new Date(ca.human_paused_until) > new Date();
        const timeWithoutResponse = lastOutbound && !lastInbound
          ? differenceInMinutes(new Date(), new Date(lastOutbound))
          : lastOutbound && lastInbound && new Date(lastOutbound) > new Date(lastInbound)
            ? differenceInMinutes(new Date(), new Date(lastOutbound))
            : null;

        convDetails.push({
          phone: ca.phone,
          instance_name: ca.instance_name,
          agent_name: agentName,
          agent_id: ca.agent_id,
          is_active: ca.is_active,
          is_blocked: ca.is_blocked ?? false,
          human_paused: !!isPaused,
          contact_name: msgs[0]?.contact_name || null,
          lead_name: lead?.lead_name || null,
          lead_id: lead?.id || null,
          lead_status: lead?.lead_status || null,
          lead_city: lead?.city || null,
          lead_state: lead?.state || null,
          lead_acolhedor: lead?.acolhedor || null,
          board_id: lead?.board_id || null,
          board_name: boardName,
          stage_name: stageName,
          last_inbound_at: lastInbound,
          last_outbound_at: lastOutbound,
          total_messages: msgs.length,
          inbound_count: inboundMsgs.length,
          outbound_count: outboundMsgs.length,
          followup_count: lead ? (followupsByLead.get(lead.id) || 0) : 0,
          has_followup_config: agentFollowupMap.get(ca.agent_id) || false,
          time_without_response: timeWithoutResponse,
          campaign_name: campaignByPhone.get(key) || msgs.find((m: any) => m.campaign_name)?.campaign_name || lead?.campaign_name || null,
          activated_by: ca.activated_by || null,
          activated_at: ca.created_at || null,
          whatsapp_group_id: lead?.whatsapp_group_id || null,
          created_at: lead?.created_at || ca.created_at || null,
        });
      });

      setConversations(convDetails);

      // Agent stats
      const statsMap = new Map<string, AgentStats>();
      agentsData.forEach((a: any) => {
        statsMap.set(a.id, {
          agent_id: a.id, agent_name: a.shortcut_name,
          total_conversations: 0, active_conversations: 0, paused_conversations: 0, inactive_conversations: 0,
          total_messages_sent: 0, total_messages_received: 0, response_rate: 0,
          conversations_by_stage: {}, followups_sent: 0, leads_closed: 0, leads_refused: 0, without_response_count: 0,
        });
      });

      convDetails.forEach(c => {
        const stat = statsMap.get(c.agent_id);
        if (!stat) return;
        stat.total_conversations++;
        if (c.is_active && !c.human_paused) stat.active_conversations++;
        else if (c.human_paused) stat.paused_conversations++;
        else stat.inactive_conversations++;
        stat.total_messages_sent += c.outbound_count;
        stat.total_messages_received += c.inbound_count;
        stat.followups_sent += c.followup_count;
        if (c.stage_name) {
          stat.conversations_by_stage[c.stage_name] = (stat.conversations_by_stage[c.stage_name] || 0) + 1;
        }
        if (c.lead_status === 'closed') stat.leads_closed++;
        if (c.lead_status === 'refused') stat.leads_refused++;
        if (c.time_without_response && c.time_without_response > 60) stat.without_response_count++;
      });

      statsMap.forEach(stat => {
        if (stat.total_messages_received > 0) {
          stat.response_rate = Math.round((stat.total_messages_sent / stat.total_messages_received) * 100);
        }
      });

      setAgentStats(Array.from(statsMap.values()));

      // Referrals
      const ambassadorIds = [...new Set((referralsRes.data || []).map((r: any) => r.ambassador_id))];
      let ambassadorNames = new Map<string, string>();
      if (ambassadorIds.length > 0) {
        const { data: contacts } = await supabase.from('contacts').select('id, full_name').in('id', ambassadorIds);
        (contacts || []).forEach((c: any) => ambassadorNames.set(c.id, c.full_name));
      }

      const contactIds = [...new Set((referralsRes.data || []).map((r: any) => r.contact_id).filter(Boolean))];
      let contactNames = new Map<string, string>();
      if (contactIds.length > 0) {
        const { data: contacts } = await supabase.from('contacts').select('id, full_name').in('id', contactIds);
        (contacts || []).forEach((c: any) => contactNames.set(c.id, c.full_name));
      }

      const leadIds = [...new Set((referralsRes.data || []).map((r: any) => r.lead_id).filter(Boolean))];
      let leadNames = new Map<string, string>();
      if (leadIds.length > 0) {
        const { data: lds } = await supabase.from('leads').select('id, lead_name').in('id', leadIds);
        (lds || []).forEach((l: any) => leadNames.set(l.id, l.lead_name));
      }

      const campaignIds = [...new Set((referralsRes.data || []).map((r: any) => r.campaign_id).filter(Boolean))];
      let campaignNames = new Map<string, string>();
      if (campaignIds.length > 0) {
        const { data: camps } = await supabase.from('ambassador_campaigns').select('id, name').in('id', campaignIds);
        (camps || []).forEach((c: any) => campaignNames.set(c.id, c.name));
      }

      setReferrals((referralsRes.data || []).map((r: any) => ({
        id: r.id,
        ambassador_name: ambassadorNames.get(r.ambassador_id) || 'Desconhecido',
        contact_name: r.contact_id ? contactNames.get(r.contact_id) || null : null,
        lead_name: r.lead_id ? leadNames.get(r.lead_id) || null : null,
        status: r.status,
        created_at: r.created_at,
        campaign_name: r.campaign_id ? campaignNames.get(r.campaign_id) || null : null,
      })));

    } catch (error) {
      console.error('Error fetching agent monitor data:', error);
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Derived filter options
  const uniqueInstances = useMemo(() => [...new Set(conversations.map(c => c.instance_name).filter(Boolean))].sort() as string[], [conversations]);
  const uniqueBoards = useMemo(() => {
    const boardIds = new Set(conversations.map(c => c.board_id).filter(Boolean));
    return boards.filter(b => boardIds.has(b.id));
  }, [conversations, boards]);
  const uniqueCampaigns = useMemo(() => [...new Set(conversations.map(c => c.campaign_name).filter(Boolean))].sort() as string[], [conversations]);

  // Classify case status
  const getCaseStatus = (c: ConversationDetail): CaseStatus => {
    if (c.is_blocked) return 'bloqueado';
    if (!c.is_active && !c.is_blocked) return 'pausado';
    if (c.lead_status === 'closed') return 'fechado';
    if (c.lead_status === 'refused') return 'recusado';
    if (c.lead_status === 'unviable') return 'inviavel';
    if (c.inbound_count > 0) return 'em_andamento';
    return 'sem_resposta';
  };

  // Apply filters
  const filteredConversations = useMemo(() => {
    return conversations.filter(c => {
      if (agentFilter !== 'all' && c.agent_id !== agentFilter) return false;
      if (instanceFilter !== 'all' && c.instance_name !== instanceFilter) return false;
      if (boardFilter !== 'all' && c.board_id !== boardFilter) return false;
      if (campaignFilter !== 'all') {
        if (campaignFilter === '__none__' && c.campaign_name) return false;
        if (campaignFilter !== '__none__' && c.campaign_name !== campaignFilter) return false;
      }
      if (caseStatusFilter !== 'all' && getCaseStatus(c) !== caseStatusFilter) return false;
      if (agentActiveFilter === 'ativo' && !c.is_active) return false;
      if (agentActiveFilter === 'pausado' && (c.is_active || c.is_blocked)) return false;
      if (followupConfigFilter === 'com_followup' && !c.has_followup_config) return false;
      if (followupConfigFilter === 'sem_followup' && c.has_followup_config) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return c.phone.includes(q) || c.contact_name?.toLowerCase().includes(q) || c.lead_name?.toLowerCase().includes(q);
      }
      return true;
    });
  }, [conversations, agentFilter, instanceFilter, boardFilter, campaignFilter, caseStatusFilter, agentActiveFilter, followupConfigFilter, searchQuery]);

  // Pipeline counts
  const pipelineCounts = useMemo(() => {
    const base = conversations.filter(c => {
      if (agentFilter !== 'all' && c.agent_id !== agentFilter) return false;
      if (instanceFilter !== 'all' && c.instance_name !== instanceFilter) return false;
      if (boardFilter !== 'all' && c.board_id !== boardFilter) return false;
      if (campaignFilter !== 'all') {
        if (campaignFilter === '__none__' && c.campaign_name) return false;
        if (campaignFilter !== '__none__' && c.campaign_name !== campaignFilter) return false;
      }
      return true;
    });
    return {
      sem_resposta: base.filter(c => getCaseStatus(c) === 'sem_resposta').length,
      em_andamento: base.filter(c => getCaseStatus(c) === 'em_andamento').length,
      fechado: base.filter(c => getCaseStatus(c) === 'fechado').length,
      recusado: base.filter(c => getCaseStatus(c) === 'recusado').length,
      inviavel: base.filter(c => getCaseStatus(c) === 'inviavel').length,
      bloqueado: base.filter(c => getCaseStatus(c) === 'bloqueado').length,
      pausado: base.filter(c => getCaseStatus(c) === 'pausado').length,
    };
  }, [conversations, agentFilter, instanceFilter, boardFilter, campaignFilter]);

  // Referral stats
  const referralStats = useMemo(() => ({
    total: referrals.length,
    pending: referrals.filter(r => r.status === 'pending').length,
    contacted: referrals.filter(r => r.status === 'contacted').length,
    converted: referrals.filter(r => r.status === 'converted').length,
    lost: referrals.filter(r => r.status === 'lost').length,
  }), [referrals]);

  const formatTimeAgo = (minutes: number | null) => {
    if (!minutes) return '-';
    if (minutes < 60) return `${minutes}min`;
    const h = Math.floor(minutes / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  };

  const activatedByLabel = (val: string | null) => {
    switch (val) {
      case 'manual': return 'Manual';
      case 'system': return 'Sistema';
      case 'agent': return 'Agente';
      case 'ctwa_campaign':
      case 'campaign_auto': return 'Anúncio Meta';
      case 'campaign_instance_auto':
      case 'instance_default': return 'Instância';
      case 'broadcast': return 'Lista de Transmissão';
      case 'stage_auto': return 'Troca de Etapa';
      default: return val || '-';
    }
  };

  const statusColor = (s: CaseStatus) => {
    switch (s) {
      case 'sem_resposta': return 'text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800';
      case 'em_andamento': return 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-800';
      case 'fechado': return 'text-green-600 bg-green-50 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800';
      case 'recusado': return 'text-red-600 bg-red-50 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800';
      case 'inviavel': return 'text-muted-foreground bg-muted border-border';
      case 'bloqueado': return 'text-orange-600 bg-orange-50 border-orange-200 dark:bg-orange-950 dark:text-orange-400 dark:border-orange-800';
      case 'pausado': return 'text-gray-600 bg-gray-50 border-gray-200 dark:bg-gray-950 dark:text-gray-400 dark:border-gray-800';
    }
  };

  const statusLabel = (s: CaseStatus) => {
    switch (s) {
      case 'sem_resposta': return 'Sem Resposta';
      case 'em_andamento': return 'Em Andamento';
      case 'fechado': return 'Fechado';
      case 'recusado': return 'Recusado';
      case 'inviavel': return 'Inviável';
      case 'bloqueado': return 'Bloqueado';
      case 'pausado': return 'Pausado';
    }
  };

  // Sort conversations by arrival (newest first for queue)
  const sortedCases = useMemo(() => {
    return [...filteredConversations].sort((a, b) => {
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return dateB - dateA;
    });
  }, [filteredConversations]);

  // Filtered cases for the Sheet panel
  const sheetCases = useMemo(() => {
    if (!sheetStatusFilter) return [];
    return conversations.filter(c => {
      if (agentFilter !== 'all' && c.agent_id !== agentFilter) return false;
      if (instanceFilter !== 'all' && c.instance_name !== instanceFilter) return false;
      if (boardFilter !== 'all' && c.board_id !== boardFilter) return false;
      if (campaignFilter !== 'all') {
        if (campaignFilter === '__none__' && c.campaign_name) return false;
        if (campaignFilter !== '__none__' && c.campaign_name !== campaignFilter) return false;
      }
      return getCaseStatus(c) === sheetStatusFilter;
    }).sort((a, b) => {
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return dateB - dateA;
    });
  }, [conversations, sheetStatusFilter, agentFilter, instanceFilter, boardFilter, campaignFilter]);

  const FilterBar = () => (
    <div className="flex flex-wrap gap-2">
      <Select value={agentFilter} onValueChange={setAgentFilter}>
        <SelectTrigger className="w-[150px] h-8 text-xs">
          <SelectValue placeholder="Agente IA" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos Agentes</SelectItem>
          {agents.map(a => (
            <SelectItem key={a.id} value={a.id}>{a.shortcut_name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {uniqueInstances.length > 1 && (
        <Select value={instanceFilter} onValueChange={setInstanceFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue placeholder="Instância" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas Instâncias</SelectItem>
            {uniqueInstances.map(i => (
              <SelectItem key={i} value={i}>{i}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {uniqueBoards.length > 1 && (
        <Select value={boardFilter} onValueChange={setBoardFilter}>
          <SelectTrigger className="w-[150px] h-8 text-xs">
            <SelectValue placeholder="Funil" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos Funis</SelectItem>
            {uniqueBoards.map(b => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {uniqueCampaigns.length > 0 && (
        <Select value={campaignFilter} onValueChange={setCampaignFilter}>
          <SelectTrigger className="w-[150px] h-8 text-xs">
            <SelectValue placeholder="Origem" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas Origens</SelectItem>
            <SelectItem value="__none__">Sem Campanha</SelectItem>
            {uniqueCampaigns.map(c => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select value={agentActiveFilter} onValueChange={(v) => setAgentActiveFilter(v as 'all' | 'ativo' | 'pausado')}>
        <SelectTrigger className="w-[130px] h-8 text-xs">
          <SelectValue placeholder="Status Agente" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos Status</SelectItem>
          <SelectItem value="ativo">Ativo</SelectItem>
          <SelectItem value="pausado">Pausado</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );

  const CaseCard = ({ c, selectable = false }: { c: ConversationDetail; selectable?: boolean }) => {
    const status = getCaseStatus(c);
    const isSelected = selectedKeys.has(convKey(c));
    return (
      <Card
        className={`cursor-pointer hover:shadow-md transition-shadow ${isSelected ? 'ring-2 ring-primary' : ''}`}
        onClick={() => selectable ? toggleSelection(c) : setChatPreview(c)}
      >
        <CardContent className="p-3">
          <div className="flex items-start gap-2">
            {selectable && (
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => toggleSelection(c)}
                onClick={(e) => e.stopPropagation()}
                className="mt-1 shrink-0"
              />
            )}
            <div className="flex-1 min-w-0" onClick={(e) => { if (selectable) { e.stopPropagation(); setChatPreview(c); } }}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold truncate">{c.contact_name || c.lead_name || c.phone}</span>
                <Badge className={`text-[9px] h-4 border ${statusColor(status)}`}>{statusLabel(status)}</Badge>
              </div>
              <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground flex-wrap">
                <span className="flex items-center gap-0.5"><Bot className="h-3 w-3" /> {c.agent_name}</span>
                <span className="flex items-center gap-0.5"><Phone className="h-3 w-3" /> {c.phone}</span>
                {c.lead_city && <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" /> {c.lead_city}{c.lead_state ? `/${c.lead_state}` : ''}</span>}
              </div>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {c.campaign_name && <Badge variant="secondary" className="text-[9px] h-4"><Megaphone className="h-2.5 w-2.5 mr-0.5" /> {c.campaign_name}</Badge>}
                {c.board_name && c.stage_name && <Badge variant="outline" className="text-[9px] h-4">{c.board_name} → {c.stage_name}</Badge>}
                {c.activated_by && <Badge variant="outline" className="text-[9px] h-4 border-blue-200 text-blue-600 dark:border-blue-800 dark:text-blue-400">⚡ {activatedByLabel(c.activated_by)}</Badge>}
              </div>
            </div>
            <div className="text-right shrink-0 space-y-1">
              {c.created_at && <p className="text-[10px] text-muted-foreground">{format(new Date(c.created_at), 'dd/MM HH:mm')}</p>}
              {c.time_without_response != null && c.time_without_response > 0 && (
                <p className={`text-[10px] font-medium ${c.time_without_response > 120 ? 'text-red-500' : c.time_without_response > 60 ? 'text-amber-500' : 'text-muted-foreground'}`}>
                  <Clock className="h-3 w-3 inline mr-0.5" />{formatTimeAgo(c.time_without_response)}
                </p>
              )}
              <p className="text-[9px] text-muted-foreground">📩 {c.inbound_count} 📤 {c.outbound_count}</p>
              {status === 'fechado' && c.lead_id && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-5 text-[9px] px-1.5 gap-0.5 mt-1"
                  disabled={generatingLeadId === c.lead_id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPromptDialogLead({ id: c.lead_id!, name: c.contact_name || c.phone });
                    setPromptDialogOpen(true);
                  }}
                >
                  {generatingLeadId === c.lead_id ? <RefreshCw className="h-2.5 w-2.5 animate-spin" /> : <Sparkles className="h-2.5 w-2.5" />}
                  Gerar Atv
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const BatchToolbar = ({ list }: { list: ConversationDetail[] }) => {
    if (selectedKeys.size === 0) return (
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => selectAll(list)}>
          <CheckSquare className="h-3 w-3" /> Selecionar tudo ({list.length})
        </Button>
      </div>
    );

    return (
      <div className="flex flex-wrap items-center gap-2 p-2 bg-primary/5 border border-primary/20 rounded-lg">
        <span className="text-xs font-medium">{selectedKeys.size} selecionada(s)</span>
        <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={clearSelection}>
          <Square className="h-3 w-3" /> Limpar
        </Button>
        <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={() => selectAll(list)}>
          <CheckSquare className="h-3 w-3" /> Todas
        </Button>
        <div className="border-l border-border h-4 mx-1" />
        <Button variant="destructive" size="sm" className="h-6 text-[10px] gap-1" disabled={batchProcessing}
          onClick={() => batchAction('pause')}>
          <StopCircle className="h-3 w-3" /> Pausar agente
        </Button>
        <div className="flex items-center gap-1">
          <Select value={batchAgentId} onValueChange={setBatchAgentId}>
            <SelectTrigger className="h-6 text-[10px] w-[130px]">
              <SelectValue placeholder="Agente..." />
            </SelectTrigger>
            <SelectContent>
              {agents.map(a => (
                <SelectItem key={a.id} value={a.id} className="text-xs">{a.shortcut_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="secondary" size="sm" className="h-6 text-[10px] gap-1" disabled={!batchAgentId || batchProcessing}
            onClick={() => batchAction('assign', batchAgentId)}>
            <UserPlus className="h-3 w-3" /> Atribuir
          </Button>
          <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" disabled={!batchAgentId || batchProcessing}
            onClick={() => batchAction('swap', batchAgentId)}>
            <ArrowRightLeft className="h-3 w-3" /> Trocar
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            Monitor de IA
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Monitore agentes, fila de casos e indicações em tempo real</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 min-w-[180px] justify-start">
                <CalendarIcon className="h-3.5 w-3.5" />
                {format(dateRange.from, 'dd/MM/yy')} — {format(dateRange.to, 'dd/MM/yy')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <div className="flex">
                <div className="border-r p-2 space-y-1 min-w-[130px]">
                  <p className="text-xs font-semibold text-muted-foreground px-2 pb-1">Atalhos</p>
                  {[
                    { label: 'Hoje', from: new Date(), to: new Date() },
                    { label: 'Últimas 24h', from: subDays(new Date(), 1), to: new Date() },
                    { label: 'Últimos 7 dias', from: subDays(new Date(), 7), to: new Date() },
                    { label: 'Últimos 30 dias', from: subDays(new Date(), 30), to: new Date() },
                    { label: 'Esta semana', from: startOfWeek(new Date(), { weekStartsOn: 1 }), to: new Date() },
                    { label: 'Este mês', from: startOfMonth(new Date()), to: new Date() },
                    { label: 'Este ano', from: startOfYear(new Date()), to: new Date() },
                  ].map(preset => (
                    <Button key={preset.label} variant="ghost" size="sm" className="w-full justify-start text-xs h-7"
                      onClick={() => { setDateRange({ from: preset.from, to: preset.to }); setDatePickerOpen(false); }}>
                      {preset.label}
                    </Button>
                  ))}
                </div>
                <div className="p-2">
                  <Calendar mode="range" selected={{ from: dateRange.from, to: dateRange.to }}
                    onSelect={(range) => {
                      if (range?.from && range?.to) { setDateRange({ from: range.from, to: range.to }); setDatePickerOpen(false); }
                      else if (range?.from) { setDateRange(prev => ({ ...prev, from: range.from! })); }
                    }}
                    numberOfMonths={2} className="pointer-events-auto" locale={ptBR} />
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <Button variant="outline" size="sm" className="h-8" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Main tabs */}
      <Tabs defaultValue="queue" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4 max-w-xl">
          <TabsTrigger value="queue" className="text-xs flex items-center gap-1.5">
            <Inbox className="h-3.5 w-3.5" /> Fila de Casos
          </TabsTrigger>
          <TabsTrigger value="agents" className="text-xs flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" /> Painel de Agentes
          </TabsTrigger>
          <TabsTrigger value="ai-activities" className="text-xs flex items-center gap-1.5">
            <ClipboardList className="h-3.5 w-3.5" /> Atividades IA
          </TabsTrigger>
          <TabsTrigger value="referrals" className="text-xs flex items-center gap-1.5">
            <Heart className="h-3.5 w-3.5" /> Indicações
          </TabsTrigger>
        </TabsList>

        {/* ═══════════ TAB 1: FILA DE CASOS ═══════════ */}
        <TabsContent value="queue" className="flex flex-col space-y-4">
          <FilterBar />

          {/* Pipeline status cards */}
           <div className="grid grid-cols-2 sm:grid-cols-7 gap-2">
            {([
              { key: 'sem_resposta' as CaseStatus, icon: AlertCircle, color: 'text-amber-500' },
              { key: 'em_andamento' as CaseStatus, icon: MessageCircle, color: 'text-blue-500' },
              { key: 'fechado' as CaseStatus, icon: CheckCircle, color: 'text-green-500' },
              { key: 'recusado' as CaseStatus, icon: XCircle, color: 'text-red-500' },
              { key: 'inviavel' as CaseStatus, icon: Eye, color: 'text-muted-foreground' },
              { key: 'bloqueado' as CaseStatus, icon: StopCircle, color: 'text-orange-500' },
              { key: 'pausado' as CaseStatus, icon: PauseCircle, color: 'text-gray-500' },
            ]).map(({ key, icon: Icon, color }) => (
              <Card
                key={key}
                className={`cursor-pointer hover:shadow-md transition-all ${sheetStatusFilter === key ? 'ring-2 ring-primary' : ''}`}
                onClick={() => setSheetStatusFilter(prev => prev === key ? null : key)}
              >
                <CardContent className="p-3 text-center">
                  <Icon className={`h-4 w-4 mx-auto mb-1 ${color}`} />
                  <p className="text-xl font-bold">{pipelineCounts[key]}</p>
                  <p className="text-[10px] text-muted-foreground">{statusLabel(key)}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Real-time AI activity feed */}
          <AIRealtimeFeed onEventClick={(event) => {
            if (event.phone && event.instance_name) {
              // Find matching conversation or create a minimal one for chat preview
              const match = conversations.find(c => c.phone === event.phone && c.instance_name === event.instance_name);
              if (match) {
                setChatPreview(match);
              } else {
                // Open with minimal data
                setChatPreview({
                  phone: event.phone,
                  instance_name: event.instance_name,
                  agent_name: event.agent_name || '',
                  agent_id: '',
                  is_active: false,
                  is_blocked: false,
                  human_paused: false,
                  contact_name: event.contact_name || null,
                  lead_name: null,
                  lead_id: event.lead_id || null,
                  lead_status: null,
                  lead_city: null,
                  lead_state: null,
                  lead_acolhedor: null,
                  board_id: null,
                  board_name: null,
                  stage_name: null,
                  last_inbound_at: null,
                  last_outbound_at: null,
                  total_messages: 0,
                  inbound_count: 0,
                  outbound_count: 0,
                  followup_count: 0,
                  has_followup_config: false,
                  time_without_response: null,
                  campaign_name: null,
                  activated_by: null,
                  activated_at: null,
                  whatsapp_group_id: null,
                  created_at: null,
                });
              }
            }
          }} />
        </TabsContent>

        {/* ═══════════ TAB 2: PAINEL DE AGENTES ═══════════ */}
        <TabsContent value="agents" className="space-y-4">
          {/* Global KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <MessageCircle className="h-3.5 w-3.5" /> Conversas
                </div>
                <p className="text-2xl font-bold">{conversations.length}</p>
                <div className="flex gap-2 mt-1">
                  <Badge variant="secondary" className="text-[9px]">{conversations.filter(c => c.is_active && !c.human_paused).length} ativas</Badge>
                  <Badge variant="outline" className="text-[9px]">{conversations.filter(c => c.human_paused).length} pausadas</Badge>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <TrendingUp className="h-3.5 w-3.5" /> Msgs Enviadas
                </div>
                <p className="text-2xl font-bold">{conversations.reduce((s, c) => s + c.outbound_count, 0)}</p>
                <p className="text-[10px] text-muted-foreground">{conversations.reduce((s, c) => s + c.inbound_count, 0)} recebidas</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <Zap className="h-3.5 w-3.5" /> Follow-ups
                </div>
                <p className="text-2xl font-bold">{conversations.reduce((s, c) => s + c.followup_count, 0)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <Clock className="h-3.5 w-3.5 text-amber-500" /> Sem Resposta
                </div>
                <p className="text-2xl font-bold text-amber-600">{conversations.filter(c => c.time_without_response && c.time_without_response > 60).length}</p>
                <p className="text-[10px] text-muted-foreground">&gt;1h sem resposta</p>
              </CardContent>
            </Card>
          </div>

          {/* Sub-tabs inside agents */}
          <Tabs defaultValue="overview" className="space-y-3">
            <TabsList className="grid w-full grid-cols-5 max-w-2xl">
              <TabsTrigger value="overview" className="text-xs">Por Agente</TabsTrigger>
              <TabsTrigger value="conversations" className="text-xs">Conversas</TabsTrigger>
              <TabsTrigger value="followups" className="text-xs"><Zap className="h-3 w-3 mr-1" />Follow-ups</TabsTrigger>
              <TabsTrigger value="call-queue" className="text-xs"><PhoneCall className="h-3 w-3 mr-1" />Ligações</TabsTrigger>
              <TabsTrigger value="ai-data" className="text-xs"><Sparkles className="h-3 w-3 mr-1" />IA Dados</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {agentStats.filter(s => s.total_conversations > 0).map(stat => (
                  <Card key={stat.agent_id} className="hover:shadow-md transition-shadow">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center justify-between">
                        <span className="flex items-center gap-2"><Bot className="h-4 w-4 text-primary" />{stat.agent_name}</span>
                        <Badge variant="secondary" className="text-[10px]">{stat.total_conversations} conversas</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="bg-green-50 dark:bg-green-950 rounded-lg p-2 text-center">
                          <p className="text-lg font-bold text-green-600">{stat.active_conversations}</p>
                          <p className="text-[9px] text-green-600/70">Ativas</p>
                        </div>
                        <div className="bg-amber-50 dark:bg-amber-950 rounded-lg p-2 text-center">
                          <p className="text-lg font-bold text-amber-600">{stat.paused_conversations}</p>
                          <p className="text-[9px] text-amber-600/70">Pausadas</p>
                        </div>
                        <div className="bg-muted rounded-lg p-2 text-center">
                          <p className="text-lg font-bold text-muted-foreground">{stat.inactive_conversations}</p>
                          <p className="text-[9px] text-muted-foreground">Inativas</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <div className="flex justify-between"><span className="text-muted-foreground">Msgs enviadas</span><span className="font-medium">{stat.total_messages_sent}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Msgs recebidas</span><span className="font-medium">{stat.total_messages_received}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Follow-ups</span><span className="font-medium">{stat.followups_sent}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Taxa resposta</span><span className="font-medium">{stat.response_rate}%</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">↗ Fechados</span><span className="font-medium text-green-600">{stat.leads_closed}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">↘ Recusados</span><span className="font-medium text-red-600">{stat.leads_refused}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Sem resposta (&gt;1h)</span><span className="font-medium text-amber-600">{stat.without_response_count}</span></div>
                      </div>
                      {Object.keys(stat.conversations_by_stage).length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase">Por Etapa</p>
                          {Object.entries(stat.conversations_by_stage).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([stage, count]) => (
                            <div key={stage} className="flex items-center gap-2">
                              <span className="text-[10px] text-muted-foreground truncate flex-1">{stage}</span>
                              <Progress value={(count / stat.total_conversations) * 100} className="w-16 h-1.5" />
                              <span className="text-[10px] font-medium w-6 text-right">{count}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
                {agentStats.filter(s => s.total_conversations > 0).length === 0 && !loading && (
                  <div className="col-span-full text-center py-12 text-muted-foreground">
                    <Bot className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Nenhuma conversa de agente encontrada no período</p>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="conversations" className="space-y-3">
              <FilterBar />
              <div className="relative max-w-md">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="Buscar..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-8 h-8 text-xs" />
              </div>
              <BatchToolbar list={filteredConversations} />
              <p className="text-xs text-muted-foreground">{filteredConversations.length} conversas</p>
              <ScrollArea className="h-[calc(100vh-540px)]">
                <div className="space-y-2">
                  {filteredConversations.map((c, idx) => (
                    <CaseCard key={`${c.phone}-${c.instance_name}-${idx}`} c={c} selectable />
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="followups"><FollowupActivityPanel /></TabsContent>
            <TabsContent value="call-queue">
              <CallQueuePanel onSelectConversation={(phone, instanceName, contactName) => {
                setChatPreview({ phone, instance_name: instanceName, contact_name: contactName || '' } as any);
              }} />
            </TabsContent>
            <TabsContent value="ai-data"><AIEnrichmentMonitorPanel /></TabsContent>
          </Tabs>
        </TabsContent>

        {/* ═══════════ TAB 3: ATIVIDADES IA ═══════════ */}
        <TabsContent value="ai-activities" className="space-y-4">
          <AIActivitiesPanel />
        </TabsContent>

        {/* ═══════════ TAB 4: INDICAÇÕES ═══════════ */}
        <TabsContent value="referrals" className="space-y-4">
          {/* Referral KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <Card>
              <CardContent className="p-3 text-center">
                <Heart className="h-4 w-4 mx-auto mb-1 text-primary" />
                <p className="text-xl font-bold">{referralStats.total}</p>
                <p className="text-[10px] text-muted-foreground">Total Indicações</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <Clock className="h-4 w-4 mx-auto mb-1 text-amber-500" />
                <p className="text-xl font-bold text-amber-600">{referralStats.pending}</p>
                <p className="text-[10px] text-muted-foreground">Pendentes</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <Phone className="h-4 w-4 mx-auto mb-1 text-blue-500" />
                <p className="text-xl font-bold text-blue-600">{referralStats.contacted}</p>
                <p className="text-[10px] text-muted-foreground">Contatados</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <CheckCircle className="h-4 w-4 mx-auto mb-1 text-green-500" />
                <p className="text-xl font-bold text-green-600">{referralStats.converted}</p>
                <p className="text-[10px] text-muted-foreground">Convertidos</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <XCircle className="h-4 w-4 mx-auto mb-1 text-red-500" />
                <p className="text-xl font-bold text-red-600">{referralStats.lost}</p>
                <p className="text-[10px] text-muted-foreground">Perdidos</p>
              </CardContent>
            </Card>
          </div>

          {/* Conversion funnel */}
          {referralStats.total > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Funil de Indicações</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {[
                  { label: 'Pendentes', value: referralStats.pending, color: 'bg-amber-500' },
                  { label: 'Contatados', value: referralStats.contacted, color: 'bg-blue-500' },
                  { label: 'Convertidos', value: referralStats.converted, color: 'bg-green-500' },
                  { label: 'Perdidos', value: referralStats.lost, color: 'bg-red-500' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span>{label}</span>
                      <span className="text-muted-foreground">{value} ({referralStats.total > 0 ? Math.round((value / referralStats.total) * 100) : 0}%)</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${referralStats.total > 0 ? (value / referralStats.total) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Referral list */}
          <ScrollArea className="h-[calc(100vh-550px)]">
            <div className="space-y-2">
              {referrals.map(r => (
                <Card key={r.id}>
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{r.contact_name || r.lead_name || 'Indicação'}</span>
                          <Badge className={`text-[9px] h-4 ${r.status === 'converted' ? 'bg-green-100 text-green-700' : r.status === 'contacted' ? 'bg-blue-100 text-blue-700' : r.status === 'lost' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                            {r.status === 'pending' ? 'Pendente' : r.status === 'contacted' ? 'Contatado' : r.status === 'converted' ? 'Convertido' : 'Perdido'}
                          </Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Indicado por: <span className="font-medium">{r.ambassador_name}</span>
                          {r.campaign_name && <> · Campanha: {r.campaign_name}</>}
                        </p>
                      </div>
                      <p className="text-[10px] text-muted-foreground shrink-0">{format(new Date(r.created_at), 'dd/MM HH:mm')}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {referrals.length === 0 && !loading && (
                <div className="text-center py-12 text-muted-foreground">
                  <Heart className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Nenhuma indicação no período</p>
                  <p className="text-[10px] mt-1">Configure os agentes pós-fechamento para pedir indicações automaticamente</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* Chat Preview */}
      {/* Sheet lateral para lista filtrada por status */}
      <Sheet open={!!sheetStatusFilter} onOpenChange={(open) => { if (!open) { setSheetStatusFilter(null); setSheetResponseFilter('all'); setSheetLeadFilter('all'); setSheetAgentStatusFilter('all'); setSearchQuery(''); } }}>
        <SheetContent side="right" className="w-full sm:w-[450px] sm:max-w-[450px] p-0 flex flex-col">
          <SheetHeader className="p-4 pb-2 border-b">
            <SheetTitle className="flex items-center gap-2">
              {sheetStatusFilter && (() => {
                const icons: Record<CaseStatus, typeof AlertCircle> = { sem_resposta: AlertCircle, em_andamento: MessageCircle, fechado: CheckCircle, recusado: XCircle, inviavel: Eye, bloqueado: StopCircle, pausado: PauseCircle };
                const Icon = icons[sheetStatusFilter];
                return <Icon className="h-5 w-5" />;
              })()}
              {sheetStatusFilter ? statusLabel(sheetStatusFilter) : ''} ({sheetCases.length})
            </SheetTitle>
          </SheetHeader>
          <div className="px-3 pt-2 pb-1 border-b space-y-1.5">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Buscar por nome ou telefone..." value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)} className="pl-8 h-7 text-xs" />
            </div>
            <div className="flex flex-wrap gap-1">
              {([['all', 'Todas'], ['responded', 'Respondidas'], ['waiting', 'Aguardando']] as const).map(([k, label]) => {
                const count = sheetCases.filter(c => {
                  if (k === 'responded') return c.inbound_count > 0 && c.outbound_count > 0;
                  if (k === 'waiting') return c.outbound_count > 0 && c.inbound_count === 0;
                  return true;
                }).length;
                return (
                  <Badge key={k} variant={sheetResponseFilter === k ? 'default' : 'outline'}
                    className="cursor-pointer text-[10px] px-1.5 py-0 h-5"
                    onClick={() => setSheetResponseFilter(k)}>{label} ({count})</Badge>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-1">
              {([['all', 'Todos'], ['com_lead', 'Com Lead'], ['sem_lead', 'Sem Lead']] as const).map(([k, label]) => {
                const count = sheetCases.filter(c => {
                  if (k === 'com_lead') return !!c.lead_id;
                  if (k === 'sem_lead') return !c.lead_id;
                  return true;
                }).length;
                return (
                  <Badge key={k} variant={sheetLeadFilter === k ? 'default' : 'outline'}
                    className="cursor-pointer text-[10px] px-1.5 py-0 h-5"
                    onClick={() => setSheetLeadFilter(k)}>{label} ({count})</Badge>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-1 pb-1">
              {([['all', 'Todos'], ['ativo', 'Ativo'], ['pausado', 'Pausado']] as const).map(([k, label]) => {
                const count = sheetCases.filter(c => {
                  if (k === 'ativo') return c.is_active;
                  if (k === 'pausado') return !c.is_active && !c.is_blocked;
                  return true;
                }).length;
                return (
                  <Badge key={k} variant={sheetAgentStatusFilter === k ? 'default' : 'outline'}
                    className="cursor-pointer text-[10px] px-1.5 py-0 h-5"
                    onClick={() => setSheetAgentStatusFilter(k)}>{label} ({count})</Badge>
                );
              })}
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1.5">
              {sheetCases.filter(c => {
                if (searchQuery) {
                  const q = searchQuery.toLowerCase();
                  if (!c.phone.includes(q) && !c.contact_name?.toLowerCase().includes(q) && !c.lead_name?.toLowerCase().includes(q)) return false;
                }
                if (sheetResponseFilter === 'responded' && !(c.inbound_count > 0 && c.outbound_count > 0)) return false;
                if (sheetResponseFilter === 'waiting' && !(c.outbound_count > 0 && c.inbound_count === 0)) return false;
                if (sheetLeadFilter === 'com_lead' && !c.lead_id) return false;
                if (sheetLeadFilter === 'sem_lead' && c.lead_id) return false;
                if (sheetAgentStatusFilter === 'ativo' && !c.is_active) return false;
                if (sheetAgentStatusFilter === 'pausado' && (c.is_active || c.is_blocked)) return false;
                return true;
              }).map((c, idx) => (
                <CaseCard key={`sheet-${c.phone}-${c.instance_name}-${idx}`} c={c} />
              ))}
              {sheetCases.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <Inbox className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">Nenhum caso encontrado</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <DashboardChatPreview
        open={!!chatPreview}
        onOpenChange={(open) => { if (!open) setChatPreview(null); }}
        phone={chatPreview?.phone || null}
        contactName={chatPreview?.contact_name || chatPreview?.lead_name || null}
        instanceName={chatPreview?.instance_name || null}
        hasLead={!!chatPreview?.lead_name}
        hasContact={!!chatPreview?.contact_name}
        wasResponded={chatPreview ? chatPreview.inbound_count > 0 : false}
        responseTimeMinutes={null}
      />

      {/* AI Activity Prompt Dialog */}
      <AIActivityPromptDialog
        open={promptDialogOpen}
        onOpenChange={setPromptDialogOpen}
        leadName={promptDialogLead?.name || ''}
        loading={!!generatingLeadId}
        onConfirm={async (customPrompt) => {
          if (!promptDialogLead) return;
          setGeneratingLeadId(promptDialogLead.id);
          try {
            const { data: { session } } = await supabase.auth.getSession();
            const { data, error } = await cloudFunctions.invoke('generate-case-activities', {
              body: { lead_id: promptDialogLead.id, custom_prompt: customPrompt },
              authToken: session?.access_token,
            });
            if (error) throw error;
            toast({ title: 'Atividades geradas', description: data?.message || 'Sucesso' });
            setPromptDialogOpen(false);
          } catch (err: any) {
            toast({ title: 'Erro', description: err.message, variant: 'destructive' });
          } finally {
            setGeneratingLeadId(null);
          }
        }}
      />
    </div>
  );
}
