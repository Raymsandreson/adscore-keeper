import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { Users, Clock, TrendingUp, MessageSquare, Zap, Target, Timer, BarChart3 } from 'lucide-react';
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

const PERIOD_OPTIONS = [
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
  const [period, setPeriod] = useState('30');
  const [instances, setInstances] = useState<any[]>([]);

  useEffect(() => {
    fetchData();
  }, [period]);

  const fetchData = async () => {
    setLoading(true);
    const since = subDays(new Date(), parseInt(period)).toISOString();

    const [leadsRes, msgsRes, instRes] = await Promise.all([
      supabase
        .from('leads')
        .select('id, lead_name, source, status, created_at, campaign_name, adset_name, ad_name')
        .gte('created_at', since)
        .order('created_at', { ascending: false }),
      supabase
        .from('whatsapp_messages')
        .select('id, phone, direction, created_at, lead_id, instance_name')
        .gte('created_at', since)
        .order('created_at', { ascending: true }),
      supabase
        .from('whatsapp_instances')
        .select('id, instance_name, receive_leads, ad_account_name')
        .eq('is_active', true),
    ]);

    if (leadsRes.data) setLeads(leadsRes.data as LeadWithMessages[]);
    if (msgsRes.data) setMessages(msgsRes.data);
    if (instRes.data) setInstances(instRes.data);
    setLoading(false);
  };

  // Calculate first response times for leads with WhatsApp messages
  const responseMetrics = useMemo(() => {
    const leadFirstInbound = new Map<string, string>();
    const leadFirstOutbound = new Map<string, string>();

    messages.forEach(msg => {
      if (!msg.lead_id) return;
      if (msg.direction === 'inbound' && !leadFirstInbound.has(msg.lead_id)) {
        leadFirstInbound.set(msg.lead_id, msg.created_at);
      }
      if (msg.direction === 'outbound' && !leadFirstOutbound.has(msg.lead_id)) {
        leadFirstOutbound.set(msg.lead_id, msg.created_at);
      }
    });

    const responseTimes: number[] = [];
    leadFirstInbound.forEach((inboundTime, leadId) => {
      const outboundTime = leadFirstOutbound.get(leadId);
      if (outboundTime) {
        const diff = differenceInMinutes(parseISO(outboundTime), parseISO(inboundTime));
        if (diff >= 0 && diff < 1440) responseTimes.push(diff);
      }
    });

    const avgResponseTime = responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : 0;

    const leadsWithResponse = leadFirstOutbound.size;
    const leadsWithInbound = leadFirstInbound.size;
    const responseRate = leadsWithInbound > 0 ? Math.round((leadsWithResponse / leadsWithInbound) * 100) : 0;

    return { avgResponseTime, responseRate, responseTimes, leadsWithResponse, leadsWithInbound };
  }, [messages]);

  // Leads by day
  const leadsByDay = useMemo(() => {
    const dayMap = new Map<string, number>();
    leads.forEach(l => {
      const day = format(parseISO(l.created_at), 'dd/MM', { locale: ptBR });
      dayMap.set(day, (dayMap.get(day) || 0) + 1);
    });
    return Array.from(dayMap.entries())
      .map(([day, count]) => ({ day, count }))
      .reverse();
  }, [leads]);

  // Leads by time period
  const leadsByTimePeriod = useMemo(() => {
    const periodMap = new Map<string, number>();
    ['Madrugada (00h-6h)', 'Manhã (6h-12h)', 'Tarde (12h-18h)', 'Noite (18h-00h)'].forEach(p => periodMap.set(p, 0));
    
    leads.forEach(l => {
      const hour = parseISO(l.created_at).getHours();
      const p = getTimePeriod(hour);
      periodMap.set(p, (periodMap.get(p) || 0) + 1);
    });
    return Array.from(periodMap.entries()).map(([name, value]) => ({ name, value }));
  }, [leads]);

  // Leads by hour
  const leadsByHour = useMemo(() => {
    const hourMap = new Map<number, number>();
    for (let i = 0; i < 24; i++) hourMap.set(i, 0);
    leads.forEach(l => {
      const hour = parseISO(l.created_at).getHours();
      hourMap.set(hour, (hourMap.get(hour) || 0) + 1);
    });
    return Array.from(hourMap.entries()).map(([hour, count]) => ({
      hour: `${hour}h`,
      count,
    }));
  }, [leads]);

  // Conversion metrics
  const conversionMetrics = useMemo(() => {
    const total = leads.length;
    const qualified = leads.filter(l => l.status === 'qualified' || l.status === 'converted').length;
    const converted = leads.filter(l => l.status === 'converted').length;
    
    return {
      total,
      qualified,
      converted,
      qualificationRate: total > 0 ? Math.round((qualified / total) * 100) : 0,
      conversionRate: total > 0 ? Math.round((converted / total) * 100) : 0,
    };
  }, [leads]);

  // 80/20 - Top campaigns
  const topCampaigns = useMemo(() => {
    const campaignMap = new Map<string, { count: number; converted: number }>();
    leads.forEach(l => {
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
  }, [leads]);

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

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Total Leads</span>
            </div>
            <p className="text-2xl font-bold">{conversionMetrics.total}</p>
            <p className="text-xs text-muted-foreground">{Math.round(conversionMetrics.total / parseInt(period))} /dia</p>
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

      {/* Charts Row 1 */}
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
                <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} name="Leads" />
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
