import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { 
  Eye, 
  Heart, 
  MessageCircle, 
  Share2, 
  Bookmark,
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
  Film,
  Image,
  Play,
  Video,
  Instagram,
  Youtube,
  Users,
  Activity
} from "lucide-react";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { 
  Bar, 
  BarChart, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  ResponsiveContainer, 
  LineChart,
  Line,
  ComposedChart,
  Area
} from "recharts";

type Platform = 'instagram' | 'facebook' | 'youtube' | 'tiktok' | 'kwai';
type ContentType = 'stories' | 'feed' | 'reels' | 'shorts' | 'posts' | 'video';

interface PlatformData {
  platform: Platform;
  contentTypes: {
    type: ContentType;
    metrics: {
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
      exits?: number;
      replies?: number;
    };
    count: number;
    trend: number; // percentage change from previous period
  }[];
  totalFollowers: number;
  followerGrowth: number;
  dailyData: { date: string; views: number; engagement: number; followers: number }[];
}

interface PlatformEngagementProps {
  period: string;
  onPeriodChange: (period: string) => void;
}

// Generate mock data based on period
const generatePlatformData = (period: string): PlatformData[] => {
  const multiplier = period === '7' ? 1 : period === '14' ? 1.8 : period === '30' ? 3.5 : 8;
  const days = parseInt(period);
  
  const generateDailyData = (baseViews: number, baseEngagement: number, baseFollowers: number) => {
    return Array.from({ length: days }, (_, i) => ({
      date: new Date(Date.now() - (days - i - 1) * 24 * 60 * 60 * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      views: Math.floor(baseViews * (0.8 + Math.random() * 0.4)),
      engagement: Math.floor(baseEngagement * (0.7 + Math.random() * 0.6)),
      followers: Math.floor(baseFollowers * (0.9 + Math.random() * 0.2)),
    }));
  };

  return [
    {
      platform: 'instagram',
      totalFollowers: 15420,
      followerGrowth: 3.2,
      contentTypes: [
        {
          type: 'stories',
          metrics: {
            views: Math.floor(4500 * multiplier),
            likes: 0,
            comments: 0,
            shares: Math.floor(120 * multiplier),
            saves: 0,
            reach: Math.floor(3200 * multiplier),
            impressions: Math.floor(5800 * multiplier),
            engagementRate: 4.2,
            avgWatchTime: 3.5,
            completionRate: 68,
            exits: Math.floor(450 * multiplier),
            replies: Math.floor(85 * multiplier),
          },
          count: Math.floor(21 * multiplier / 7),
          trend: 12.5,
        },
        {
          type: 'feed',
          metrics: {
            views: Math.floor(2800 * multiplier),
            likes: Math.floor(450 * multiplier),
            comments: Math.floor(32 * multiplier),
            shares: Math.floor(28 * multiplier),
            saves: Math.floor(85 * multiplier),
            reach: Math.floor(2100 * multiplier),
            impressions: Math.floor(3500 * multiplier),
            engagementRate: 5.8,
          },
          count: Math.floor(4 * multiplier / 7),
          trend: -2.3,
        },
        {
          type: 'reels',
          metrics: {
            views: Math.floor(12500 * multiplier),
            likes: Math.floor(890 * multiplier),
            comments: Math.floor(78 * multiplier),
            shares: Math.floor(245 * multiplier),
            saves: Math.floor(320 * multiplier),
            reach: Math.floor(9800 * multiplier),
            impressions: Math.floor(15200 * multiplier),
            engagementRate: 8.2,
            avgWatchTime: 12.8,
            completionRate: 45,
          },
          count: Math.floor(3 * multiplier / 7),
          trend: 28.4,
        },
      ],
      dailyData: generateDailyData(2800, 450, 45),
    },
    {
      platform: 'facebook',
      totalFollowers: 8920,
      followerGrowth: 1.8,
      contentTypes: [
        {
          type: 'posts',
          metrics: {
            views: Math.floor(1800 * multiplier),
            likes: Math.floor(180 * multiplier),
            comments: Math.floor(25 * multiplier),
            shares: Math.floor(42 * multiplier),
            saves: Math.floor(15 * multiplier),
            reach: Math.floor(1500 * multiplier),
            impressions: Math.floor(2200 * multiplier),
            engagementRate: 3.8,
          },
          count: Math.floor(5 * multiplier / 7),
          trend: -5.2,
        },
        {
          type: 'stories',
          metrics: {
            views: Math.floor(950 * multiplier),
            likes: 0,
            comments: 0,
            shares: Math.floor(18 * multiplier),
            saves: 0,
            reach: Math.floor(720 * multiplier),
            impressions: Math.floor(1100 * multiplier),
            engagementRate: 2.1,
            avgWatchTime: 2.8,
            completionRate: 55,
            exits: Math.floor(180 * multiplier),
          },
          count: Math.floor(7 * multiplier / 7),
          trend: 8.1,
        },
        {
          type: 'reels',
          metrics: {
            views: Math.floor(3500 * multiplier),
            likes: Math.floor(210 * multiplier),
            comments: Math.floor(18 * multiplier),
            shares: Math.floor(65 * multiplier),
            saves: Math.floor(28 * multiplier),
            reach: Math.floor(2800 * multiplier),
            impressions: Math.floor(4500 * multiplier),
            engagementRate: 4.5,
            avgWatchTime: 8.5,
            completionRate: 38,
          },
          count: Math.floor(2 * multiplier / 7),
          trend: 15.3,
        },
        {
          type: 'video',
          metrics: {
            views: Math.floor(2200 * multiplier),
            likes: Math.floor(145 * multiplier),
            comments: Math.floor(22 * multiplier),
            shares: Math.floor(55 * multiplier),
            saves: Math.floor(12 * multiplier),
            reach: Math.floor(1900 * multiplier),
            impressions: Math.floor(2800 * multiplier),
            engagementRate: 3.2,
            avgWatchTime: 45,
            completionRate: 28,
          },
          count: Math.floor(1 * multiplier / 7),
          trend: 2.8,
        },
      ],
      dailyData: generateDailyData(1200, 180, 25),
    },
    {
      platform: 'youtube',
      totalFollowers: 5840,
      followerGrowth: 4.5,
      contentTypes: [
        {
          type: 'shorts',
          metrics: {
            views: Math.floor(8500 * multiplier),
            likes: Math.floor(620 * multiplier),
            comments: Math.floor(45 * multiplier),
            shares: Math.floor(180 * multiplier),
            saves: Math.floor(95 * multiplier),
            reach: Math.floor(7200 * multiplier),
            impressions: Math.floor(10500 * multiplier),
            engagementRate: 6.8,
            avgWatchTime: 18,
            completionRate: 52,
          },
          count: Math.floor(4 * multiplier / 7),
          trend: 35.2,
        },
        {
          type: 'video',
          metrics: {
            views: Math.floor(4200 * multiplier),
            likes: Math.floor(380 * multiplier),
            comments: Math.floor(65 * multiplier),
            shares: Math.floor(120 * multiplier),
            saves: Math.floor(210 * multiplier),
            reach: Math.floor(3800 * multiplier),
            impressions: Math.floor(5200 * multiplier),
            engagementRate: 5.2,
            avgWatchTime: 180,
            completionRate: 35,
          },
          count: Math.floor(2 * multiplier / 7),
          trend: 8.7,
        },
      ],
      dailyData: generateDailyData(1800, 280, 35),
    },
    {
      platform: 'tiktok',
      totalFollowers: 22350,
      followerGrowth: 8.2,
      contentTypes: [
        {
          type: 'video',
          metrics: {
            views: Math.floor(18500 * multiplier),
            likes: Math.floor(2100 * multiplier),
            comments: Math.floor(185 * multiplier),
            shares: Math.floor(520 * multiplier),
            saves: Math.floor(680 * multiplier),
            reach: Math.floor(15200 * multiplier),
            impressions: Math.floor(22000 * multiplier),
            engagementRate: 12.5,
            avgWatchTime: 22,
            completionRate: 62,
          },
          count: Math.floor(5 * multiplier / 7),
          trend: 42.1,
        },
      ],
      dailyData: generateDailyData(3500, 580, 85),
    },
    {
      platform: 'kwai',
      totalFollowers: 12680,
      followerGrowth: 5.8,
      contentTypes: [
        {
          type: 'video',
          metrics: {
            views: Math.floor(9200 * multiplier),
            likes: Math.floor(1150 * multiplier),
            comments: Math.floor(98 * multiplier),
            shares: Math.floor(285 * multiplier),
            saves: Math.floor(340 * multiplier),
            reach: Math.floor(7800 * multiplier),
            impressions: Math.floor(11500 * multiplier),
            engagementRate: 9.8,
            avgWatchTime: 19,
            completionRate: 58,
          },
          count: Math.floor(4 * multiplier / 7),
          trend: 25.6,
        },
      ],
      dailyData: generateDailyData(2200, 380, 55),
    },
  ];
};

const platformConfig: Record<Platform, { 
  label: string; 
  icon: React.ReactNode; 
  color: string; 
  gradient: string;
  contentTypes: ContentType[];
}> = {
  instagram: { 
    label: 'Instagram', 
    icon: <Instagram className="h-5 w-5" />, 
    color: '#E1306C',
    gradient: 'from-purple-500 via-pink-500 to-orange-500',
    contentTypes: ['stories', 'feed', 'reels'],
  },
  facebook: { 
    label: 'Facebook', 
    icon: <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>, 
    color: '#1877F2',
    gradient: 'from-blue-600 to-blue-400',
    contentTypes: ['posts', 'stories', 'reels', 'video'],
  },
  youtube: { 
    label: 'YouTube', 
    icon: <Youtube className="h-5 w-5" />, 
    color: '#FF0000',
    gradient: 'from-red-600 to-red-400',
    contentTypes: ['shorts', 'video'],
  },
  tiktok: { 
    label: 'TikTok', 
    icon: <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/></svg>, 
    color: '#000000',
    gradient: 'from-gray-900 via-pink-500 to-cyan-400',
    contentTypes: ['video'],
  },
  kwai: { 
    label: 'Kwai', 
    icon: <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>, 
    color: '#FF6B00',
    gradient: 'from-orange-500 to-yellow-500',
    contentTypes: ['video'],
  },
};

const contentTypeConfig: Record<ContentType, { label: string; icon: React.ReactNode; color: string }> = {
  stories: { label: 'Stories', icon: <Clock className="h-4 w-4" />, color: '#E1306C' },
  feed: { label: 'Feed', icon: <Image className="h-4 w-4" />, color: '#405DE6' },
  reels: { label: 'Reels', icon: <Film className="h-4 w-4" />, color: '#833AB4' },
  shorts: { label: 'Shorts', icon: <Play className="h-4 w-4" />, color: '#FF0000' },
  posts: { label: 'Posts', icon: <Image className="h-4 w-4" />, color: '#1877F2' },
  video: { label: 'Vídeo', icon: <Video className="h-4 w-4" />, color: '#FD1D1D' },
};

export const PlatformEngagement = ({ period, onPeriodChange }: PlatformEngagementProps) => {
  const [activePlatform, setActivePlatform] = useState<Platform>('instagram');
  const platformData = generatePlatformData(period);
  
  const currentPlatform = platformData.find(p => p.platform === activePlatform)!;
  const config = platformConfig[activePlatform];

  const chartConfig: ChartConfig = {
    views: { label: "Visualizações", color: "hsl(var(--chart-1))" },
    engagement: { label: "Engajamento", color: "hsl(var(--chart-2))" },
    followers: { label: "Seguidores", color: "hsl(var(--chart-3))" },
  };

  const TrendIcon = ({ trend }: { trend: number }) => {
    if (trend > 0) return <TrendingUp className="h-3 w-3 text-green-500" />;
    if (trend < 0) return <TrendingDown className="h-3 w-3 text-red-500" />;
    return <Minus className="h-3 w-3 text-muted-foreground" />;
  };

  return (
    <div className="space-y-6">
      {/* Platform Selector & Period */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          {(Object.keys(platformConfig) as Platform[]).map(platform => (
            <Badge 
              key={platform}
              variant={activePlatform === platform ? 'default' : 'outline'} 
              className="cursor-pointer gap-1 py-1.5 px-3"
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

      {/* Platform Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className={`bg-gradient-to-br ${config.gradient} text-white`}>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 mb-4">
              {config.icon}
              <h3 className="text-lg font-semibold">{config.label}</h3>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-white/80">Seguidores</span>
                <span className="font-bold text-xl">{currentPlatform.totalFollowers.toLocaleString('pt-BR')}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/80">Crescimento</span>
                <span className="font-semibold flex items-center gap-1">
                  <TrendingUp className="h-4 w-4" />
                  +{currentPlatform.followerGrowth}%
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="h-5 w-5 text-primary" />
              <h4 className="font-medium">Engajamento Médio</h4>
            </div>
            <p className="text-3xl font-bold">
              {(currentPlatform.contentTypes.reduce((acc, ct) => acc + ct.metrics.engagementRate, 0) / currentPlatform.contentTypes.length).toFixed(1)}%
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Taxa de engajamento geral
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Eye className="h-5 w-5 text-blue-500" />
              <h4 className="font-medium">Visualizações Totais</h4>
            </div>
            <p className="text-3xl font-bold">
              {currentPlatform.contentTypes.reduce((acc, ct) => acc + ct.metrics.views, 0).toLocaleString('pt-BR')}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Em {period} dias
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Content Types Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Desempenho por Tipo de Conteúdo</CardTitle>
          <CardDescription>
            Métricas detalhadas de Stories, Feed, Reels, Shorts e Posts
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={currentPlatform.contentTypes[0]?.type || 'video'} className="space-y-4">
            <TabsList className="flex-wrap h-auto gap-1">
              {currentPlatform.contentTypes.map(ct => (
                <TabsTrigger key={ct.type} value={ct.type} className="gap-1">
                  {contentTypeConfig[ct.type].icon}
                  {contentTypeConfig[ct.type].label}
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {ct.count}
                  </Badge>
                </TabsTrigger>
              ))}
            </TabsList>

            {currentPlatform.contentTypes.map(ct => (
              <TabsContent key={ct.type} value={ct.type} className="space-y-4">
                {/* Trend Badge */}
                <div className="flex items-center gap-2">
                  <Badge 
                    variant={ct.trend > 0 ? 'default' : 'secondary'}
                    className={ct.trend > 0 ? 'bg-green-500' : ct.trend < 0 ? 'bg-red-500' : ''}
                  >
                    <TrendIcon trend={ct.trend} />
                    <span className="ml-1">
                      {ct.trend > 0 ? '+' : ''}{ct.trend}% vs período anterior
                    </span>
                  </Badge>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  <div className="bg-muted/50 rounded-lg p-3">
                    <div className="flex items-center gap-1 text-muted-foreground text-sm mb-1">
                      <Eye className="h-3 w-3" />
                      Visualizações
                    </div>
                    <p className="text-xl font-bold">{ct.metrics.views.toLocaleString('pt-BR')}</p>
                  </div>
                  
                  {ct.metrics.likes > 0 && (
                    <div className="bg-muted/50 rounded-lg p-3">
                      <div className="flex items-center gap-1 text-muted-foreground text-sm mb-1">
                        <Heart className="h-3 w-3" />
                        Curtidas
                      </div>
                      <p className="text-xl font-bold">{ct.metrics.likes.toLocaleString('pt-BR')}</p>
                    </div>
                  )}
                  
                  {ct.metrics.comments > 0 && (
                    <div className="bg-muted/50 rounded-lg p-3">
                      <div className="flex items-center gap-1 text-muted-foreground text-sm mb-1">
                        <MessageCircle className="h-3 w-3" />
                        Comentários
                      </div>
                      <p className="text-xl font-bold">{ct.metrics.comments.toLocaleString('pt-BR')}</p>
                    </div>
                  )}
                  
                  <div className="bg-muted/50 rounded-lg p-3">
                    <div className="flex items-center gap-1 text-muted-foreground text-sm mb-1">
                      <Share2 className="h-3 w-3" />
                      Compartilhamentos
                    </div>
                    <p className="text-xl font-bold">{ct.metrics.shares.toLocaleString('pt-BR')}</p>
                  </div>
                  
                  {ct.metrics.saves > 0 && (
                    <div className="bg-muted/50 rounded-lg p-3">
                      <div className="flex items-center gap-1 text-muted-foreground text-sm mb-1">
                        <Bookmark className="h-3 w-3" />
                        Salvos
                      </div>
                      <p className="text-xl font-bold">{ct.metrics.saves.toLocaleString('pt-BR')}</p>
                    </div>
                  )}
                  
                  <div className="bg-muted/50 rounded-lg p-3">
                    <div className="flex items-center gap-1 text-muted-foreground text-sm mb-1">
                      <Users className="h-3 w-3" />
                      Alcance
                    </div>
                    <p className="text-xl font-bold">{ct.metrics.reach.toLocaleString('pt-BR')}</p>
                  </div>
                </div>

                {/* Stories/Video specific metrics */}
                {(ct.type === 'stories' || ct.type === 'reels' || ct.type === 'shorts' || ct.type === 'video') && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                    {ct.metrics.avgWatchTime && (
                      <Card>
                        <CardContent className="pt-4">
                          <h5 className="text-sm font-medium text-muted-foreground mb-2">Tempo Médio de Visualização</h5>
                          <p className="text-2xl font-bold">{ct.metrics.avgWatchTime}s</p>
                        </CardContent>
                      </Card>
                    )}
                    
                    {ct.metrics.completionRate && (
                      <Card>
                        <CardContent className="pt-4">
                          <h5 className="text-sm font-medium text-muted-foreground mb-2">Taxa de Conclusão</h5>
                          <div className="space-y-2">
                            <p className="text-2xl font-bold">{ct.metrics.completionRate}%</p>
                            <Progress value={ct.metrics.completionRate} className="h-2" />
                          </div>
                        </CardContent>
                      </Card>
                    )}
                    
                    {ct.metrics.exits && (
                      <Card>
                        <CardContent className="pt-4">
                          <h5 className="text-sm font-medium text-muted-foreground mb-2">Saídas</h5>
                          <p className="text-2xl font-bold">{ct.metrics.exits.toLocaleString('pt-BR')}</p>
                        </CardContent>
                      </Card>
                    )}

                    {ct.metrics.replies && (
                      <Card>
                        <CardContent className="pt-4">
                          <h5 className="text-sm font-medium text-muted-foreground mb-2">Respostas</h5>
                          <p className="text-2xl font-bold">{ct.metrics.replies.toLocaleString('pt-BR')}</p>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )}

                {/* Engagement Rate */}
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h5 className="text-sm font-medium text-muted-foreground">Taxa de Engajamento</h5>
                        <p className="text-3xl font-bold mt-1">{ct.metrics.engagementRate}%</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">Impressões</p>
                        <p className="text-xl font-semibold">{ct.metrics.impressions.toLocaleString('pt-BR')}</p>
                      </div>
                    </div>
                    <Progress value={ct.metrics.engagementRate * 10} className="mt-4 h-2" />
                  </CardContent>
                </Card>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      {/* Daily Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Evolução Diária</CardTitle>
          <CardDescription>
            Visualizações e engajamento ao longo do período
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[300px]">
            <ComposedChart data={currentPlatform.dailyData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="date" className="text-xs" />
              <YAxis className="text-xs" />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area 
                type="monotone" 
                dataKey="views" 
                fill={config.color} 
                fillOpacity={0.2}
                stroke={config.color}
                strokeWidth={2}
              />
              <Line 
                type="monotone" 
                dataKey="engagement" 
                stroke="hsl(var(--chart-2))"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </ComposedChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* All Platforms Comparison */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Comparativo entre Plataformas</CardTitle>
          <CardDescription>
            Visualização geral de todas as redes sociais
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {platformData.map(platform => {
              const pConfig = platformConfig[platform.platform];
              const totalViews = platform.contentTypes.reduce((acc, ct) => acc + ct.metrics.views, 0);
              const avgEngagement = platform.contentTypes.reduce((acc, ct) => acc + ct.metrics.engagementRate, 0) / platform.contentTypes.length;
              const maxViews = Math.max(...platformData.map(p => p.contentTypes.reduce((acc, ct) => acc + ct.metrics.views, 0)));
              
              return (
                <div key={platform.platform} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span style={{ color: pConfig.color }}>{pConfig.icon}</span>
                      <span className="font-medium">{pConfig.label}</span>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span>{totalViews.toLocaleString('pt-BR')} views</span>
                      <Badge variant="outline">{avgEngagement.toFixed(1)}% eng.</Badge>
                    </div>
                  </div>
                  <Progress 
                    value={(totalViews / maxViews) * 100} 
                    className="h-2"
                    style={{ 
                      // @ts-ignore
                      '--progress-background': pConfig.color 
                    }}
                  />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
