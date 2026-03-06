import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, LabelList } from 'recharts';
import { Users, Clock, TrendingUp, MessageSquare, Zap, Target, Timer, BarChart3, PhoneForwarded, FileSignature, ExternalLink } from 'lucide-react';
import { format, subDays, startOfDay, endOfDay, differenceInMinutes, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface LeadWithMessages {
  id: string;
  lead_name: string;
  source: string;
  status: string;
  created_at: string;
  campaign_name: string | null;
  adset_name: string | null;
  ad_name: string | null;
  first_response_at?: string | null;
}

interface ConversationSummary {
  phone: string;
  firstMessageAt: string;
  inboundCount: number;
  outboundCount: number;
  hasOutboundReply: boolean;
  firstInboundAt: string | null;
  firstOutboundAt: string | null;
  instanceName: string | null;
  leadId: string | null;
  leadName: string | null;
}

const PERIOD_OPTIONS = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: 'this_week', label: 'Esta semana' },
  { value: 'this_month', label: 'Este mês' },
  { value: 'this_year', label: 'Este ano' },
  { value: '7', label: 'Últimos 7 dias' },
  { value: '14', label: 'Últimos 14 dias' },
  { value: '30', label: 'Últimos 30 dias' },
  { value: '60', label: 'Últimos 60 dias' },
  { value: '90', label: 'Últimos 90 dias' },
];

const COLORS = ['hsl(var(--primary))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

function getTimePeriod(hour: number): string {
  if (hour >= 6 && hour < 12) return 'Manhã (6h-12h)';
  if (hour >= 12 && hour < 18) return 'Tarde (12h-18h)';
  if (hour >= 18 && hour < 24) return 'Noite (18h-00h)';
  return 'Madrugada (00h-6h)';
}

export function WhatsAppLeadsDashboard() {
  const [leads, setLeads] = useState<LeadWithMessages[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('today');
  const [instances, setInstances] = useState<any[]>([]);
  const [selectedInstance, setSelectedInstance] = useState('all');

  // New metrics state
  const [todayNewConvs, setTodayNewConvs] = useState<{ phone: string; contact_name: string | null; first_message_at: string; instance_name: string | null }[]>([]);
  const [todayFollowups, setTodayFollowups] = useState<{ phone: string; contact_name: string | null; outbound_count: number; last_outbound_at: string; instance_name: string | null }[]>([]);
  const [todayDocs, setTodayDocs] = useState<{ id: string; document_name: string; template_name: string | null; signer_name: string | null; status: string; created_at: string }[]>([]);
  const [sheetOpen, setSheetOpen] = useState<'new_convs' | 'followups' | 'documents' | null>(null);

  useEffect(() => {
    fetchData();
  }, [period]);

  const fetchData = async () => {
    setLoading(true);
    const now = new Date();
    let sinceDate: Date;
    let untilDate: Date | null = null;
    switch (period) {
      case 'today':
        sinceDate = startOfDay(now);
        break;
      case 'yesterday':
        sinceDate = startOfDay(subDays(now, 1));
        untilDate = endOfDay(subDays(now, 1));
        break;
      case 'this_week': {
        const day = now.getDay();
        const diff = day === 0 ? 6 : day - 1;
        sinceDate = startOfDay(subDays(now, diff));
        break;
      }
      case 'this_month':
        sinceDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'this_year':
        sinceDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        sinceDate = subDays(now, parseInt(period));
    }
    const since = sinceDate.toISOString();

    let leadsQuery = supabase
      .from('leads')
      .select('id, lead_name, source, status, created_at, campaign_name, adset_name, ad_name')
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    
    let msgsQuery = supabase
      .from('whatsapp_messages')
      .select('id, phone, direction, created_at, lead_id, instance_name')
      .gte('created_at', since)
      .order('created_at', { ascending: true });

    if (untilDate) {
      leadsQuery = leadsQuery.lte('created_at', untilDate.toISOString());
      msgsQuery = msgsQuery.lte('created_at', untilDate.toISOString());
    }

    const [leadsRes, msgsRes, instRes] = await Promise.all([
      leadsQuery,
      msgsQuery,
      supabase
        .from('whatsapp_instances')
        .select('id, instance_name, receive_leads, ad_account_name')
        .eq('is_active', true),
    ]);

    if (leadsRes.data) setLeads(leadsRes.data as LeadWithMessages[]);
    if (msgsRes.data) setMessages(msgsRes.data);
    if (instRes.data) setInstances(instRes.data);
    setLoading(false);

    // Fetch today's metrics for new cards
    fetchTodayMetrics();
  };

  const fetchTodayMetrics = async () => {
    const todayStart = startOfDay(new Date()).toISOString();

    const [newConvsRes, followupsRes, docsRes] = await Promise.all([
      // New inbound conversations today (first message per phone)
      supabase
        .from('whatsapp_messages')
        .select('phone, contact_name, created_at, instance_name')
        .eq('direction', 'inbound')
        .gte('created_at', todayStart)
        .order('created_at', { ascending: true })
        .limit(500),
      // Outbound follow-ups today
      supabase
        .from('whatsapp_messages')
        .select('phone, contact_name, created_at, instance_name')
        .eq('direction', 'outbound')
        .gte('created_at', todayStart)
        .order('created_at', { ascending: false })
        .limit(500),
      // Documents generated today
      supabase
        .from('zapsign_documents')
        .select('id, document_name, template_name, signer_name, status, created_at')
        .gte('created_at', todayStart)
        .order('created_at', { ascending: false }),
    ]);

    // Build unique new conversations (first inbound per phone today)
    if (newConvsRes.data) {
      const phoneMap = new Map<string, { phone: string; contact_name: string | null; first_message_at: string; instance_name: string | null }>();
      for (const msg of newConvsRes.data) {
        if (!phoneMap.has(msg.phone)) {
          phoneMap.set(msg.phone, { phone: msg.phone, contact_name: msg.contact_name, first_message_at: msg.created_at, instance_name: msg.instance_name });
        }
      }
      setTodayNewConvs(Array.from(phoneMap.values()));
    }

    // Build follow-ups (outbound messages grouped by phone)
    if (followupsRes.data) {
      const phoneMap = new Map<string, { phone: string; contact_name: string | null; outbound_count: number; last_outbound_at: string; instance_name: string | null }>();
      for (const msg of followupsRes.data) {
        const existing = phoneMap.get(msg.phone);
        if (!existing) {
          phoneMap.set(msg.phone, { phone: msg.phone, contact_name: msg.contact_name, outbound_count: 1, last_outbound_at: msg.created_at, instance_name: msg.instance_name });
        } else {
          existing.outbound_count++;
        }
      }
      setTodayFollowups(Array.from(phoneMap.values()));
    }

    if (docsRes.data) {
      setTodayDocs(docsRes.data as any[]);
    }
  };

  // Filter messages by selected instance
  const filteredMessages = useMemo(() => {
    if (selectedInstance === 'all') return messages;
    return messages.filter(m => m.instance_name === selectedInstance);
  }, [messages, selectedInstance]);

  // Build conversations from messages (grouped by phone)
  const conversations = useMemo<ConversationSummary[]>(() => {
    const phoneMap = new Map<string, ConversationSummary>();
    filteredMessages.forEach(msg => {
      const existing = phoneMap.get(msg.phone);
      if (!existing) {
        phoneMap.set(msg.phone, {
          phone: msg.phone,
          firstMessageAt: msg.created_at,
          inboundCount: msg.direction === 'inbound' ? 1 : 0,
          outboundCount: msg.direction === 'outbound' ? 1 : 0,
          hasOutboundReply: msg.direction === 'outbound',
          firstInboundAt: msg.direction === 'inbound' ? msg.created_at : null,
          firstOutboundAt: msg.direction === 'outbound' ? msg.created_at : null,
          instanceName: msg.instance_name,
          leadId: msg.lead_id,
          leadName: null,
        });
      } else {
        if (msg.direction === 'inbound') {
          existing.inboundCount++;
          if (!existing.firstInboundAt) existing.firstInboundAt = msg.created_at;
        } else {
          existing.outboundCount++;
          existing.hasOutboundReply = true;
          if (!existing.firstOutboundAt) existing.firstOutboundAt = msg.created_at;
        }
        if (!existing.leadId && msg.lead_id) existing.leadId = msg.lead_id;
      }
    });
    return Array.from(phoneMap.values());
  }, [filteredMessages]);

  // Only inbound conversations (new contacts reaching out)
  const inboundConversations = useMemo(() => {
    return conversations.filter(c => c.inboundCount > 0);
  }, [conversations]);

  // Get lead IDs that have messages from selected instance
  const filteredLeadIds = useMemo(() => {
    if (selectedInstance === 'all') return null;
    const ids = new Set<string>();
    filteredMessages.forEach(m => { if (m.lead_id) ids.add(m.lead_id); });
    return ids;
  }, [filteredMessages, selectedInstance]);

  const filteredLeads = useMemo(() => {
    if (!filteredLeadIds) return leads;
    return leads.filter(l => filteredLeadIds.has(l.id));
  }, [leads, filteredLeadIds]);

  // Calculate response metrics based on conversations (by phone), not just leads
  const responseMetrics = useMemo(() => {
    const responseTimes: number[] = [];
    
    inboundConversations.forEach(conv => {
      if (conv.firstInboundAt && conv.firstOutboundAt) {
        const diff = differenceInMinutes(parseISO(conv.firstOutboundAt), parseISO(conv.firstInboundAt));
        if (diff >= 0 && diff < 1440) responseTimes.push(diff);
      }
    });

    const avgResponseTime = responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : 0;

    const conversationsWithReply = inboundConversations.filter(c => c.hasOutboundReply).length;
    const totalInbound = inboundConversations.length;
    const responseRate = totalInbound > 0 ? Math.round((conversationsWithReply / totalInbound) * 100) : 0;

    return { avgResponseTime, responseRate, responseTimes, leadsWithResponse: conversationsWithReply, leadsWithInbound: totalInbound };
  }, [inboundConversations]);

  // Conversations by day (using first inbound message time)
  const leadsByDay = useMemo(() => {
    const dayMap = new Map<string, number>();
    inboundConversations.forEach(c => {
      const day = format(parseISO(c.firstInboundAt!), 'dd/MM', { locale: ptBR });
      dayMap.set(day, (dayMap.get(day) || 0) + 1);
    });
    return Array.from(dayMap.entries())
      .map(([day, count]) => ({ day, count }))
      .reverse();
  }, [inboundConversations]);

  // Conversations by time period
  const leadsByTimePeriod = useMemo(() => {
    const periodMap = new Map<string, number>();
    ['Madrugada (00h-6h)', 'Manhã (6h-12h)', 'Tarde (12h-18h)', 'Noite (18h-00h)'].forEach(p => periodMap.set(p, 0));
    
    inboundConversations.forEach(c => {
      const hour = parseISO(c.firstInboundAt!).getHours();
      const p = getTimePeriod(hour);
      periodMap.set(p, (periodMap.get(p) || 0) + 1);
    });
    return Array.from(periodMap.entries()).map(([name, value]) => ({ name, value }));
  }, [inboundConversations]);

  // Conversations by hour
  const leadsByHour = useMemo(() => {
    const hourMap = new Map<number, number>();
    for (let i = 0; i < 24; i++) hourMap.set(i, 0);
    inboundConversations.forEach(c => {
      const hour = parseISO(c.firstInboundAt!).getHours();
      hourMap.set(hour, (hourMap.get(hour) || 0) + 1);
    });
    return Array.from(hourMap.entries()).map(([hour, count]) => ({
      hour: `${hour}h`,
      count,
    }));
  }, [inboundConversations]);

  // Conversion metrics
  const conversionMetrics = useMemo(() => {
    const total = filteredLeads.length;
    const qualified = filteredLeads.filter(l => l.status === 'qualified' || l.status === 'converted').length;
    const converted = filteredLeads.filter(l => l.status === 'converted').length;
    
    return {
      total,
      qualified,
      converted,
      qualificationRate: total > 0 ? Math.round((qualified / total) * 100) : 0,
      conversionRate: total > 0 ? Math.round((converted / total) * 100) : 0,
    };
  }, [filteredLeads]);

  // 80/20 - Top campaigns
  const topCampaigns = useMemo(() => {
    const campaignMap = new Map<string, { count: number; converted: number }>();
    filteredLeads.forEach(l => {
      const name = l.campaign_name || 'Sem Campanha';
      const existing = campaignMap.get(name) || { count: 0, converted: 0 };
      existing.count++;
      if (l.status === 'converted' || l.status === 'qualified') existing.converted++;
      campaignMap.set(name, existing);
    });
    return Array.from(campaignMap.entries())
      .map(([name, data]) => ({
        name: name.length > 30 ? name.slice(0, 30) + '...' : name,
        fullName: name,
        leads: data.count,
        converted: data.converted,
        rate: data.count > 0 ? Math.round((data.converted / data.count) * 100) : 0,
      }))
      .sort((a, b) => b.leads - a.leads)
      .slice(0, 10);
  }, [filteredLeads]);

  // Leads by instance (for receiving instances)
  const leadsByInstance = useMemo(() => {
    const receiveInstances = instances.filter(i => i.receive_leads);
    if (receiveInstances.length === 0) return [];

    const instMap = new Map<string, number>();
    messages.forEach(msg => {
      if (msg.direction === 'inbound' && msg.instance_name) {
        instMap.set(msg.instance_name, (instMap.get(msg.instance_name) || 0) + 1);
      }
    });
    return receiveInstances.map(inst => ({
      name: inst.instance_name,
      adAccount: inst.ad_account_name || 'N/A',
      messages: instMap.get(inst.instance_name) || 0,
    }));
  }, [instances, messages]);

  // Response time distribution
  const responseTimeDistribution = useMemo(() => {
    const buckets = [
      { label: '< 5min', max: 5, count: 0 },
      { label: '5-15min', max: 15, count: 0 },
      { label: '15-30min', max: 30, count: 0 },
      { label: '30-60min', max: 60, count: 0 },
      { label: '1-2h', max: 120, count: 0 },
      { label: '> 2h', max: Infinity, count: 0 },
    ];
    responseMetrics.responseTimes.forEach(t => {
      const bucket = buckets.find(b => t < b.max);
      if (bucket) bucket.count++;
    });
    return buckets.map(b => ({ name: b.label, value: b.count }));
  }, [responseMetrics]);

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground">Carregando dashboard...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Dashboard de Leads
          </h2>
          <p className="text-xs text-muted-foreground">Análise de performance de captação via WhatsApp e Anúncios</p>
        </div>
        <div className="flex items-center gap-2">
          {instances.length > 0 && (
            <Select value={selectedInstance} onValueChange={setSelectedInstance}>
              <SelectTrigger className="w-48 h-8 text-xs">
                <SelectValue placeholder="Instância" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas instâncias</SelectItem>
                {instances.map(i => (
                  <SelectItem key={i.id} value={i.instance_name}>{i.instance_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Conversas</span>
            </div>
            <p className="text-2xl font-bold">{inboundConversations.length}</p>
            <p className="text-xs text-muted-foreground">{filteredMessages.length} msgs | {conversionMetrics.total} leads</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Target className="h-4 w-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Qualificados</span>
            </div>
            <p className="text-2xl font-bold">{conversionMetrics.qualified}</p>
            <Badge variant="outline" className="text-xs">{conversionMetrics.qualificationRate}%</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">Convertidos</span>
            </div>
            <p className="text-2xl font-bold">{conversionMetrics.converted}</p>
            <Badge variant="outline" className="text-xs">{conversionMetrics.conversionRate}%</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="h-4 w-4 text-orange-500" />
              <span className="text-xs text-muted-foreground">Taxa Resposta</span>
            </div>
            <p className="text-2xl font-bold">{responseMetrics.responseRate}%</p>
            <p className="text-xs text-muted-foreground">{responseMetrics.leadsWithResponse}/{responseMetrics.leadsWithInbound}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Timer className="h-4 w-4 text-purple-500" />
              <span className="text-xs text-muted-foreground">Tempo Médio</span>
            </div>
            <p className="text-2xl font-bold">
              {responseMetrics.avgResponseTime < 60
                ? `${responseMetrics.avgResponseTime}min`
                : `${Math.round(responseMetrics.avgResponseTime / 60)}h`
              }
            </p>
            <p className="text-xs text-muted-foreground">1ª resposta</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="h-4 w-4 text-yellow-500" />
              <span className="text-xs text-muted-foreground">Resp. &lt; 5min</span>
            </div>
            <p className="text-2xl font-bold">
              {responseMetrics.responseTimes.length > 0
                ? Math.round((responseMetrics.responseTimes.filter(t => t < 5).length / responseMetrics.responseTimes.length) * 100)
                : 0}%
            </p>
            <p className="text-xs text-muted-foreground">velocidade ideal</p>
          </CardContent>
        </Card>
      </div>

      {/* Today's Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card 
          className="cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all"
          onClick={() => setSheetOpen('new_convs')}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Conversas Novas Hoje</span>
            </div>
            <p className="text-2xl font-bold">{todayNewConvs.length}</p>
            <p className="text-xs text-muted-foreground">Clique para ver a lista</p>
          </CardContent>
        </Card>
        <Card 
          className="cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all"
          onClick={() => setSheetOpen('followups')}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <PhoneForwarded className="h-4 w-4 text-emerald-500" />
              <span className="text-xs text-muted-foreground">Follow-ups Hoje</span>
            </div>
            <p className="text-2xl font-bold">{todayFollowups.length}</p>
            <p className="text-xs text-muted-foreground">Clique para ver a lista</p>
          </CardContent>
        </Card>
        <Card 
          className="cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all"
          onClick={() => setSheetOpen('documents')}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <FileSignature className="h-4 w-4 text-amber-500" />
              <span className="text-xs text-muted-foreground">Documentos Gerados Hoje</span>
            </div>
            <p className="text-2xl font-bold">{todayDocs.length}</p>
            <p className="text-xs text-muted-foreground">Clique para ver a lista</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Leads por Dia */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Leads por Dia</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={leadsByDay}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Leads" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Leads por Período do Dia */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Leads por Período do Dia</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={leadsByTimePeriod}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={3}
                  dataKey="value"
                  nameKey="name"
                  label={({ name, value }) => `${name.split(' ')[0]}: ${value}`}
                >
                  {leadsByTimePeriod.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Leads por Hora */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Distribuição por Hora</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={leadsByHour}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} name="Leads">
                  <LabelList dataKey="count" position="top" style={{ fontSize: 9, fill: 'hsl(var(--foreground))', fontWeight: 600 }} formatter={(v: number) => v > 0 ? v : ''} />
                </Line>
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Tempo de Resposta */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Distribuição do Tempo de Resposta</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={responseTimeDistribution}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="value" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} name="Leads" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* 80/20 - Top Campaigns */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Análise 80/20 - Top Campanhas
          </CardTitle>
          <p className="text-xs text-muted-foreground">Quais campanhas trazem mais resultados</p>
        </CardHeader>
        <CardContent>
          {topCampaigns.length > 0 ? (
            <div className="space-y-2">
              {topCampaigns.map((campaign, i) => {
                const percent = conversionMetrics.total > 0
                  ? Math.round((campaign.leads / conversionMetrics.total) * 100)
                  : 0;
                return (
                  <div key={i} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50">
                    <Badge variant={i < 3 ? 'default' : 'outline'} className="text-xs w-6 h-6 flex items-center justify-center p-0">
                      {i + 1}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate" title={campaign.fullName}>{campaign.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">{percent}%</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold">{campaign.leads}</p>
                      <p className="text-xs text-muted-foreground">{campaign.converted} conv.</p>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {campaign.rate}%
                    </Badge>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhuma campanha encontrada no período</p>
          )}
        </CardContent>
      </Card>

      {/* Leads by Instance */}
      {leadsByInstance.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Mensagens por Instância (Recebe Leads)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {leadsByInstance.map((inst, i) => (
                <div key={i} className="flex items-center justify-between p-2 border rounded-lg">
                  <div>
                    <p className="text-sm font-medium">{inst.name}</p>
                    <p className="text-xs text-muted-foreground">Conta: {inst.adAccount}</p>
                  </div>
                  <Badge>{inst.messages} msgs</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
