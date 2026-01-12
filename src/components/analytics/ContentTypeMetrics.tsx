import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Play, 
  Image, 
  Video, 
  Film, 
  Clock, 
  Eye, 
  Heart, 
  MessageCircle, 
  Share2, 
  Bookmark,
  TrendingUp,
  TrendingDown,
  Minus,
  Instagram,
  Youtube
} from "lucide-react";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Bar, BarChart, XAxis, YAxis, CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell, Legend, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from "recharts";

// Tipos de conteúdo por plataforma
export type ContentFormat = 'stories' | 'feed' | 'reels' | 'shorts' | 'posts' | 'carrossel' | 'video';
export type Platform = 'instagram' | 'facebook' | 'youtube' | 'tiktok' | 'kwai';

interface ContentMetric {
  format: ContentFormat;
  platform: Platform;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  reach: number;
  impressions: number;
  engagementRate: number;
  avgWatchTime?: number;
  completionRate?: number;
  count: number;
}

interface ContentTypeMetricsProps {
  period: string;
  onPeriodChange: (period: string) => void;
}

// Mock data - em produção viria da API
const generateMockData = (period: string): ContentMetric[] => {
  const multiplier = period === '7' ? 1 : period === '14' ? 1.8 : period === '30' ? 3.5 : 8;
  
  return [
    // Instagram
    { format: 'stories', platform: 'instagram', views: Math.floor(4500 * multiplier), likes: 0, comments: 0, shares: Math.floor(120 * multiplier), saves: 0, reach: Math.floor(3200 * multiplier), impressions: Math.floor(5800 * multiplier), engagementRate: 4.2, avgWatchTime: 3.5, completionRate: 68, count: Math.floor(21 * multiplier / 7) },
    { format: 'feed', platform: 'instagram', views: Math.floor(2800 * multiplier), likes: Math.floor(450 * multiplier), comments: Math.floor(32 * multiplier), shares: Math.floor(28 * multiplier), saves: Math.floor(85 * multiplier), reach: Math.floor(2100 * multiplier), impressions: Math.floor(3500 * multiplier), engagementRate: 5.8, count: Math.floor(4 * multiplier / 7) },
    { format: 'reels', platform: 'instagram', views: Math.floor(12500 * multiplier), likes: Math.floor(890 * multiplier), comments: Math.floor(78 * multiplier), shares: Math.floor(245 * multiplier), saves: Math.floor(320 * multiplier), reach: Math.floor(9800 * multiplier), impressions: Math.floor(15200 * multiplier), engagementRate: 8.2, avgWatchTime: 12.8, completionRate: 45, count: Math.floor(3 * multiplier / 7) },
    { format: 'carrossel', platform: 'instagram', views: Math.floor(3200 * multiplier), likes: Math.floor(520 * multiplier), comments: Math.floor(45 * multiplier), shares: Math.floor(38 * multiplier), saves: Math.floor(180 * multiplier), reach: Math.floor(2800 * multiplier), impressions: Math.floor(4200 * multiplier), engagementRate: 7.1, count: Math.floor(2 * multiplier / 7) },
    
    // Facebook
    { format: 'posts', platform: 'facebook', views: Math.floor(1800 * multiplier), likes: Math.floor(180 * multiplier), comments: Math.floor(25 * multiplier), shares: Math.floor(42 * multiplier), saves: Math.floor(15 * multiplier), reach: Math.floor(1500 * multiplier), impressions: Math.floor(2200 * multiplier), engagementRate: 3.8, count: Math.floor(5 * multiplier / 7) },
    { format: 'stories', platform: 'facebook', views: Math.floor(950 * multiplier), likes: 0, comments: 0, shares: Math.floor(18 * multiplier), saves: 0, reach: Math.floor(720 * multiplier), impressions: Math.floor(1100 * multiplier), engagementRate: 2.1, avgWatchTime: 2.8, completionRate: 55, count: Math.floor(7 * multiplier / 7) },
    { format: 'reels', platform: 'facebook', views: Math.floor(3500 * multiplier), likes: Math.floor(210 * multiplier), comments: Math.floor(18 * multiplier), shares: Math.floor(65 * multiplier), saves: Math.floor(28 * multiplier), reach: Math.floor(2800 * multiplier), impressions: Math.floor(4500 * multiplier), engagementRate: 4.5, avgWatchTime: 8.5, completionRate: 38, count: Math.floor(2 * multiplier / 7) },
    { format: 'video', platform: 'facebook', views: Math.floor(2200 * multiplier), likes: Math.floor(145 * multiplier), comments: Math.floor(22 * multiplier), shares: Math.floor(55 * multiplier), saves: Math.floor(12 * multiplier), reach: Math.floor(1900 * multiplier), impressions: Math.floor(2800 * multiplier), engagementRate: 3.2, avgWatchTime: 45, completionRate: 28, count: Math.floor(1 * multiplier / 7) },
    
    // YouTube
    { format: 'shorts', platform: 'youtube', views: Math.floor(8500 * multiplier), likes: Math.floor(620 * multiplier), comments: Math.floor(45 * multiplier), shares: Math.floor(180 * multiplier), saves: Math.floor(95 * multiplier), reach: Math.floor(7200 * multiplier), impressions: Math.floor(10500 * multiplier), engagementRate: 6.8, avgWatchTime: 18, completionRate: 52, count: Math.floor(4 * multiplier / 7) },
    { format: 'video', platform: 'youtube', views: Math.floor(4200 * multiplier), likes: Math.floor(380 * multiplier), comments: Math.floor(65 * multiplier), shares: Math.floor(120 * multiplier), saves: Math.floor(210 * multiplier), reach: Math.floor(3800 * multiplier), impressions: Math.floor(5200 * multiplier), engagementRate: 5.2, avgWatchTime: 180, completionRate: 35, count: Math.floor(2 * multiplier / 7) },
    
    // TikTok
    { format: 'video', platform: 'tiktok', views: Math.floor(18500 * multiplier), likes: Math.floor(2100 * multiplier), comments: Math.floor(185 * multiplier), shares: Math.floor(520 * multiplier), saves: Math.floor(680 * multiplier), reach: Math.floor(15200 * multiplier), impressions: Math.floor(22000 * multiplier), engagementRate: 12.5, avgWatchTime: 22, completionRate: 62, count: Math.floor(5 * multiplier / 7) },
    
    // Kwai
    { format: 'video', platform: 'kwai', views: Math.floor(9200 * multiplier), likes: Math.floor(1150 * multiplier), comments: Math.floor(98 * multiplier), shares: Math.floor(285 * multiplier), saves: Math.floor(340 * multiplier), reach: Math.floor(7800 * multiplier), impressions: Math.floor(11500 * multiplier), engagementRate: 9.8, avgWatchTime: 19, completionRate: 58, count: Math.floor(4 * multiplier / 7) },
  ];
};

const formatConfig: Record<ContentFormat, { label: string; icon: React.ReactNode; color: string }> = {
  stories: { label: 'Stories', icon: <Clock className="h-4 w-4" />, color: '#E1306C' },
  feed: { label: 'Feed', icon: <Image className="h-4 w-4" />, color: '#405DE6' },
  reels: { label: 'Reels', icon: <Film className="h-4 w-4" />, color: '#833AB4' },
  shorts: { label: 'Shorts', icon: <Play className="h-4 w-4" />, color: '#FF0000' },
  posts: { label: 'Posts', icon: <Image className="h-4 w-4" />, color: '#1877F2' },
  carrossel: { label: 'Carrossel', icon: <Image className="h-4 w-4" />, color: '#C13584' },
  video: { label: 'Vídeo', icon: <Video className="h-4 w-4" />, color: '#FD1D1D' },
};

const platformConfig: Record<Platform, { label: string; icon: React.ReactNode; color: string; gradient: string }> = {
  instagram: { 
    label: 'Instagram', 
    icon: <Instagram className="h-5 w-5" />, 
    color: '#E1306C',
    gradient: 'from-purple-500 via-pink-500 to-orange-500'
  },
  facebook: { 
    label: 'Facebook', 
    icon: <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>, 
    color: '#1877F2',
    gradient: 'from-blue-600 to-blue-400'
  },
  youtube: { 
    label: 'YouTube', 
    icon: <Youtube className="h-5 w-5" />, 
    color: '#FF0000',
    gradient: 'from-red-600 to-red-400'
  },
  tiktok: { 
    label: 'TikTok', 
    icon: <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/></svg>, 
    color: '#000000',
    gradient: 'from-gray-900 via-pink-500 to-cyan-400'
  },
  kwai: { 
    label: 'Kwai', 
    icon: <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>, 
    color: '#FF6B00',
    gradient: 'from-orange-500 to-yellow-500'
  },
};

const COLORS = ['#E1306C', '#405DE6', '#833AB4', '#FF0000', '#1877F2', '#C13584', '#FD1D1D', '#FF6B00'];

export const ContentTypeMetrics = ({ period, onPeriodChange }: ContentTypeMetricsProps) => {
  const [activePlatform, setActivePlatform] = useState<Platform | 'all'>('all');
  const metrics = generateMockData(period);

  // Filtrar por plataforma
  const filteredMetrics = activePlatform === 'all' 
    ? metrics 
    : metrics.filter(m => m.platform === activePlatform);

  // Agregar métricas por formato
  const aggregatedByFormat = filteredMetrics.reduce((acc, m) => {
    const existing = acc.find(a => a.format === m.format);
    if (existing) {
      existing.views += m.views;
      existing.likes += m.likes;
      existing.comments += m.comments;
      existing.shares += m.shares;
      existing.saves += m.saves;
      existing.reach += m.reach;
      existing.count += m.count;
      existing.engagementRate = (existing.engagementRate + m.engagementRate) / 2;
    } else {
      acc.push({ ...m });
    }
    return acc;
  }, [] as ContentMetric[]);

  // Agregar métricas por plataforma
  const aggregatedByPlatform = metrics.reduce((acc, m) => {
    const existing = acc.find(a => a.platform === m.platform);
    if (existing) {
      existing.views += m.views;
      existing.likes += m.likes;
      existing.comments += m.comments;
      existing.shares += m.shares;
      existing.saves += m.saves;
      existing.reach += m.reach;
      existing.count += m.count;
    } else {
      acc.push({ 
        platform: m.platform, 
        views: m.views, 
        likes: m.likes, 
        comments: m.comments, 
        shares: m.shares, 
        saves: m.saves, 
        reach: m.reach,
        count: m.count 
      });
    }
    return acc;
  }, [] as { platform: Platform; views: number; likes: number; comments: number; shares: number; saves: number; reach: number; count: number }[]);

  // Dados para gráfico de pizza
  const pieData = aggregatedByPlatform.map(p => ({
    name: platformConfig[p.platform].label,
    value: p.views,
    color: platformConfig[p.platform].color,
  }));

  // Dados para gráfico de barras por formato
  const barData = aggregatedByFormat.map(m => ({
    format: formatConfig[m.format].label,
    views: m.views,
    likes: m.likes,
    comments: m.comments,
    shares: m.shares,
    saves: m.saves,
    color: formatConfig[m.format].color,
  }));

  // Dados para radar de engajamento
  const radarData = [
    { metric: 'Curtidas', instagram: 0, facebook: 0, youtube: 0, tiktok: 0, kwai: 0 },
    { metric: 'Comentários', instagram: 0, facebook: 0, youtube: 0, tiktok: 0, kwai: 0 },
    { metric: 'Compartilhamentos', instagram: 0, facebook: 0, youtube: 0, tiktok: 0, kwai: 0 },
    { metric: 'Salvos', instagram: 0, facebook: 0, youtube: 0, tiktok: 0, kwai: 0 },
    { metric: 'Alcance', instagram: 0, facebook: 0, youtube: 0, tiktok: 0, kwai: 0 },
  ];

  aggregatedByPlatform.forEach(p => {
    const maxLikes = Math.max(...aggregatedByPlatform.map(x => x.likes));
    const maxComments = Math.max(...aggregatedByPlatform.map(x => x.comments));
    const maxShares = Math.max(...aggregatedByPlatform.map(x => x.shares));
    const maxSaves = Math.max(...aggregatedByPlatform.map(x => x.saves));
    const maxReach = Math.max(...aggregatedByPlatform.map(x => x.reach));
    
    radarData[0][p.platform] = Math.round((p.likes / maxLikes) * 100);
    radarData[1][p.platform] = Math.round((p.comments / maxComments) * 100);
    radarData[2][p.platform] = Math.round((p.shares / maxShares) * 100);
    radarData[3][p.platform] = Math.round((p.saves / maxSaves) * 100);
    radarData[4][p.platform] = Math.round((p.reach / maxReach) * 100);
  });

  const chartConfig: ChartConfig = {
    views: { label: "Visualizações", color: "hsl(var(--chart-1))" },
    likes: { label: "Curtidas", color: "hsl(var(--chart-2))" },
    comments: { label: "Comentários", color: "hsl(var(--chart-3))" },
    shares: { label: "Compartilhamentos", color: "hsl(var(--chart-4))" },
    saves: { label: "Salvos", color: "hsl(var(--chart-5))" },
  };

  // Calcular totais
  const totals = filteredMetrics.reduce((acc, m) => ({
    views: acc.views + m.views,
    likes: acc.likes + m.likes,
    comments: acc.comments + m.comments,
    shares: acc.shares + m.shares,
    saves: acc.saves + m.saves,
    reach: acc.reach + m.reach,
    count: acc.count + m.count,
  }), { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, reach: 0, count: 0 });

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge 
            variant={activePlatform === 'all' ? 'default' : 'outline'} 
            className="cursor-pointer"
            onClick={() => setActivePlatform('all')}
          >
            Todas
          </Badge>
          {(Object.keys(platformConfig) as Platform[]).map(platform => (
            <Badge 
              key={platform}
              variant={activePlatform === platform ? 'default' : 'outline'} 
              className="cursor-pointer gap-1"
              style={{ 
                backgroundColor: activePlatform === platform ? platformConfig[platform].color : undefined,
                borderColor: platformConfig[platform].color,
                color: activePlatform === platform ? 'white' : platformConfig[platform].color
              }}
              onClick={() => setActivePlatform(platform)}
            >
              {platformConfig[platform].icon}
              {platformConfig[platform].label}
            </Badge>
          ))}
        </div>
        <Select value={period} onValueChange={onPeriodChange}>
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">7 dias</SelectItem>
            <SelectItem value="14">14 dias</SelectItem>
            <SelectItem value="30">30 dias</SelectItem>
            <SelectItem value="90">90 dias</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Cards de Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Eye className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Visualizações</span>
            </div>
            <p className="text-2xl font-bold">{totals.views.toLocaleString('pt-BR')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Heart className="h-4 w-4 text-red-500" />
              <span className="text-xs text-muted-foreground">Curtidas</span>
            </div>
            <p className="text-2xl font-bold">{totals.likes.toLocaleString('pt-BR')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <MessageCircle className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">Comentários</span>
            </div>
            <p className="text-2xl font-bold">{totals.comments.toLocaleString('pt-BR')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Share2 className="h-4 w-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Compartilhamentos</span>
            </div>
            <p className="text-2xl font-bold">{totals.shares.toLocaleString('pt-BR')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Bookmark className="h-4 w-4 text-purple-500" />
              <span className="text-xs text-muted-foreground">Salvos</span>
            </div>
            <p className="text-2xl font-bold">{totals.saves.toLocaleString('pt-BR')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Image className="h-4 w-4 text-orange-500" />
              <span className="text-xs text-muted-foreground">Publicações</span>
            </div>
            <p className="text-2xl font-bold">{totals.count}</p>
          </CardContent>
        </Card>
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Desempenho por Formato */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Desempenho por Formato</CardTitle>
            <CardDescription>Visualizações e engajamento por tipo de conteúdo</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px]">
              <BarChart data={barData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis type="number" tickLine={false} axisLine={false} className="text-xs" tickFormatter={(v) => v.toLocaleString('pt-BR')} />
                <YAxis type="category" dataKey="format" tickLine={false} axisLine={false} className="text-xs" width={80} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="views" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} name="Visualizações" />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Distribuição por Plataforma */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Distribuição por Plataforma</CardTitle>
            <CardDescription>Proporção de visualizações entre redes</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <ChartTooltip formatter={(value: number) => value.toLocaleString('pt-BR')} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detalhes por Formato */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Detalhes por Formato de Conteúdo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {aggregatedByFormat.map(metric => (
              <Card key={metric.format} className="bg-muted/30">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div 
                      className="p-2 rounded-lg" 
                      style={{ backgroundColor: `${formatConfig[metric.format].color}20` }}
                    >
                      {formatConfig[metric.format].icon}
                    </div>
                    <div>
                      <p className="font-medium">{formatConfig[metric.format].label}</p>
                      <p className="text-xs text-muted-foreground">{metric.count} publicações</p>
                    </div>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Visualizações</span>
                      <span className="font-medium">{metric.views.toLocaleString('pt-BR')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Alcance</span>
                      <span className="font-medium">{metric.reach.toLocaleString('pt-BR')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Engajamento</span>
                      <span className="font-medium text-green-600">{metric.engagementRate.toFixed(1)}%</span>
                    </div>
                    {metric.completionRate !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Taxa Conclusão</span>
                        <span className="font-medium">{metric.completionRate}%</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Comparativo por Plataforma */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Comparativo de Engajamento por Plataforma</CardTitle>
          <CardDescription>Análise normalizada do desempenho em cada rede social</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="metric" className="text-xs" />
                <PolarRadiusAxis angle={30} domain={[0, 100]} />
                <Radar name="Instagram" dataKey="instagram" stroke="#E1306C" fill="#E1306C" fillOpacity={0.3} />
                <Radar name="Facebook" dataKey="facebook" stroke="#1877F2" fill="#1877F2" fillOpacity={0.3} />
                <Radar name="YouTube" dataKey="youtube" stroke="#FF0000" fill="#FF0000" fillOpacity={0.3} />
                <Radar name="TikTok" dataKey="tiktok" stroke="#000000" fill="#000000" fillOpacity={0.3} />
                <Radar name="Kwai" dataKey="kwai" stroke="#FF6B00" fill="#FF6B00" fillOpacity={0.3} />
                <Legend />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
