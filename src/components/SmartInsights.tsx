import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Lightbulb, 
  TrendingUp, 
  AlertTriangle, 
  Sparkles, 
  RefreshCw,
  Clock,
  Hash,
  Image,
  Video,
  MessageCircle,
  Target,
  Zap,
  ChevronDown,
  ChevronUp,
  Loader2,
  LayoutGrid,
  Play,
  Camera,
  Film,
  Rocket,
  DollarSign
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface PostFormatCount {
  format: string;
  count: number;
  label: string;
  icon: React.ReactNode;
  engagement: number;
}

interface PostPattern {
  format: "image" | "video" | "carousel" | "reel" | "story";
  bestHour: string;
  bestDay: string;
  avgEngagement: number;
  topHashtags: string[];
  avgCaptionLength: number;
  hasCallToAction: boolean;
}

interface SmartInsightsProps {
  organicImpressions: number;
  paidImpressions: number;
  organicEngagement?: number;
  paidEngagement?: number;
  adSpend?: number;
  topPosts?: Array<{
    id: string;
    type: string;
    engagement: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    caption?: string;
    timestamp?: string;
  }>;
  period?: string;
}

export const SmartInsights = ({
  organicImpressions,
  paidImpressions,
  organicEngagement = 0,
  paidEngagement = 0,
  adSpend = 0,
  topPosts = [],
  period = "7 dias"
}: SmartInsightsProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [viralIdeas, setViralIdeas] = useState<string[]>([]);
  const [patterns, setPatterns] = useState<PostPattern | null>(null);
  const [formatCounts, setFormatCounts] = useState<PostFormatCount[]>([]);

  const totalImpressions = organicImpressions + paidImpressions;
  const organicPercentage = totalImpressions > 0 ? (organicImpressions / totalImpressions) * 100 : 0;
  const paidPercentage = totalImpressions > 0 ? (paidImpressions / totalImpressions) * 100 : 0;
  
  const organicWins = organicPercentage > paidPercentage;
  const significantDifference = Math.abs(organicPercentage - paidPercentage) > 15;

  // Calculate cost per 1000 organic-equivalent views
  const cpmEffective = paidImpressions > 0 && adSpend > 0 
    ? (adSpend / paidImpressions) * 1000 
    : 0;

  // Analyze post patterns and format counts
  useEffect(() => {
    if (topPosts.length > 0) {
      analyzePatterns();
      countFormats();
    }
  }, [topPosts]);

  const countFormats = () => {
    const counts: Record<string, { count: number; totalEngagement: number }> = {};
    
    topPosts.forEach(post => {
      const format = normalizeFormat(post.type);
      if (!counts[format]) {
        counts[format] = { count: 0, totalEngagement: 0 };
      }
      counts[format].count++;
      counts[format].totalEngagement += post.engagement || 0;
    });

    const formatData: PostFormatCount[] = Object.entries(counts).map(([format, data]) => ({
      format,
      count: data.count,
      label: getFormatLabel(format),
      icon: getFormatIconComponent(format),
      engagement: data.count > 0 ? data.totalEngagement / data.count : 0
    })).sort((a, b) => b.count - a.count);

    setFormatCounts(formatData);
  };

  const normalizeFormat = (type: string): string => {
    const lower = type?.toLowerCase() || "image";
    if (lower.includes("reel") || lower === "video") return "reel";
    if (lower.includes("carousel") || lower.includes("album")) return "carousel";
    if (lower.includes("story")) return "story";
    return "image";
  };

  const getFormatLabel = (format: string): string => {
    switch (format) {
      case "reel": return "Reels";
      case "carousel": return "Carrosséis";
      case "story": return "Stories";
      case "image": return "Imagens";
      default: return "Posts";
    }
  };

  const getFormatIconComponent = (format: string): React.ReactNode => {
    switch (format) {
      case "reel": return <Play className="h-4 w-4" />;
      case "carousel": return <LayoutGrid className="h-4 w-4" />;
      case "story": return <Film className="h-4 w-4" />;
      case "image": return <Camera className="h-4 w-4" />;
      default: return <Image className="h-4 w-4" />;
    }
  };

  const analyzePatterns = () => {
    if (topPosts.length === 0) return;

    // Find most common format
    const formatCounts: Record<string, number> = {};
    topPosts.forEach(post => {
      const format = normalizeFormat(post.type);
      formatCounts[format] = (formatCounts[format] || 0) + 1;
    });
    const bestFormat = Object.entries(formatCounts)
      .sort(([, a], [, b]) => b - a)[0]?.[0] as PostPattern["format"] || "image";

    // Analyze posting times
    const hours: number[] = [];
    const days: number[] = [];
    topPosts.forEach(post => {
      if (post.timestamp) {
        const date = new Date(post.timestamp);
        hours.push(date.getHours());
        days.push(date.getDay());
      }
    });

    const avgHour = hours.length > 0 ? Math.round(hours.reduce((a, b) => a + b, 0) / hours.length) : 18;
    const avgDay = days.length > 0 ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : 2;

    const dayNames = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

    // Calculate average engagement
    const avgEngagement = topPosts.reduce((sum, post) => sum + post.engagement, 0) / topPosts.length;

    // Extract common hashtags from captions
    const hashtagCounts: Record<string, number> = {};
    topPosts.forEach(post => {
      if (post.caption) {
        const hashtags = post.caption.match(/#\w+/g) || [];
        hashtags.forEach(tag => {
          hashtagCounts[tag] = (hashtagCounts[tag] || 0) + 1;
        });
      }
    });
    const topHashtags = Object.entries(hashtagCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([tag]) => tag);

    // Average caption length
    const avgCaptionLength = topPosts.reduce((sum, post) => 
      sum + (post.caption?.length || 0), 0) / topPosts.length;

    // Check for CTAs
    const ctaKeywords = ["clique", "link", "comente", "compartilhe", "salve", "arrasta", "saiba mais", "confira"];
    const hasCallToAction = topPosts.some(post => 
      post.caption && ctaKeywords.some(cta => 
        post.caption!.toLowerCase().includes(cta)
      )
    );

    setPatterns({
      format: bestFormat,
      bestHour: `${avgHour}:00`,
      bestDay: dayNames[avgDay],
      avgEngagement,
      topHashtags,
      avgCaptionLength: Math.round(avgCaptionLength),
      hasCallToAction
    });
  };

  const generateViralIdeas = async () => {
    setIsLoadingAI(true);
    try {
      const context = {
        organicWins,
        organicPercentage: organicPercentage.toFixed(1),
        paidPercentage: paidPercentage.toFixed(1),
        topFormats: patterns?.format || "video",
        bestTime: patterns?.bestHour || "18:00",
        bestDay: patterns?.bestDay || "Terça",
        avgEngagement: patterns?.avgEngagement?.toFixed(2) || "0",
        topHashtags: patterns?.topHashtags?.join(", ") || "",
        hasCTA: patterns?.hasCallToAction || false,
        formatBreakdown: formatCounts.map(f => `${f.label}: ${f.count}`).join(", ")
      };

      const { data, error } = await cloudFunctions.invoke('goal-ai-suggestions', {
        body: {
          prompt: `Você é um especialista em marketing digital e viralização no Instagram. 
          
Contexto da conta:
- Visualizações orgânicas: ${context.organicPercentage}% vs Pagas: ${context.paidPercentage}%
- Formatos publicados: ${context.formatBreakdown}
- Formato que mais funciona: ${context.topFormats}
- Melhor horário: ${context.bestTime}
- Melhor dia: ${context.bestDay}
- Taxa média de engajamento: ${context.avgEngagement}%
- Hashtags mais usadas: ${context.topHashtags}
- Usa CTAs: ${context.hasCTA ? "Sim" : "Não"}

Baseado nisso, sugira 4 ideias ESPECÍFICAS e ACIONÁVEIS para viralizar conteúdo. 
Cada ideia deve ter no máximo 2 linhas.
Formato: retorne APENAS as 4 ideias, uma por linha, sem numeração.`
        }
      });

      if (error) throw error;

      const ideas = data?.suggestion?.split('\n').filter((line: string) => line.trim()) || [
        "Crie Reels de 15-30 segundos com gancho nos primeiros 3 segundos",
        "Poste às " + (patterns?.bestHour || "18:00") + " - seu melhor horário de engajamento",
        "Use carrosséis educativos com 7-10 slides e CTA no último",
        "Responda comentários nos primeiros 30 minutos para aumentar alcance"
      ];

      setViralIdeas(ideas.slice(0, 4));
      toast.success("Ideias geradas com sucesso!");
    } catch (error) {
      console.error("Erro ao gerar ideias:", error);
      // Fallback ideas based on patterns
      setViralIdeas([
        `Crie mais ${patterns?.format || "vídeos"} - seu formato de maior engajamento`,
        `Poste às ${patterns?.bestHour || "18:00"} na ${patterns?.bestDay || "terça"} - seu melhor momento`,
        "Use carrosséis educativos com gancho forte no primeiro slide",
        "Adicione CTAs claros: 'Salve para depois' ou 'Comente sua opinião'"
      ]);
    } finally {
      setIsLoadingAI(false);
    }
  };

  const getAlertLevel = () => {
    // Orgânico superando = oportunidade de escalar investimento em ads
    if (organicWins && significantDifference) {
      return {
        type: "opportunity" as const,
        icon: Rocket,
        title: "🚀 Oportunidade de Escalar!",
        message: `Orgânico representa ${organicPercentage.toFixed(0)}% das visualizações. Seu conteúdo tem potencial, considere:`,
        suggestions: [
          "Aumentar investimento em anúncios para escalar o alcance",
          "Turbinar os posts orgânicos que estão performando bem",
          "Testar criativos baseados no conteúdo orgânico de sucesso",
          "O algoritmo está favorecendo seu conteúdo - hora de investir mais!"
        ],
        bgClass: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800",
        textClass: "text-blue-700 dark:text-blue-400",
        iconClass: "text-blue-600"
      };
    } 
    // Anúncios dominando = dependência alta, precisa melhorar orgânico
    else if (!organicWins && significantDifference) {
      return {
        type: "warning" as const,
        icon: AlertTriangle,
        title: "⚠️ Dependência de Anúncios Alta",
        message: `Os anúncios representam ${paidPercentage.toFixed(0)}% das visualizações. Considere:`,
        suggestions: [
          "Investir mais em conteúdo orgânico de qualidade",
          "Analisar por que o orgânico está com baixo alcance",
          "Criar conteúdo mais engajador para o algoritmo",
          "Diversificar formatos (Reels costumam ter mais alcance orgânico)"
        ],
        bgClass: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800",
        textClass: "text-amber-700 dark:text-amber-400",
        iconClass: "text-amber-600"
      };
    }
    return {
      type: "neutral" as const,
      icon: Lightbulb,
      title: "📊 Equilíbrio Saudável",
      message: "Distribuição equilibrada entre orgânico e pago.",
      suggestions: [
        "Continue monitorando a performance",
        "Teste novos formatos de conteúdo",
        "Otimize gradualmente o mix de investimento"
      ],
      bgClass: "bg-muted/50 border-border",
      textClass: "text-foreground",
      iconClass: "text-muted-foreground"
    };
  };

  const alert = getAlertLevel();
  const AlertIcon = alert.icon;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Insights Inteligentes
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            IA
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Smart Alert */}
        <div className={cn("rounded-lg p-4 border", alert.bgClass)}>
          <div className="flex items-start gap-3">
            <AlertIcon className={cn("h-5 w-5 mt-0.5", alert.iconClass)} />
            <div className="flex-1">
              <h4 className={cn("font-semibold text-sm mb-1", alert.textClass)}>
                {alert.title}
              </h4>
              <p className="text-xs text-muted-foreground mb-2">
                {alert.message}
              </p>
              <ul className="space-y-1">
                {alert.suggestions.map((suggestion, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                    <Target className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    {suggestion}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* CPM Comparison if available */}
        {cpmEffective > 0 && (
          <div className="bg-muted/30 rounded-lg p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">CPM dos Anúncios</span>
            </div>
            <Badge variant="outline" className="font-mono">
              R$ {cpmEffective.toFixed(2)}
            </Badge>
          </div>
        )}

        {/* Post Format Breakdown */}
        {formatCounts.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <LayoutGrid className="h-4 w-4 text-violet-500" />
              Posts por Formato
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {formatCounts.map((format, i) => (
                <div 
                  key={i}
                  className="bg-muted/50 rounded-lg p-3 flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-md bg-background">
                      {format.icon}
                    </div>
                    <div>
                      <p className="text-xs font-medium">{format.label}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {format.engagement.toFixed(1)}% eng
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {format.count}
                  </Badge>
                </div>
              ))}
            </div>
            {formatCounts.length === 0 && topPosts.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">
                Conecte para ver a análise de formatos
              </p>
            )}
          </div>
        )}

        {/* Pattern Analysis */}
        {patterns && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Zap className="h-4 w-4 text-yellow-500" />
                Padrões de Sucesso
              </h4>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(!isExpanded)}
                className="h-6 px-2"
              >
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="bg-muted/50 rounded-lg p-2 text-center cursor-help">
                      <div className="flex items-center justify-center gap-1 mb-1">
                        {getFormatIconComponent(patterns.format)}
                      </div>
                      <p className="text-xs font-medium capitalize">{getFormatLabel(patterns.format)}</p>
                      <p className="text-[10px] text-muted-foreground">Melhor formato</p>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Formato com maior engajamento nos seus posts</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="bg-muted/50 rounded-lg p-2 text-center cursor-help">
                      <div className="flex items-center justify-center gap-1 mb-1">
                        <Clock className="h-4 w-4" />
                      </div>
                      <p className="text-xs font-medium">{patterns.bestHour}</p>
                      <p className="text-[10px] text-muted-foreground">Melhor hora</p>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Horário com maior alcance nos seus posts</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="bg-muted/50 rounded-lg p-2 text-center cursor-help">
                      <div className="flex items-center justify-center gap-1 mb-1">
                        <MessageCircle className="h-4 w-4" />
                      </div>
                      <p className="text-xs font-medium">{patterns.avgEngagement.toFixed(1)}%</p>
                      <p className="text-[10px] text-muted-foreground">Engajamento</p>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Taxa média de engajamento dos top posts</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {isExpanded && (
              <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                {/* Top Hashtags */}
                {patterns.topHashtags.length > 0 && (
                  <div className="bg-muted/30 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Hash className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs font-medium">Hashtags que funcionam</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {patterns.topHashtags.map((tag, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Additional Patterns */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-muted/30 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1">Tamanho ideal da legenda</p>
                    <p className="text-sm font-medium">~{patterns.avgCaptionLength} caracteres</p>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1">CTA na legenda</p>
                    <p className="text-sm font-medium">
                      {patterns.hasCallToAction ? "✅ Recomendado" : "❌ Adicione CTAs"}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Viral Ideas */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-500" />
              Ideias para Viralizar
            </h4>
            <Button
              variant="outline"
              size="sm"
              onClick={generateViralIdeas}
              disabled={isLoadingAI}
              className="h-7 text-xs"
            >
              {isLoadingAI ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Gerando...
                </>
              ) : (
                <>
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Gerar com IA
                </>
              )}
            </Button>
          </div>

          {viralIdeas.length > 0 ? (
            <div className="space-y-2">
              {viralIdeas.map((idea, i) => (
                <div 
                  key={i}
                  className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-950/30 dark:to-pink-950/30 rounded-lg p-3 border border-purple-100 dark:border-purple-800"
                >
                  <p className="text-xs text-foreground">{idea}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 bg-muted/30 rounded-lg">
              <Lightbulb className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
              <p className="text-xs text-muted-foreground">
                Clique em "Gerar com IA" para receber ideias personalizadas
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default SmartInsights;
