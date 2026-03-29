import { useState, useEffect, useMemo } from 'react';
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
  Filter, MapPin, Phone, PhoneCall
} from 'lucide-react';
import { CallQueuePanel } from './CallQueuePanel';
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
  lead_status: string | null;
  lead_city: string | null;
  lead_state: string | null;
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
  const [periodDays, setPeriodDays] = useState(7);

  const fetchData = async () => {
    setLoading(true);
    try {
      const startDate = subDays(new Date(), periodDays).toISOString();

      // Fetch agents
      const { data: agentsData } = await supabase
        .from('wjia_command_shortcuts')
        .select('id, shortcut_name, description, is_active')
        .eq('command_scope', 'conversation')
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

      // Fetch leads with location data
      const { data: leads } = await supabase
        .from('leads')
        .select('id, lead_name, lead_phone, status, board_id, city, state, neighborhood, followup_count')
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
          lead_status: lead?.status || null,
          lead_city: lead?.city || null,
          lead_state: lead?.state || null,
          board_name: boardName,
          stage_name: stageName,
          last_inbound_at: lastInbound,
          last_outbound_at: lastOutbound,
          total_messages: msgs.length,
          inbound_count: inboundMsgs.length,
          outbound_count: outboundMsgs.length,
          followup_count: lead ? (followupsByLead.get(lead.id) || 0) : 0,
          time_without_response: timeWithoutResponse,
          campaign_name: msgs.find((m: any) => m.campaign_name)?.campaign_name || null,
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
        if (c.lead_status === 'closed' || c.lead_status === 'converted') stat.leads_closed++;
        if (c.lead_status === 'refused' || c.lead_status === 'lost') stat.leads_refused++;
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
  }, [conversations, selectedAgent, statusFilter, cityFilter, stateFilter, searchQuery]);

  const uniqueCities = useMemo(() => [...new Set(conversations.map(c => c.lead_city).filter(Boolean))].sort(), [conversations]);
  const uniqueStates = useMemo(() => [...new Set(conversations.map(c => c.lead_state).filter(Boolean))].sort(), [conversations]);

  // Global KPIs
  const globalStats = useMemo(() => {
    const total = conversations.length;
    const active = conversations.filter(c => c.is_active && !c.human_paused).length;
    const paused = conversations.filter(c => c.human_paused).length;
    const noResponse = conversations.filter(c => c.time_without_response && c.time_without_response > 60).length;
    const totalFollowups = conversations.reduce((sum, c) => sum + c.followup_count, 0);
    const totalMsgsSent = conversations.reduce((sum, c) => sum + c.outbound_count, 0);
    const totalMsgsReceived = conversations.reduce((sum, c) => sum + c.inbound_count, 0);
    const closed = conversations.filter(c => c.lead_status === 'closed' || c.lead_status === 'converted').length;
    const refused = conversations.filter(c => c.lead_status === 'refused' || c.lead_status === 'lost').length;
    return { total, active, paused, noResponse, totalFollowups, totalMsgsSent, totalMsgsReceived, closed, refused };
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
        <div className="flex items-center gap-2">
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
        <Card className="border-primary/20">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <MessageCircle className="h-3.5 w-3.5" />
              Total Conversas
            </div>
            <p className="text-2xl font-bold">{globalStats.total}</p>
            <div className="flex gap-2 mt-1">
              <Badge variant="secondary" className="text-[9px]">{globalStats.active} ativas</Badge>
              <Badge variant="outline" className="text-[9px]">{globalStats.paused} pausadas</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <TrendingUp className="h-3.5 w-3.5" />
              Msgs Enviadas
            </div>
            <p className="text-2xl font-bold">{globalStats.totalMsgsSent}</p>
            <p className="text-[10px] text-muted-foreground">{globalStats.totalMsgsReceived} recebidas</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Zap className="h-3.5 w-3.5" />
              Follow-ups
            </div>
            <p className="text-2xl font-bold">{globalStats.totalFollowups}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <CheckCircle className="h-3.5 w-3.5 text-green-500" />
              Fechados
            </div>
            <p className="text-2xl font-bold text-green-600">{globalStats.closed}</p>
            <p className="text-[10px] text-red-500">{globalStats.refused} recusados</p>
          </CardContent>
        </Card>

        <Card>
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
        <TabsList className="grid w-full grid-cols-4 max-w-lg">
          <TabsTrigger value="agents" className="text-xs">Por Agente</TabsTrigger>
          <TabsTrigger value="conversations" className="text-xs">Conversas</TabsTrigger>
          <TabsTrigger value="funnel" className="text-xs">Funil</TabsTrigger>
          <TabsTrigger value="call-queue" className="text-xs flex items-center gap-1">
            <PhoneCall className="h-3 w-3" /> Fila Ligações
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

        {/* TAB: Call Queue */}
        <TabsContent value="call-queue">
          <CallQueuePanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
