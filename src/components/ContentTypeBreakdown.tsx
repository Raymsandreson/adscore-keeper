import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Play, 
  Image as ImageIcon, 
  LayoutGrid, 
  Clock,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  Bookmark,
  Users
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface ContentTypeBreakdown {
  reels: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    reach: number;
    count: number;
  };
  feed: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    reach: number;
    count: number;
  };
  stories: {
    views: number;
    replies: number;
    exits: number;
    reach: number;
    count: number;
  };
  carousel: {
    views: number;
    likes: number;
    comments: number;
    saves: number;
    reach: number;
    count: number;
  };
}

interface ContentTypeBreakdownProps {
  breakdown?: ContentTypeBreakdown;
  periodLabel: string;
}

const formatNumber = (num: number): string => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toLocaleString('pt-BR');
};

export const ContentTypeBreakdownComponent = ({ breakdown, periodLabel }: ContentTypeBreakdownProps) => {
  if (!breakdown) {
    return (
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <LayoutGrid className="h-4 w-4" />
            Detalhamento por Tipo de Conteúdo
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm text-center py-4">
            Dados de detalhamento não disponíveis
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalViews = 
    breakdown.reels.views + 
    breakdown.feed.views + 
    breakdown.carousel.views + 
    breakdown.stories.views;

  const contentTypes = [
    {
      key: 'reels' as const,
      label: 'Reels',
      icon: Play,
      color: 'bg-pink-500',
      textColor: 'text-pink-500',
      bgLight: 'bg-pink-500/10',
      data: breakdown.reels,
      hasShares: true,
      isStory: false,
      percentage: totalViews > 0 ? (breakdown.reels.views / totalViews) * 100 : 0
    },
    {
      key: 'feed' as const,
      label: 'Feed',
      icon: ImageIcon,
      color: 'bg-blue-500',
      textColor: 'text-blue-500',
      bgLight: 'bg-blue-500/10',
      data: breakdown.feed,
      hasShares: false,
      isStory: false,
      percentage: totalViews > 0 ? (breakdown.feed.views / totalViews) * 100 : 0
    },
    {
      key: 'carousel' as const,
      label: 'Carrossel',
      icon: LayoutGrid,
      color: 'bg-purple-500',
      textColor: 'text-purple-500',
      bgLight: 'bg-purple-500/10',
      data: breakdown.carousel,
      hasShares: false,
      isStory: false,
      percentage: totalViews > 0 ? (breakdown.carousel.views / totalViews) * 100 : 0
    },
    {
      key: 'stories' as const,
      label: 'Stories',
      icon: Clock,
      color: 'bg-orange-500',
      textColor: 'text-orange-500',
      bgLight: 'bg-orange-500/10',
      data: breakdown.stories,
      hasShares: false,
      isStory: true,
      percentage: totalViews > 0 ? (breakdown.stories.views / totalViews) * 100 : 0
    }
  ];

  // Filter out content types with no data
  const activeContentTypes = contentTypes.filter(type => type.data.count > 0 || type.data.views > 0);

  if (activeContentTypes.length === 0) {
    return (
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <LayoutGrid className="h-4 w-4" />
            Detalhamento por Tipo de Conteúdo
            <Badge variant="secondary" className="ml-2 text-xs">{periodLabel}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm text-center py-4">
            Nenhum conteúdo encontrado no período
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <LayoutGrid className="h-4 w-4" />
            Visualizações por Tipo de Conteúdo
            <Badge variant="secondary" className="ml-2 text-xs">{periodLabel}</Badge>
          </CardTitle>
          <div className="text-right">
            <span className="text-2xl font-bold">{formatNumber(totalViews)}</span>
            <span className="text-muted-foreground text-xs ml-1">total</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <TooltipProvider>
          {/* Visual bar showing distribution */}
          <div className="flex h-3 rounded-full overflow-hidden mb-4">
            {activeContentTypes.map((type) => (
              <Tooltip key={type.key}>
                <TooltipTrigger asChild>
                  <div 
                    className={`${type.color} transition-all hover:opacity-80`}
                    style={{ width: `${Math.max(type.percentage, 2)}%` }}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  <p>{type.label}: {type.percentage.toFixed(1)}%</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>

          {/* Content type cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {contentTypes.map((type) => {
              const Icon = type.icon;
              const hasData = type.data.count > 0 || type.data.views > 0;
              
              return (
                <div 
                  key={type.key}
                  className={`rounded-lg p-3 ${type.bgLight} ${!hasData ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`p-1.5 rounded ${type.color}`}>
                      <Icon className="h-3.5 w-3.5 text-white" />
                    </div>
                    <span className="font-medium text-sm">{type.label}</span>
                    {type.data.count > 0 && (
                      <Badge variant="outline" className="ml-auto text-xs">
                        {type.data.count} posts
                      </Badge>
                    )}
                  </div>
                  
                  {hasData ? (
                    <div className="space-y-1.5">
                      {/* Main metric - Views */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Eye className="h-3 w-3" />
                          <span className="text-xs">Visualizações</span>
                        </div>
                        <span className={`font-semibold text-sm ${type.textColor}`}>
                          {formatNumber(type.data.views)}
                        </span>
                      </div>
                      
                      {/* Reach */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Users className="h-3 w-3" />
                          <span className="text-xs">Alcance</span>
                        </div>
                        <span className="font-medium text-xs">
                          {formatNumber(type.data.reach)}
                        </span>
                      </div>

                      {/* Engagement metrics for non-story content */}
                      {!type.isStory && type.key !== 'stories' && (
                        <div className="flex items-center gap-2 pt-1 border-t border-border/50 mt-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Heart className="h-3 w-3" />
                                <span>{formatNumber((type.data as typeof breakdown.reels).likes)}</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>Curtidas</TooltipContent>
                          </Tooltip>
                          
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <MessageCircle className="h-3 w-3" />
                                <span>{formatNumber((type.data as typeof breakdown.reels).comments)}</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>Comentários</TooltipContent>
                          </Tooltip>
                          
                          {type.hasShares && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Share2 className="h-3 w-3" />
                                  <span>{formatNumber((type.data as typeof breakdown.reels).shares)}</span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>Compartilhamentos</TooltipContent>
                            </Tooltip>
                          )}
                          
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Bookmark className="h-3 w-3" />
                                <span>{formatNumber((type.data as typeof breakdown.reels).saves)}</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>Salvos</TooltipContent>
                          </Tooltip>
                        </div>
                      )}
                      
                      {/* Stories specific metrics */}
                      {type.isStory && type.key === 'stories' && (
                        <div className="flex items-center gap-2 pt-1 border-t border-border/50 mt-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <MessageCircle className="h-3 w-3" />
                                <span>{formatNumber((type.data as typeof breakdown.stories).replies)}</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>Respostas</TooltipContent>
                          </Tooltip>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      Sem dados
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
};

export default ContentTypeBreakdownComponent;
