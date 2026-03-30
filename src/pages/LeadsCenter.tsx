import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { usePageState } from "@/hooks/usePageState";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  ArrowLeft, 
  HelpCircle, 
  CheckCircle2, 
  XCircle, 
  Upload, 
  Users, 
  Target,
  TrendingUp,
  FileSpreadsheet,
  ExternalLink,
  Info,
  Zap,
  MessageSquare,
  AlertTriangle,
  Instagram,
  LayoutGrid,
  MapPin,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, BarChart, Bar, Legend, PieChart, Pie, Cell } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import LeadManager from "@/components/LeadManager";
// useLeads removed - stats loaded via lightweight query above
import { InstagramAccountsManager } from "@/components/analytics/InstagramAccountsManager";
import { ContactsManager } from "@/components/contacts/ContactsManager";
import { UnifiedKanbanManager } from "@/components/kanban/UnifiedKanbanManager";
import { GeographicDistributionMap } from "@/components/contacts/GeographicDistributionMap";
import { CatLeadsManager } from "@/components/leads/CatLeadsManager";

// Dados simulados de conversão de leads ao longo do tempo
const generateLeadsData = () => {
  const data = [];
  for (let i = 29; i >= 0; i--) {
    const date = subDays(new Date(), i);
    const dayOfWeek = format(date, 'EEE', { locale: ptBR });
    const leads = Math.floor(Math.random() * 30) + 10;
    const converted = Math.floor(leads * (Math.random() * 0.3 + 0.1));
    const notQualified = Math.floor((leads - converted) * (Math.random() * 0.4 + 0.2));
    const inProgress = leads - converted - notQualified;
    
    data.push({
      date: format(date, 'dd/MM'),
      dayOfWeek: `${dayOfWeek} ${format(date, 'dd/MM')}`,
      leads,
      converted,
      notQualified,
      inProgress,
      conversionRate: ((converted / leads) * 100).toFixed(1),
    });
  }
  return data;
};

const leadsData = generateLeadsData();

// Dados para o gráfico de pizza
const statusDistribution = [
  { name: 'Convertidos', value: leadsData.reduce((acc, d) => acc + d.converted, 0), color: 'hsl(var(--chart-2))' },
  { name: 'Em andamento', value: leadsData.reduce((acc, d) => acc + d.inProgress, 0), color: 'hsl(var(--chart-4))' },
  { name: 'Não qualificados', value: leadsData.reduce((acc, d) => acc + d.notQualified, 0), color: 'hsl(var(--chart-5))' },
];

const totalLeads = statusDistribution.reduce((acc, d) => acc + d.value, 0);
const avgConversionRate = (statusDistribution[0].value / totalLeads * 100).toFixed(1);

const chartConfig = {
  leads: { label: "Total Leads", color: "hsl(var(--chart-1))" },
  converted: { label: "Convertidos", color: "hsl(var(--chart-2))" },
  conversionRate: { label: "Taxa de Conversão", color: "hsl(var(--chart-3))" },
  inProgress: { label: "Em andamento", color: "hsl(var(--chart-4))" },
  notQualified: { label: "Não qualificados", color: "hsl(var(--chart-5))" },
};

const LeadsCenter = () => {
  const [searchParams] = useSearchParams();
  const [adAccountId, setAdAccountId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = usePageState<string>('leads_activeTab', 'kanban');

  // Handle tab URL param
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);
  // Get connected ad account from localStorage (saved by useUnifiedMetaConnection hook)
  useEffect(() => {
    // Try to get from unified_meta_credentials first
    const savedCredentials = localStorage.getItem('unified_meta_credentials');
    if (savedCredentials) {
      try {
        const parsed = JSON.parse(savedCredentials);
        if (parsed.accountId) {
          setAdAccountId(parsed.accountId);
          // Also save to selectedAdAccountId for backwards compatibility
          localStorage.setItem('selectedAdAccountId', parsed.accountId);
          return;
        }
      } catch (e) {
        console.error('Error parsing credentials:', e);
      }
    }
    
    // Fallback to selectedAdAccountId
    const savedAccountId = localStorage.getItem('selectedAdAccountId');
    if (savedAccountId) {
      setAdAccountId(savedAccountId);
    }
  }, []);

  // Use lightweight stats query instead of loading all leads
  const [realStats, setRealStats] = useState({ total: 0, converted: 0, inProgress: 0, notQualified: 0, conversionRate: 0 });
  const [realLeadsCount, setRealLeadsCount] = useState(0);

  useEffect(() => {
    const fetchStats = async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('id, status')
        .limit(5000);
      if (error || !data) return;
      const total = data.length;
      const converted = data.filter(l => l.status === 'converted').length;
      const notQualified = data.filter(l => ['not_qualified', 'lost'].includes(l.status || '')).length;
      const inProgress = total - converted - notQualified;
      setRealLeadsCount(total);
      setRealStats({
        total,
        converted,
        inProgress,
        notQualified,
        conversionRate: total > 0 ? (converted / total) * 100 : 0,
      });
    };
    fetchStats();
  }, [adAccountId]);

  const handleOpenFacebookEvents = () => {
    window.open('https://business.facebook.com/events_manager', '_blank');
    toast.info("Abrindo Events Manager do Facebook");
  };

  const handleOpenLeadsCenter = () => {
    window.open('https://business.facebook.com/leads_center', '_blank');
    toast.info("Abrindo Central de Leads do Facebook");
  };

  const handleDownloadTemplate = () => {
    toast.success("Template de CSV para upload de conversões - em breve!");
  };

  // Use real data if available, otherwise show simulated
  const hasRealData = realStats.total > 0;
  const displayStats = hasRealData ? realStats : {
    total: totalLeads,
    converted: statusDistribution[0].value,
    inProgress: statusDistribution[1].value,
    notQualified: statusDistribution[2].value,
    conversionRate: parseFloat(avgConversionRate),
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background p-4 md:p-8">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center gap-4">
            <Link to="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Central de Leads</h1>
              <p className="text-muted-foreground">
                Informe ao Facebook quais leads converteram para receber leads melhores
              </p>
            </div>
          </div>

          {/* Connection Status Warning */}
          {!adAccountId && (
            <Card className="border-yellow-500/30 bg-yellow-500/5">
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">Conta Meta não conectada</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Para importar leads do Facebook automaticamente, conecte sua conta Meta no{' '}
                      <Link to="/" className="text-primary hover:underline">Dashboard</Link>{' '}
                      usando o Modo Pro → Business Manager.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {adAccountId && (
            <Card className="border-green-500/30 bg-green-500/5">
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  <div>
                    <p className="font-medium text-sm">Conta Meta conectada</p>
                    <p className="text-xs text-muted-foreground">
                      ID: {adAccountId} • {realLeads.length} leads no banco de dados
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tabs for Lead Management and Analytics */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="flex flex-wrap w-full gap-1 h-auto p-1 mb-4">
              <TabsTrigger value="kanban" className="text-xs px-2 py-1.5 gap-1">
                <LayoutGrid className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Kanbans</span>
              </TabsTrigger>
              <TabsTrigger value="leads" className="text-xs px-2 py-1.5 gap-1">
                <MessageSquare className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">WhatsApp</span>
              </TabsTrigger>
              <TabsTrigger value="cats" className="text-xs px-2 py-1.5 gap-1">
                <FileSpreadsheet className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">CATs</span>
              </TabsTrigger>
              <TabsTrigger value="contacts" className="text-xs px-2 py-1.5 gap-1">
                <Users className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Contatos</span>
              </TabsTrigger>
              <TabsTrigger value="geographic" className="text-xs px-2 py-1.5 gap-1">
                <MapPin className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Capilaridade</span>
              </TabsTrigger>
              <TabsTrigger value="instagram" className="text-xs px-2 py-1.5 gap-1">
                <Instagram className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Instagram</span>
              </TabsTrigger>
              <TabsTrigger value="analytics" className="text-xs px-2 py-1.5 gap-1">
                <TrendingUp className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Análises</span>
              </TabsTrigger>
              <TabsTrigger value="facebook" className="text-xs px-2 py-1.5 gap-1">
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Facebook</span>
              </TabsTrigger>
            </TabsList>

            {/* Unified Kanban Manager Tab */}
            <TabsContent value="kanban">
              <UnifiedKanbanManager adAccountId={adAccountId || undefined} />
            </TabsContent>

            {/* Lead Manager Tab */}
            <TabsContent value="leads">
              <LeadManager adAccountId={adAccountId || undefined} />
            </TabsContent>

            {/* CAT Leads Tab */}
            <TabsContent value="cats">
              <CatLeadsManager />
            </TabsContent>

            {/* Contacts Tab */}
            <TabsContent value="contacts">
              <ContactsManager />
            </TabsContent>

            {/* Geographic Distribution Tab */}
            <TabsContent value="geographic">
              <GeographicDistributionMap />
            </TabsContent>

            {/* Instagram Accounts Tab */}
            <TabsContent value="instagram">
              <InstagramAccountsManager />
            </TabsContent>

            {/* Analytics Tab */}
            <TabsContent value="analytics" className="space-y-6">
              {/* Real vs Simulated Data Indicator */}
              {hasRealData && (
                <Card className="border-green-500/30 bg-green-500/5">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <span className="text-sm font-medium">Dados reais do banco de dados</span>
                      <Badge variant="secondary">{realLeads.length} leads</Badge>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* KPIs Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-2xl font-bold">{displayStats.total}</div>
                    <p className="text-xs text-muted-foreground">
                      Total de Leads {hasRealData ? '' : '(simulado)'}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-2xl font-bold text-green-500">{displayStats.converted}</div>
                    <p className="text-xs text-muted-foreground">Convertidos</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-2xl font-bold text-primary">{displayStats.conversionRate.toFixed(1)}%</div>
                    <p className="text-xs text-muted-foreground">Taxa de Conversão</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-2xl font-bold text-yellow-500">{displayStats.inProgress}</div>
                    <p className="text-xs text-muted-foreground">Em Andamento</p>
                  </CardContent>
                </Card>
              </div>

              {/* Charts Section */}
              <div className="grid md:grid-cols-2 gap-6">
            {/* Conversion Rate Over Time */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Taxa de Conversão ao Longo do Tempo
                  <Tooltip>
                    <TooltipTrigger>
                      <HelpCircle className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Mostra a porcentagem de leads que converteram em cada dia. 
                      Uma taxa crescente indica que o Facebook está aprendendo.
                    </TooltipContent>
                  </Tooltip>
                </CardTitle>
                <CardDescription>Últimos 30 dias - % de leads convertidos</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[250px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={leadsData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis 
                        dataKey="date" 
                        tick={{ fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis 
                        tick={{ fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                        unit="%"
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Line 
                        type="monotone" 
                        dataKey="conversionRate" 
                        stroke="var(--color-conversionRate)" 
                        strokeWidth={2}
                        dot={false}
                        name="Taxa de Conversão (%)"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Leads Distribution Pie */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Distribuição de Status
                  <Tooltip>
                    <TooltipTrigger>
                      <HelpCircle className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Mostra como seus leads estão distribuídos por status.
                      Idealmente você quer mais convertidos e menos não qualificados.
                    </TooltipContent>
                  </Tooltip>
                </CardTitle>
                <CardDescription>Visão geral do funil de leads</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[250px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                      >
                        {statusDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <ChartTooltip content={<ChartTooltipContent />} />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Daily Leads Bar Chart */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  Leads por Dia e Status
                  <Tooltip>
                    <TooltipTrigger>
                      <HelpCircle className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Mostra quantos leads você recebeu por dia e como estão classificados.
                      Barras verdes crescentes = Facebook aprendendo seu perfil ideal.
                    </TooltipContent>
                  </Tooltip>
                </CardTitle>
                <CardDescription>Volume diário de leads por categoria</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={leadsData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis 
                        dataKey="dayOfWeek" 
                        tick={{ fontSize: 9 }}
                        tickLine={false}
                        axisLine={false}
                        interval={2}
                      />
                      <YAxis 
                        tick={{ fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Legend />
                      <Bar dataKey="converted" stackId="a" fill="var(--color-converted)" name="Convertidos" />
                      <Bar dataKey="inProgress" stackId="a" fill="var(--color-inProgress)" name="Em andamento" />
                      <Bar dataKey="notQualified" stackId="a" fill="var(--color-notQualified)" name="Não qualificados" />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>

          {/* Why This Matters */}
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                Por que isso é importante?
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">
                Quando você informa ao Facebook quais leads realmente compraram ou converteram, 
                o algoritmo aprende o perfil do seu cliente ideal e passa a entregar leads 
                mais qualificados, reduzindo seu custo por aquisição.
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">↓ Custo por Lead</Badge>
                <Badge variant="secondary">↑ Taxa de Conversão</Badge>
                <Badge variant="secondary">↑ Qualidade dos Leads</Badge>
              </div>
            </CardContent>
          </Card>

          {/* Methods Grid */}
          <div className="grid md:grid-cols-2 gap-6">
            
            {/* Method 1: Events Manager */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  Método 1: Events Manager
                  <Tooltip>
                    <TooltipTrigger>
                      <HelpCircle className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      O Events Manager é onde você configura e monitora todos os eventos 
                      de conversão do seu site/app
                    </TooltipContent>
                  </Tooltip>
                </CardTitle>
                <CardDescription>
                  Configure eventos de conversão automáticos via Pixel ou CAPI
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-medium">1</span>
                    <div>
                      <p className="font-medium text-sm">Instale o Pixel do Facebook</p>
                      <p className="text-xs text-muted-foreground">
                        Código que rastreia ações no seu site (visitas, compras, cadastros)
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-medium">2</span>
                    <div>
                      <p className="font-medium text-sm">Configure eventos de conversão</p>
                      <p className="text-xs text-muted-foreground">
                        Purchase, Lead, CompleteRegistration, etc.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-medium">3</span>
                    <div className="flex items-center gap-2">
                      <div>
                        <p className="font-medium text-sm">Ative a CAPI</p>
                        <p className="text-xs text-muted-foreground">
                          Conversions API - envia dados direto do servidor, mais preciso
                        </p>
                      </div>
                      <Tooltip>
                        <TooltipTrigger>
                          <Info className="h-4 w-4 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          A CAPI não depende do navegador do usuário, então funciona mesmo 
                          quando cookies são bloqueados. Recomendado usar junto com o Pixel.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </div>

                <Button onClick={handleOpenFacebookEvents} className="w-full">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Abrir Events Manager
                </Button>
              </CardContent>
            </Card>

            {/* Method 2: Leads Center */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Método 2: Central de Leads
                  <Tooltip>
                    <TooltipTrigger>
                      <HelpCircle className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      A Central de Leads é onde você vê e gerencia todos os leads 
                      captados pelos formulários do Facebook/Instagram
                    </TooltipContent>
                  </Tooltip>
                </CardTitle>
                <CardDescription>
                  Marque manualmente quais leads converteram
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-medium">1</span>
                    <div>
                      <p className="font-medium text-sm">Acesse a Central de Leads</p>
                      <p className="text-xs text-muted-foreground">
                        Veja todos os leads dos formulários do Facebook
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-medium">2</span>
                    <div>
                      <p className="font-medium text-sm">Atualize o status de cada lead</p>
                      <p className="text-xs text-muted-foreground">
                        Marque como "Convertido" ou "Não qualificado"
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-medium">3</span>
                    <div>
                      <p className="font-medium text-sm">Faça isso regularmente</p>
                      <p className="text-xs text-muted-foreground">
                        Quanto mais dados, melhor o algoritmo aprende
                      </p>
                    </div>
                  </div>
                </div>

                <Button onClick={handleOpenLeadsCenter} className="w-full">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Abrir Central de Leads
                </Button>
              </CardContent>
            </Card>

            {/* Method 3: Offline Conversions */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5" />
                  Método 3: Offline Conversions
                  <Tooltip>
                    <TooltipTrigger>
                      <HelpCircle className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Permite enviar dados de vendas que aconteceram fora do site 
                      (loja física, WhatsApp, telefone)
                    </TooltipContent>
                  </Tooltip>
                </CardTitle>
                <CardDescription>
                  Envie dados de conversões offline via arquivo CSV
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-medium">1</span>
                    <div>
                      <p className="font-medium text-sm">Exporte seus dados de vendas</p>
                      <p className="text-xs text-muted-foreground">
                        Do seu CRM, planilha ou sistema de vendas
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-medium">2</span>
                    <div>
                      <p className="font-medium text-sm">Formate no padrão do Facebook</p>
                      <p className="text-xs text-muted-foreground">
                        Email, telefone, nome, valor, data da conversão
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-medium">3</span>
                    <div>
                      <p className="font-medium text-sm">Faça upload no Events Manager</p>
                      <p className="text-xs text-muted-foreground">
                        O Facebook cruza os dados com quem viu seus anúncios
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button onClick={handleDownloadTemplate} variant="outline" className="flex-1">
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    Template CSV
                  </Button>
                  <Button onClick={handleOpenFacebookEvents} className="flex-1">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Events Manager
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Status Guide */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Status dos Leads
                </CardTitle>
                <CardDescription>
                  Como classificar seus leads na Central
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 border border-green-500/30 bg-green-500/10 rounded-lg">
                    <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">Convertido</p>
                      <p className="text-xs text-muted-foreground">
                        Lead que comprou, fechou contrato ou virou cliente. 
                        Isso ensina o Facebook a encontrar mais pessoas parecidas.
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3 p-3 border border-yellow-500/30 bg-yellow-500/10 rounded-lg">
                    <Info className="h-5 w-5 text-yellow-500 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">Em andamento</p>
                      <p className="text-xs text-muted-foreground">
                        Lead em negociação, aguardando proposta ou em follow-up.
                        Ainda pode converter.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 border border-red-500/30 bg-red-500/10 rounded-lg">
                    <XCircle className="h-5 w-5 text-red-500 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">Não qualificado</p>
                      <p className="text-xs text-muted-foreground">
                        Lead que não tem perfil (sem dinheiro, errou dados, spam).
                        Isso ensina o Facebook a evitar pessoas assim.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-xs text-muted-foreground">
                    <strong>Dica:</strong> Atualize os status pelo menos 1x por semana. 
                    Quanto mais feedback você der, mais rápido o algoritmo aprende.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Best Practices */}
          <Card>
            <CardHeader>
              <CardTitle>Boas Práticas para Otimização de Leads</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-4">
                <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                  <h4 className="font-medium">Frequência</h4>
                  <p className="text-sm text-muted-foreground">
                    Atualize os status dos leads pelo menos 1x por semana. 
                    Ideal: diariamente ou após cada venda.
                  </p>
                </div>
                <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                  <h4 className="font-medium">Volume mínimo</h4>
                  <p className="text-sm text-muted-foreground">
                    O Facebook precisa de pelo menos 50 conversões por semana 
                    para otimizar bem. Se tiver menos, use otimização para leads.
                  </p>
                </div>
                <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                  <h4 className="font-medium">Janela de conversão</h4>
                  <p className="text-sm text-muted-foreground">
                    Configure a janela de acordo com seu ciclo de vendas. 
                    Vendas rápidas: 7 dias. Vendas longas: 28+ dias.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
            </TabsContent>

            {/* Facebook Integration Tab */}
            <TabsContent value="facebook" className="space-y-6">
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">
                    Esta aba contém instruções para integrar com o Facebook Events Manager e Central de Leads.
                    Volte para a aba "Leads WhatsApp" para gerenciar seus leads reais.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default LeadsCenter;
