import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import {
  Bot, MessageCircle, Clock, TrendingUp, Users, Search, RefreshCw,
  CheckCircle, XCircle, Pause, Zap, ArrowUpRight, ArrowDownRight,
  Filter, MapPin, Phone, PhoneCall, ExternalLink, PowerOff, Megaphone, PhoneOutgoing, Sparkles
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { CallQueuePanel } from './CallQueuePanel';
import { FollowupActivityPanel } from './FollowupActivityPanel';
import { AIEnrichmentMonitorPanel } from './AIEnrichmentMonitorPanel';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DashboardChatPreview } from './DashboardChatPreview';
import { format, differenceInMinutes, differenceInHours, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface AgentData {
  id: string;
  shortcut_name: string;
  description: string | null;
  is_active: boolean | null;
}

interface ConversationAgent {
  id: string;
  phone: string;
  instance_name: string;
  agent_id: string;
  is_active: boolean;
  human_paused_until: string | null;
  activated_by: string | null;
  created_at: string;
  updated_at: string;
}

interface ConversationDetail {
  phone: string;
  instance_name: string;
  agent_name: string;
  agent_id: string;
  is_active: boolean;
  human_paused: boolean;
  contact_name: string | null;
  lead_name: string | null;
  lead_id: string | null;
  lead_status: string | null;
  lead_city: string | null;
  lead_state: string | null;
  lead_acolhedor: string | null;
  board_name: string | null;
  stage_name: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  total_messages: number;
  inbound_count: number;
  outbound_count: number;
  followup_count: number;
  time_without_response: number | null; // minutes
  campaign_name: string | null;
  activated_by: string | null;
  activated_at: string | null;
  whatsapp_group_id: string | null;
}

interface GroupInfo {
  lead_id: string;
  lead_name: string;
  whatsapp_group_id: string;
  lead_phone: string | null;
  board_name: string | null;
  stage_name: string | null;
  acolhedor: string | null;
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
  avg_response_time_min: number;
  conversations_by_stage: Record<string, number>;
  followups_sent: number;
  leads_closed: number;
  leads_refused: number;
  without_response_count: number;
}

export function AgentMonitorDashboard() {
  const [agents, setAgents] = useState<AgentData[]>([]);
  const [conversationAgents, setConversationAgents] = useState<ConversationAgent[]>([]);
  const [conversations, setConversations] = useState<ConversationDetail[]>([]);
  const [agentStats, setAgentStats] = useState<AgentStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [cityFilter, setCityFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [acolhedorFilter, setAcolhedorFilter] = useState('all');
  const [periodDays, setPeriodDays] = useState(7);
  const [kpiSheet, setKpiSheet] = useState<{ filter: string; label: string } | null>(null);
  const [chatPreview, setChatPreview] = useState<ConversationDetail | null>(null);
  const [sheetAgentFilter, setSheetAgentFilter] = useState('all');
  const [sheetActivatedByFilter, setSheetActivatedByFilter] = useState('all');
  const [sheetCampaignFilter, setSheetCampaignFilter] = useState('all');
  const [sheetInstanceFilter, setSheetInstanceFilter] = useState('all');
  const [sheetActivatedDateFilter, setSheetActivatedDateFilter] = useState('all');
  const [excludedPhones, setExcludedPhones] = useState<Set<string>>(new Set());

  const fetchData = async () => {
    setLoading(true);
    try {
      const startDate = subDays(new Date(), periodDays).toISOString();

      // Fetch agents
      const { data: agentsData } = await supabase
        .from('wjia_command_shortcuts')
        .select('id, shortcut_name, description, is_active')
        .order('shortcut_name');

      // Fetch conversation agents
      const { data: convAgents } = await supabase
        .from('whatsapp_conversation_agents')
        .select('*');

      // Fetch messages for stats (last N days)
      const { data: messages } = await supabase
        .from('whatsapp_messages')
        .select('phone, instance_name, direction, created_at, action_source, action_source_detail, contact_name, lead_id, campaign_name')
        .gte('created_at', startDate)
        .order('created_at', { ascending: false });

      // Fetch campaign_name for ALL phones (not date-filtered) to ensure we capture campaign origin
      const agentPhones = (convAgents || []).map((ca: any) => ca.phone);
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

      // Fetch leads with location data
      const { data: leads } = await supabase
        .from('leads')
        .select('id, lead_name, lead_phone, status, lead_status, board_id, city, state, neighborhood, followup_count, campaign_name, acolhedor, whatsapp_group_id, created_at')
        .not('lead_phone', 'is', null);

      // Fetch boards for stage names
      const { data: boards } = await supabase
        .from('kanban_boards')
        .select('id, name, stages');

      // Fetch followups count
      const { data: followups } = await supabase
        .from('lead_followups')
        .select('lead_id, followup_type')
        .gte('followup_date', startDate);

      setAgents((agentsData || []) as AgentData[]);
      setConversationAgents((convAgents || []) as ConversationAgent[]);

      // Build conversation details
      const agentMap = new Map((agentsData || []).map((a: any) => [a.id, a.shortcut_name]));
      const leadMap = new Map((leads || []).map((l: any) => [l.id, l]));
      const leadPhoneMap = new Map<string, any>();
      (leads || []).forEach((l: any) => {
        if (l.lead_phone) {
          const normalized = l.lead_phone.replace(/\D/g, '');
          leadPhoneMap.set(normalized, l);
          if (normalized.length > 8) {
            leadPhoneMap.set(normalized.slice(-8), l);
          }
        }
      });

      const boardMap = new Map((boards || []).map((b: any) => [b.id, b]));

      // Group messages by phone+instance
      const msgByConv = new Map<string, any[]>();
      (messages || []).forEach((m: any) => {
        const key = `${m.phone}|${m.instance_name}`;
        if (!msgByConv.has(key)) msgByConv.set(key, []);
        msgByConv.get(key)!.push(m);
      });

      // Followups by lead
      const followupsByLead = new Map<string, number>();
      (followups || []).forEach((f: any) => {
        followupsByLead.set(f.lead_id, (followupsByLead.get(f.lead_id) || 0) + 1);
      });

      const convDetails: ConversationDetail[] = [];
      (convAgents || []).forEach((ca: any) => {
        // Skip groups — they can't click on ads and shouldn't appear
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
          human_paused: !!isPaused,
          contact_name: msgs[0]?.contact_name || null,
          lead_name: lead?.lead_name || null,
          lead_id: lead?.id || null,
          lead_status: lead?.lead_status || null,
          lead_city: lead?.city || null,
          lead_state: lead?.state || null,
          lead_acolhedor: lead?.acolhedor || null,
          board_name: boardName,
          stage_name: stageName,
          last_inbound_at: lastInbound,
          last_outbound_at: lastOutbound,
          total_messages: msgs.length,
          inbound_count: inboundMsgs.length,
          outbound_count: outboundMsgs.length,
          followup_count: lead ? (followupsByLead.get(lead.id) || 0) : 0,
          time_without_response: timeWithoutResponse,
          campaign_name: campaignByPhone.get(key) || msgs.find((m: any) => m.campaign_name)?.campaign_name || lead?.campaign_name || null,
          activated_by: ca.activated_by || null,
          activated_at: ca.created_at || null,
          whatsapp_group_id: lead?.whatsapp_group_id || null,
        });
      });

      setConversations(convDetails);

      // Calculate per-agent stats
      const statsMap = new Map<string, AgentStats>();
      (agentsData || []).forEach((a: any) => {
        statsMap.set(a.id, {
          agent_id: a.id,
          agent_name: a.shortcut_name,
          total_conversations: 0,
          active_conversations: 0,
          paused_conversations: 0,
          inactive_conversations: 0,
          total_messages_sent: 0,
          total_messages_received: 0,
          response_rate: 0,
          avg_response_time_min: 0,
          conversations_by_stage: {},
          followups_sent: 0,
          leads_closed: 0,
          leads_refused: 0,
          without_response_count: 0,
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

      // Calculate response rate
      statsMap.forEach(stat => {
        if (stat.total_messages_received > 0) {
          stat.response_rate = Math.round((stat.total_messages_sent / stat.total_messages_received) * 100);
        }
      });

      setAgentStats(Array.from(statsMap.values()));
    } catch (error) {
      console.error('Error fetching agent monitor data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [periodDays]);

  // Filters
  const filteredConversations = useMemo(() => {
    return conversations.filter(c => {
      if (selectedAgent !== 'all' && c.agent_id !== selectedAgent) return false;
      if (statusFilter === 'active' && (!c.is_active || c.human_paused)) return false;
      if (statusFilter === 'paused' && !c.human_paused) return false;
      if (statusFilter === 'inactive' && c.is_active) return false;
      if (statusFilter === 'no_response' && (!c.time_without_response || c.time_without_response < 60)) return false;
      if (cityFilter !== 'all' && c.lead_city !== cityFilter) return false;
      if (stateFilter !== 'all' && c.lead_state !== stateFilter) return false;
      if (acolhedorFilter !== 'all' && c.lead_acolhedor !== acolhedorFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          c.phone.includes(q) ||
          (c.contact_name?.toLowerCase().includes(q)) ||
          (c.lead_name?.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [conversations, selectedAgent, statusFilter, cityFilter, stateFilter, acolhedorFilter, searchQuery]);

  const uniqueCities = useMemo(() => [...new Set(conversations.map(c => c.lead_city).filter(Boolean))].sort(), [conversations]);
  const uniqueStates = useMemo(() => [...new Set(conversations.map(c => c.lead_state).filter(Boolean))].sort(), [conversations]);

  // Acolhedor-filtered conversations for KPIs (before agent/status/search filters)
  const kpiConversations = useMemo(() => {
    if (acolhedorFilter === 'all') return conversations;
    return conversations.filter(c => c.lead_acolhedor === acolhedorFilter);
  }, [conversations, acolhedorFilter]);

  // Global KPIs
  const globalStats = useMemo(() => {
    const total = kpiConversations.length;
    const active = kpiConversations.filter(c => c.is_active && !c.human_paused).length;
    const paused = kpiConversations.filter(c => c.human_paused).length;
    const noResponse = kpiConversations.filter(c => c.time_without_response && c.time_without_response > 60).length;
    const totalFollowups = kpiConversations.reduce((sum, c) => sum + c.followup_count, 0);
    const totalMsgsSent = kpiConversations.reduce((sum, c) => sum + c.outbound_count, 0);
    const totalMsgsReceived = kpiConversations.reduce((sum, c) => sum + c.inbound_count, 0);
    const closed = kpiConversations.filter(c => c.lead_status === 'closed').length;
    const refused = kpiConversations.filter(c => c.lead_status === 'refused').length;
    const unviable = kpiConversations.filter(c => c.lead_status === 'unviable').length;
    const activeLeads = kpiConversations.filter(c => c.lead_status === 'active').length;
    return { total, active, paused, noResponse, totalFollowups, totalMsgsSent, totalMsgsReceived, closed, refused, unviable, activeLeads };
  }, [kpiConversations]);

  // Get unique acolhedor values for filter
  const acolhedorOptions = useMemo(() => {
    const set = new Set<string>();
    conversations.forEach(c => { if (c.lead_acolhedor) set.add(c.lead_acolhedor); });
    return Array.from(set).sort();
  }, [conversations]);

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
      default: return val || 'Desconhecido';
    }
  };

  const kpiSheetConversations = useMemo(() => {
    if (!kpiSheet) return [];
    let filtered: ConversationDetail[];
    switch (kpiSheet.filter) {
      case 'total': filtered = kpiConversations; break;
      case 'active': filtered = kpiConversations.filter(c => c.is_active && !c.human_paused); break;
      case 'paused': filtered = kpiConversations.filter(c => c.human_paused); break;
      case 'no_response': filtered = kpiConversations.filter(c => c.time_without_response && c.time_without_response > 60); break;
      case 'closed': filtered = kpiConversations.filter(c => c.lead_status === 'closed'); break;
      case 'refused': filtered = kpiConversations.filter(c => c.lead_status === 'refused'); break;
      case 'unviable': filtered = kpiConversations.filter(c => c.lead_status === 'unviable'); break;
      case 'active_leads': filtered = kpiConversations.filter(c => c.lead_status === 'active'); break;
      case 'followups': filtered = kpiConversations.filter(c => c.followup_count > 0); break;
      case 'msgs_sent': filtered = kpiConversations.filter(c => c.outbound_count > 0); break;
      default: filtered = kpiConversations;
    }
    if (sheetAgentFilter !== 'all') filtered = filtered.filter(c => c.agent_id === sheetAgentFilter);
    if (sheetActivatedByFilter !== 'all') filtered = filtered.filter(c => activatedByLabel(c.activated_by) === sheetActivatedByFilter);
    if (sheetCampaignFilter !== 'all') {
      if (sheetCampaignFilter === '__none__') {
        filtered = filtered.filter(c => !c.campaign_name);
      } else {
        filtered = filtered.filter(c => c.campaign_name === sheetCampaignFilter);
      }
    }
    if (sheetInstanceFilter !== 'all') filtered = filtered.filter(c => c.instance_name === sheetInstanceFilter);
    if (sheetActivatedDateFilter !== 'all') filtered = filtered.filter(c => c.activated_at ? format(new Date(c.activated_at), 'yyyy-MM-dd') === sheetActivatedDateFilter : false);
    return filtered;
  }, [kpiSheet, conversations, sheetAgentFilter, sheetActivatedByFilter, sheetCampaignFilter, sheetInstanceFilter, sheetActivatedDateFilter]);

  const selectedSheetConversations = useMemo(() => {
    return kpiSheetConversations.filter(c => !excludedPhones.has(c.phone));
  }, [kpiSheetConversations, excludedPhones]);

  useEffect(() => { setExcludedPhones(new Set()); }, [kpiSheet, sheetAgentFilter, sheetActivatedByFilter, sheetCampaignFilter, sheetInstanceFilter, sheetActivatedDateFilter]);

  const uniqueInstances = useMemo(() => [...new Set(conversations.map(c => c.instance_name).filter(Boolean))].sort() as string[], [conversations]);

  const uniqueActivatedDates = useMemo(() => {
    const dates = conversations.map(c => c.activated_at ? format(new Date(c.activated_at), 'yyyy-MM-dd') : null).filter(Boolean) as string[];
    return [...new Set(dates)].sort().reverse();
  }, [conversations]);

  const uniqueActivatedBy = useMemo(() => [...new Set(conversations.map(c => activatedByLabel(c.activated_by)).filter(v => v !== 'Desconhecido'))].sort() as string[], [conversations]);
  const uniqueCampaigns = useMemo(() => {
    // Filter campaigns based on current activation filter to keep them consistent
    let base = conversations;
    if (sheetActivatedByFilter !== 'all') base = base.filter(c => activatedByLabel(c.activated_by) === sheetActivatedByFilter);
    const names = base.map(c => c.campaign_name);
    const hasNull = names.some(n => !n);
    const unique = [...new Set(names.filter(Boolean))].sort() as string[];
    return { campaigns: unique, hasNoCampaign: hasNull };
  }, [conversations, sheetActivatedByFilter]);
  const uniqueSheetAgents = useMemo(() => {
    const agentMap = new Map<string, string>();
    conversations.forEach(c => {
      if (c.agent_id && c.agent_name) agentMap.set(c.agent_id, c.agent_name);
    });
    return Array.from(agentMap.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [conversations]);

  const formatTimeAgo = (minutes: number | null) => {
    if (!minutes) return '-';
    if (minutes < 60) return `${minutes}min`;
    const h = Math.floor(minutes / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  };

  return (
    <div className="min-h-screen p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            Monitor de Agentes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Acompanhe o desempenho das conversas automáticas em tempo real</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {acolhedorOptions.length > 0 && (
            <Select value={acolhedorFilter} onValueChange={setAcolhedorFilter}>
              <SelectTrigger className="w-[140px] h-9 text-xs">
                <SelectValue placeholder="Acolhedor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos Acolhedores</SelectItem>
                {acolhedorOptions.map(a => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={String(periodDays)} onValueChange={v => setPeriodDays(Number(v))}>
            <SelectTrigger className="w-[130px] h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Últimas 24h</SelectItem>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="15">Últimos 15 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Global KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card className="border-primary/20 cursor-pointer hover:shadow-md transition-shadow" onClick={() => setKpiSheet({ filter: 'total', label: 'Total Conversas' })}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <MessageCircle className="h-3.5 w-3.5" />
              Total Conversas
            </div>
            <p className="text-2xl font-bold">{globalStats.total}</p>
            <div className="flex gap-2 mt-1">
              <Badge variant="secondary" className="text-[9px] cursor-pointer" onClick={(e) => { e.stopPropagation(); setKpiSheet({ filter: 'active', label: 'Conversas Ativas' }); }}>{globalStats.active} ativas</Badge>
              <Badge variant="outline" className="text-[9px] cursor-pointer" onClick={(e) => { e.stopPropagation(); setKpiSheet({ filter: 'paused', label: 'Conversas Pausadas' }); }}>{globalStats.paused} pausadas</Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setKpiSheet({ filter: 'msgs_sent', label: 'Conversas com Mensagens' })}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <TrendingUp className="h-3.5 w-3.5" />
              Msgs Enviadas
            </div>
            <p className="text-2xl font-bold">{globalStats.totalMsgsSent}</p>
            <p className="text-[10px] text-muted-foreground">{globalStats.totalMsgsReceived} recebidas</p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setKpiSheet({ filter: 'followups', label: 'Conversas com Follow-up' })}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Zap className="h-3.5 w-3.5" />
              Follow-ups
            </div>
            <p className="text-2xl font-bold">{globalStats.totalFollowups}</p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setKpiSheet({ filter: 'closed', label: 'Fechados' })}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <CheckCircle className="h-3.5 w-3.5 text-green-500" />
              Status dos Leads
            </div>
            <p className="text-2xl font-bold text-green-600">{globalStats.closed}</p>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
              <p className="text-[10px] text-blue-600 cursor-pointer" onClick={(e) => { e.stopPropagation(); setKpiSheet({ filter: 'active_leads', label: 'Em Andamento' }); }}>{globalStats.activeLeads} andamento</p>
              <p className="text-[10px] text-green-600 cursor-pointer" onClick={(e) => { e.stopPropagation(); setKpiSheet({ filter: 'closed', label: 'Fechados' }); }}>{globalStats.closed} fechados</p>
              <p className="text-[10px] text-red-500 cursor-pointer" onClick={(e) => { e.stopPropagation(); setKpiSheet({ filter: 'refused', label: 'Recusados' }); }}>{globalStats.refused} recusados</p>
              <p className="text-[10px] text-muted-foreground cursor-pointer" onClick={(e) => { e.stopPropagation(); setKpiSheet({ filter: 'unviable', label: 'Inviáveis' }); }}>{globalStats.unviable} inviáveis</p>
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setKpiSheet({ filter: 'no_response', label: 'Sem Resposta (>1h)' })}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Clock className="h-3.5 w-3.5 text-amber-500" />
              Sem Resposta
            </div>
            <p className="text-2xl font-bold text-amber-600">{globalStats.noResponse}</p>
            <p className="text-[10px] text-muted-foreground">&gt;1h sem resposta</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="agents" className="space-y-4">
        <TabsList className="grid w-full grid-cols-6 max-w-3xl">
          <TabsTrigger value="agents" className="text-xs">Por Agente</TabsTrigger>
          <TabsTrigger value="conversations" className="text-xs">Conversas</TabsTrigger>
          <TabsTrigger value="funnel" className="text-xs">Funil</TabsTrigger>
          <TabsTrigger value="followups" className="text-xs flex items-center gap-1">
            <Zap className="h-3 w-3" /> Follow-ups
          </TabsTrigger>
          <TabsTrigger value="call-queue" className="text-xs flex items-center gap-1">
            <PhoneCall className="h-3 w-3" /> Fila Ligações
          </TabsTrigger>
          <TabsTrigger value="ai-data" className="text-xs flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> IA Dados
          </TabsTrigger>
        </TabsList>

        {/* TAB: Per Agent Stats */}
        <TabsContent value="agents" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {agentStats.filter(s => s.total_conversations > 0).map(stat => (
              <Card key={stat.agent_id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Bot className="h-4 w-4 text-primary" />
                      {stat.agent_name}
                    </span>
                    <Badge variant="secondary" className="text-[10px]">{stat.total_conversations} conversas</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Status breakdown */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-2">
                      <p className="text-lg font-bold text-green-600">{stat.active_conversations}</p>
                      <p className="text-[9px] text-muted-foreground">Ativas</p>
                    </div>
                    <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-2">
                      <p className="text-lg font-bold text-amber-600">{stat.paused_conversations}</p>
                      <p className="text-[9px] text-muted-foreground">Pausadas</p>
                    </div>
                    <div className="bg-muted rounded-lg p-2">
                      <p className="text-lg font-bold text-muted-foreground">{stat.inactive_conversations}</p>
                      <p className="text-[9px] text-muted-foreground">Inativas</p>
                    </div>
                  </div>

                  {/* Metrics */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Msgs enviadas</span>
                      <span className="font-medium">{stat.total_messages_sent}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Msgs recebidas</span>
                      <span className="font-medium">{stat.total_messages_received}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Follow-ups</span>
                      <span className="font-medium">{stat.followups_sent}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Taxa resposta</span>
                      <span className="font-medium">{stat.response_rate}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <ArrowUpRight className="h-3 w-3 text-green-500" /> Fechados
                      </span>
                      <span className="font-medium text-green-600">{stat.leads_closed}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <ArrowDownRight className="h-3 w-3 text-red-500" /> Recusados
                      </span>
                      <span className="font-medium text-red-600">{stat.leads_refused}</span>
                    </div>
                    <div className="flex justify-between col-span-2">
                      <span className="text-muted-foreground">Sem resposta (&gt;1h)</span>
                      <span className="font-medium text-amber-600">{stat.without_response_count}</span>
                    </div>
                  </div>

                  {/* Stage distribution */}
                  {Object.keys(stat.conversations_by_stage).length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase">Por Etapa</p>
                      {Object.entries(stat.conversations_by_stage)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 5)
                        .map(([stage, count]) => (
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

        {/* TAB: Conversations List */}
        <TabsContent value="conversations" className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome ou telefone..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-8 h-9 text-xs"
              />
            </div>
            <Select value={selectedAgent} onValueChange={setSelectedAgent}>
              <SelectTrigger className="w-[160px] h-9 text-xs">
                <SelectValue placeholder="Agente" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos agentes</SelectItem>
                {agents.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.shortcut_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[130px] h-9 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="active">Ativas</SelectItem>
                <SelectItem value="paused">Pausadas</SelectItem>
                <SelectItem value="inactive">Inativas</SelectItem>
                <SelectItem value="no_response">Sem resposta</SelectItem>
              </SelectContent>
            </Select>
            {uniqueStates.length > 0 && (
              <Select value={stateFilter} onValueChange={setStateFilter}>
                <SelectTrigger className="w-[100px] h-9 text-xs">
                  <SelectValue placeholder="UF" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos UFs</SelectItem>
                  {uniqueStates.map(s => (
                    <SelectItem key={s} value={s!}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {uniqueCities.length > 0 && (
              <Select value={cityFilter} onValueChange={setCityFilter}>
                <SelectTrigger className="w-[140px] h-9 text-xs">
                  <SelectValue placeholder="Cidade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas cidades</SelectItem>
                  {uniqueCities.map(c => (
                    <SelectItem key={c} value={c!}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <p className="text-xs text-muted-foreground">{filteredConversations.length} conversas encontradas</p>

          <ScrollArea className="h-[calc(100vh-420px)]">
            <div className="space-y-2">
              {filteredConversations.map((c, idx) => (
                <Card key={`${c.phone}-${c.instance_name}-${idx}`} className="hover:shadow-sm transition-shadow">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">{c.contact_name || c.lead_name || c.phone}</span>
                          {c.is_active && !c.human_paused && (
                            <Badge className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400 text-[9px] h-4">Ativo</Badge>
                          )}
                          {c.human_paused && (
                            <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 text-[9px] h-4">
                              <Pause className="h-2.5 w-2.5 mr-0.5" /> Pausado
                            </Badge>
                          )}
                          {!c.is_active && !c.human_paused && (
                            <Badge variant="outline" className="text-[9px] h-4">Inativo</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-0.5">
                            <Bot className="h-3 w-3" /> {c.agent_name}
                          </span>
                          <span className="flex items-center gap-0.5">
                            <Phone className="h-3 w-3" /> {c.phone}
                          </span>
                          {c.lead_city && (
                            <span className="flex items-center gap-0.5">
                              <MapPin className="h-3 w-3" /> {c.lead_city}{c.lead_state ? `/${c.lead_state}` : ''}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {c.time_without_response != null && c.time_without_response > 0 && (
                          <p className={`text-[10px] font-medium ${c.time_without_response > 120 ? 'text-red-500' : c.time_without_response > 60 ? 'text-amber-500' : 'text-muted-foreground'}`}>
                            <Clock className="h-3 w-3 inline mr-0.5" />{formatTimeAgo(c.time_without_response)} sem resposta
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Bottom row */}
                    <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground flex-wrap">
                      {c.board_name && c.stage_name && (
                        <Badge variant="outline" className="text-[9px] h-4">{c.board_name} → {c.stage_name}</Badge>
                      )}
                      {c.campaign_name && (
                        <Badge variant="secondary" className="text-[9px] h-4">📢 {c.campaign_name}</Badge>
                      )}
                      <span>📩 {c.inbound_count} | 📤 {c.outbound_count}</span>
                      {c.followup_count > 0 && <span>🔄 {c.followup_count} follow-ups</span>}
                    </div>
                  </CardContent>
                </Card>
              ))}
              {filteredConversations.length === 0 && !loading && (
                <div className="text-center py-12 text-muted-foreground">
                  <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Nenhuma conversa encontrada com os filtros aplicados</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* TAB: Funnel View */}
        <TabsContent value="funnel" className="space-y-4">
          <div className="space-y-4">
            {agentStats.filter(s => Object.keys(s.conversations_by_stage).length > 0).map(stat => (
              <Card key={stat.agent_id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Bot className="h-4 w-4 text-primary" />
                    {stat.agent_name}
                    <Badge variant="secondary" className="text-[9px] ml-auto">{stat.total_conversations} total</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {Object.entries(stat.conversations_by_stage)
                      .sort((a, b) => b[1] - a[1])
                      .map(([stage, count]) => {
                        const pct = Math.round((count / stat.total_conversations) * 100);
                        return (
                          <div key={stage} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="truncate">{stage}</span>
                              <span className="text-muted-foreground shrink-0 ml-2">{count} ({pct}%)</span>
                            </div>
                            <Progress value={pct} className="h-2" />
                          </div>
                        );
                      })}
                  </div>
                  <div className="flex gap-4 mt-4 pt-3 border-t text-xs">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                      <span className="text-muted-foreground">Fechados:</span>
                      <span className="font-medium text-green-600">{stat.leads_closed}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <XCircle className="h-3.5 w-3.5 text-red-500" />
                      <span className="text-muted-foreground">Recusados:</span>
                      <span className="font-medium text-red-600">{stat.leads_refused}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-amber-500" />
                      <span className="text-muted-foreground">Sem resposta:</span>
                      <span className="font-medium text-amber-600">{stat.without_response_count}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {agentStats.filter(s => Object.keys(s.conversations_by_stage).length > 0).length === 0 && !loading && (
              <div className="text-center py-12 text-muted-foreground">
                <Filter className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Nenhum dado de funil disponível</p>
                <p className="text-[10px]">Vincule leads às conversas para ver a distribuição por etapa</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* TAB: Follow-ups */}
        <TabsContent value="followups">
          <FollowupActivityPanel />
        </TabsContent>

        {/* TAB: Call Queue */}
        <TabsContent value="call-queue">
          <CallQueuePanel onSelectConversation={(phone, instanceName, contactName) => {
            setChatPreview({ phone, instance_name: instanceName, contact_name: contactName || '', lead_name: '', inbound_count: 0, outbound_count: 0, is_active: false, activated_at: null, campaign_name: null, activated_by: null } as any);
          }} />
        </TabsContent>

        {/* TAB: AI Data */}
        <TabsContent value="ai-data">
          <AIEnrichmentMonitorPanel />
        </TabsContent>
      </Tabs>

      {/* KPI Conversations Sheet */}
      <Sheet open={!!kpiSheet} onOpenChange={(open) => { if (!open) { setKpiSheet(null); setSheetAgentFilter('all'); setSheetActivatedByFilter('all'); setSheetCampaignFilter('all'); setSheetInstanceFilter('all'); setSheetActivatedDateFilter('all'); } }}>
        <SheetContent side="right" className="w-[400px] sm:w-[480px] p-0 flex flex-col">
          <div className="shrink-0 px-4 py-3 border-b bg-primary/5">
            <SheetHeader>
              <SheetTitle className="text-sm flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-primary" />
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm">{kpiSheet?.label}</div>
                  <div className="text-[10px] text-muted-foreground font-normal">
                    {kpiSheetConversations.length} conversas
                  </div>
                </div>
              </SheetTitle>
            </SheetHeader>
            <div className="flex flex-wrap gap-2 mt-2">
              <div className="flex-1 min-w-[100px]">
                <label className="text-[9px] font-medium text-muted-foreground mb-0.5 block">Agente</label>
                <Select value={sheetAgentFilter} onValueChange={setSheetAgentFilter}>
                  <SelectTrigger className="h-7 text-[10px]">
                    <SelectValue placeholder="Agente" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos agentes</SelectItem>
                    {uniqueSheetAgents.map(([id, name]) => (
                      <SelectItem key={id} value={id}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-[100px]">
                <label className="text-[9px] font-medium text-muted-foreground mb-0.5 block">Ativação</label>
                <Select value={sheetActivatedByFilter} onValueChange={setSheetActivatedByFilter}>
                  <SelectTrigger className="h-7 text-[10px]">
                    <SelectValue placeholder="Ativação" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas ativações</SelectItem>
                    {uniqueActivatedBy.map(v => (
                      <SelectItem key={v} value={v}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-[100px]">
                <label className="text-[9px] font-medium text-muted-foreground mb-0.5 block">Campanha</label>
                <Select value={sheetCampaignFilter} onValueChange={setSheetCampaignFilter}>
                  <SelectTrigger className="h-7 text-[10px]">
                    <SelectValue placeholder="Campanha" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas campanhas</SelectItem>
                    {uniqueCampaigns.campaigns.map(v => (
                      <SelectItem key={v} value={v}>{v}</SelectItem>
                    ))}
                    {uniqueCampaigns.hasNoCampaign && (
                      <SelectItem value="__none__">Sem campanha</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-[100px]">
                <label className="text-[9px] font-medium text-muted-foreground mb-0.5 block">Instância</label>
                <Select value={sheetInstanceFilter} onValueChange={setSheetInstanceFilter}>
                  <SelectTrigger className="h-7 text-[10px]">
                    <SelectValue placeholder="Instância" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas instâncias</SelectItem>
                    {uniqueInstances.map(v => (
                      <SelectItem key={v} value={v}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-[100px]">
                <label className="text-[9px] font-medium text-muted-foreground mb-0.5 block">Data Ativação</label>
                <Select value={sheetActivatedDateFilter} onValueChange={setSheetActivatedDateFilter}>
                  <SelectTrigger className="h-7 text-[10px]">
                    <SelectValue placeholder="Data Ativação" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas datas</SelectItem>
                    {uniqueActivatedDates.map(v => (
                      <SelectItem key={v} value={v}>{format(new Date(v + 'T12:00:00'), 'dd/MM/yyyy')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* Batch actions */}
            <div className="flex items-center justify-between mt-1 mb-1">
              <span className="text-[10px] text-muted-foreground">
                {selectedSheetConversations.length}/{kpiSheetConversations.length} selecionadas
              </span>
              <Button variant="ghost" size="sm" className="h-5 text-[9px] px-2" onClick={() => {
                if (excludedPhones.size === 0) {
                  setExcludedPhones(new Set(kpiSheetConversations.map(c => c.phone)));
                } else {
                  setExcludedPhones(new Set());
                }
              }}>
                {excludedPhones.size === 0 ? 'Desmarcar todos' : 'Selecionar todos'}
              </Button>
            </div>
            <div className="flex gap-1 flex-wrap">
              {selectedSheetConversations.filter(c => !c.is_active).length > 0 && (
                <Button
                  variant="default"
                  size="sm"
                  className="flex-1 h-7 text-[10px] bg-emerald-600 hover:bg-emerald-700"
                  onClick={async () => {
                    const targets = selectedSheetConversations.filter(c => !c.is_active);
                    if (!confirm(`Ativar agente em ${targets.length} conversas selecionadas?`)) return;
                    const phones = targets.map(c => c.phone);
                    const { error } = await supabase
                      .from('whatsapp_conversation_agents')
                      .update({ is_active: true, human_paused_until: null } as any)
                      .in('phone', phones);
                    if (!error) {
                      toast.success(`${targets.length} agentes ativados`);
                      fetchData();
                    }
                  }}
                >
                  <Bot className="h-3 w-3 mr-1" />
                  Ativar {selectedSheetConversations.filter(c => !c.is_active).length}
                </Button>
              )}
              {selectedSheetConversations.filter(c => c.is_active).length > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="flex-1 h-7 text-[10px]"
                  onClick={async () => {
                    const targets = selectedSheetConversations.filter(c => c.is_active);
                    if (!confirm(`Desativar agente em ${targets.length} conversas selecionadas?`)) return;
                    const phones = targets.map(c => c.phone);
                    const { error } = await supabase
                      .from('whatsapp_conversation_agents')
                      .update({ is_active: false } as any)
                      .in('phone', phones);
                    if (!error) {
                      toast.success(`${targets.length} agentes desativados`);
                      fetchData();
                    }
                  }}
                >
                  <PowerOff className="h-3 w-3 mr-1" />
                  Desativar {selectedSheetConversations.filter(c => c.is_active).length}
                </Button>
              )}
              {selectedSheetConversations.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 h-7 text-[10px]"
                  onClick={async () => {
                    const targets = selectedSheetConversations;
                    if (!confirm(`Ligar para ${targets.length} conversas selecionadas?`)) return;
                    const inserts = targets.map(c => ({
                      phone: c.phone,
                      instance_name: c.instance_name,
                      status: 'pending',
                      priority: 5,
                      call_type: 'flash',
                    }));
                    const { error } = await supabase
                      .from('whatsapp_call_queue')
                      .insert(inserts as any);
                    if (!error) {
                      toast.success(`${targets.length} ligações adicionadas à fila`);
                    } else {
                      toast.error('Erro ao adicionar ligações à fila');
                    }
                  }}
                >
                  <PhoneOutgoing className="h-3 w-3 mr-1" />
                  Ligar {selectedSheetConversations.length}
                </Button>
              )}
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-2">
              {kpiSheetConversations.map((c, idx) => {
                const isSelected = !excludedPhones.has(c.phone);
                return (
                <Card
                  key={`${c.phone}-${c.instance_name}-${idx}`}
                  className={`cursor-pointer hover:shadow-md transition-shadow ${!isSelected ? 'opacity-40' : ''}`}
                  onClick={() => setChatPreview(c)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start gap-2">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => {
                          const next = new Set(excludedPhones);
                          if (checked) { next.delete(c.phone); } else { next.add(c.phone); }
                          setExcludedPhones(next);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 shrink-0"
                      />
                      <div className="flex items-start justify-between gap-2 flex-1 min-w-0">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold truncate">{c.contact_name || c.lead_name || c.phone}</span>
                          {c.is_active && !c.human_paused && (
                            <Badge className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400 text-[9px] h-4">Ativo</Badge>
                          )}
                          {c.human_paused && (
                            <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 text-[9px] h-4">Pausado</Badge>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{c.phone}</div>
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-0.5">
                            <Bot className="h-3 w-3" /> {c.agent_name}
                          </span>
                          {c.lead_city && (
                            <span className="flex items-center gap-0.5">
                              <MapPin className="h-3 w-3" /> {c.lead_city}{c.lead_state ? `/${c.lead_state}` : ''}
                            </span>
                          )}
                        </div>
                        {c.activated_by && (
                          <Badge variant="outline" className="text-[9px] h-4 mt-1 border-blue-200 text-blue-600 dark:border-blue-800 dark:text-blue-400">
                            ⚡ {activatedByLabel(c.activated_by)}
                          </Badge>
                        )}
                        {c.campaign_name && (
                          <Badge variant="secondary" className="text-[9px] h-4 mt-1">
                            <Megaphone className="h-2.5 w-2.5 mr-0.5" /> {c.campaign_name}
                          </Badge>
                        )}
                        {c.board_name && c.stage_name && (
                          <Badge variant="outline" className="text-[9px] h-4 mt-1">{c.board_name} → {c.stage_name}</Badge>
                        )}
                      </div>
                      <div className="text-right shrink-0 space-y-1">
                        {c.time_without_response != null && c.time_without_response > 0 && (
                          <p className={`text-[10px] font-medium ${c.time_without_response > 120 ? 'text-red-500' : c.time_without_response > 60 ? 'text-amber-500' : 'text-muted-foreground'}`}>
                            {formatTimeAgo(c.time_without_response)}
                          </p>
                        )}
                        <p className="text-[9px] text-muted-foreground">📩 {c.inbound_count} 📤 {c.outbound_count}</p>
                        <ExternalLink className="h-3 w-3 text-muted-foreground ml-auto" />
                      </div>
                    </div>
                    </div>
                  </CardContent>
                </Card>
                );
              })}
              {kpiSheetConversations.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Nenhuma conversa nesta categoria</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Chat Preview Drawer */}
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
    </div>
  );
}
