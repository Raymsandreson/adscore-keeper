import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  ComposedChart,
} from "recharts";
import { 
  TrendingUp, 
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Equal
} from "lucide-react";
import { format, subDays, isSameDay } from "date-fns";
import { cn } from "@/lib/utils";
import type { Post, Platform } from "@/types/editorial";
import { PlatformIcon } from "./PlatformIcon";

interface CorrelationData {
  date: string;
  ctr: number;
  cpc: number;
  conversions: number;
  reach: number;
  organicReach: number;
  hasPost: boolean;
  postTitle?: string;
  postPlatform?: Platform;
}

interface OrganicPaidCorrelationProps {
  posts: Post[];
}

// Generate mock correlation data
const generateCorrelationData = (posts: Post[]): CorrelationData[] => {
  const data: CorrelationData[] = [];
  const baseDate = new Date(2026, 0, 1);

  for (let i = 0; i < 15; i++) {
    const currentDate = subDays(baseDate, -i);
    const publishedPost = posts.find(
      p => p.status === "published" && isSameDay(p.scheduled_date, currentDate)
    );

    // Base metrics with some randomness
    let baseCtr = 1.8 + Math.random() * 0.4;
    let baseCpc = 2.5 - Math.random() * 0.3;
    let baseConversions = 15 + Math.floor(Math.random() * 10);
    let baseReach = 8000 + Math.floor(Math.random() * 2000);
    let organicReach = 0;

    // If there's an organic post, boost the metrics
    if (publishedPost) {
      const boost = 1 + (publishedPost.engagement_reach || 10000) / 50000;
      baseCtr *= boost;
      baseCpc /= boost;
      baseConversions = Math.floor(baseConversions * boost);
      baseReach = Math.floor(baseReach * boost);
      organicReach = publishedPost.engagement_reach || 0;
    }

    // Also check if previous day had a post (delayed effect)
    const previousDayPost = posts.find(
      p => p.status === "published" && isSameDay(p.scheduled_date, subDays(currentDate, 1))
    );
    if (previousDayPost) {
      const delayedBoost = 1.15;
      baseCtr *= delayedBoost;
      baseCpc /= delayedBoost;
      baseConversions = Math.floor(baseConversions * delayedBoost);
    }

    data.push({
      date: format(currentDate, "dd/MM"),
      ctr: Number(baseCtr.toFixed(2)),
      cpc: Number(baseCpc.toFixed(2)),
      conversions: baseConversions,
      reach: baseReach,
      organicReach,
      hasPost: !!publishedPost,
      postTitle: publishedPost?.title,
      postPlatform: publishedPost?.platform,
    });
  }

  return data;
};

// Calculate correlation insights
const calculateInsights = (data: CorrelationData[]) => {
  const daysWithPosts = data.filter(d => d.hasPost);
  const daysWithoutPosts = data.filter(d => !d.hasPost);

  if (daysWithPosts.length === 0 || daysWithoutPosts.length === 0) {
    return null;
  }

  const avgCtrWithPosts = daysWithPosts.reduce((acc, d) => acc + d.ctr, 0) / daysWithPosts.length;
  const avgCtrWithoutPosts = daysWithoutPosts.reduce((acc, d) => acc + d.ctr, 0) / daysWithoutPosts.length;
  
  const avgCpcWithPosts = daysWithPosts.reduce((acc, d) => acc + d.cpc, 0) / daysWithPosts.length;
  const avgCpcWithoutPosts = daysWithoutPosts.reduce((acc, d) => acc + d.cpc, 0) / daysWithoutPosts.length;

  const avgConversionsWithPosts = daysWithPosts.reduce((acc, d) => acc + d.conversions, 0) / daysWithPosts.length;
  const avgConversionsWithoutPosts = daysWithoutPosts.reduce((acc, d) => acc + d.conversions, 0) / daysWithoutPosts.length;

  return {
    ctrLift: ((avgCtrWithPosts - avgCtrWithoutPosts) / avgCtrWithoutPosts) * 100,
    cpcReduction: ((avgCpcWithoutPosts - avgCpcWithPosts) / avgCpcWithoutPosts) * 100,
    conversionsLift: ((avgConversionsWithPosts - avgConversionsWithoutPosts) / avgConversionsWithoutPosts) * 100,
    avgCtrWithPosts,
    avgCtrWithoutPosts,
    avgCpcWithPosts,
    avgCpcWithoutPosts,
    avgConversionsWithPosts,
    avgConversionsWithoutPosts,
  };
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;

  const data = payload[0]?.payload;

  return (
    <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
      <p className="font-medium text-sm mb-2">{label}</p>
      {data.hasPost && data.postPlatform && (
        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border">
          <PlatformIcon platform={data.postPlatform} className="h-4 w-4" />
          <span className="text-xs text-primary">{data.postTitle}</span>
        </div>
      )}
      <div className="space-y-1 text-xs">
        <p><span className="text-muted-foreground">CTR:</span> {data.ctr}%</p>
        <p><span className="text-muted-foreground">CPC:</span> R$ {data.cpc}</p>
        <p><span className="text-muted-foreground">Conversões:</span> {data.conversions}</p>
        {data.organicReach > 0 && (
          <p><span className="text-muted-foreground">Alcance Orgânico:</span> {data.organicReach.toLocaleString()}</p>
        )}
      </div>
    </div>
  );
};

export function OrganicPaidCorrelation({ posts }: OrganicPaidCorrelationProps) {
  const correlationData = useMemo(() => generateCorrelationData(posts), [posts]);
  const insights = useMemo(() => calculateInsights(correlationData), [correlationData]);

  const getImpactIcon = (value: number, inverse: boolean = false) => {
    const isPositive = inverse ? value > 0 : value > 0;
    if (Math.abs(value) < 2) return <Equal className="h-4 w-4 text-muted-foreground" />;
    if (isPositive) return <ArrowUpRight className="h-4 w-4 text-green-500" />;
    return <ArrowDownRight className="h-4 w-4 text-red-500" />;
  };

  const getImpactColor = (value: number, inverse: boolean = false) => {
    const isPositive = inverse ? value > 0 : value > 0;
    if (Math.abs(value) < 2) return "text-muted-foreground";
    return isPositive ? "text-green-500" : "text-red-500";
  };

  return (
    <Card className="bg-card/50 backdrop-blur border-border/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-500" />
            Correlação Orgânico x Pago
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            Últimos 15 dias
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Insights Cards */}
        {insights && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-muted/30 rounded-lg p-4 border border-border/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Impacto no CTR</span>
                {getImpactIcon(insights.ctrLift)}
              </div>
              <div className="flex items-baseline gap-2">
                <span className={cn("text-2xl font-bold", getImpactColor(insights.ctrLift))}>
                  {insights.ctrLift > 0 ? "+" : ""}{insights.ctrLift.toFixed(1)}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Com post: {insights.avgCtrWithPosts.toFixed(2)}% | Sem: {insights.avgCtrWithoutPosts.toFixed(2)}%
              </p>
            </div>

            <div className="bg-muted/30 rounded-lg p-4 border border-border/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Redução no CPC</span>
                {getImpactIcon(insights.cpcReduction)}
              </div>
              <div className="flex items-baseline gap-2">
                <span className={cn("text-2xl font-bold", getImpactColor(insights.cpcReduction))}>
                  {insights.cpcReduction > 0 ? "-" : "+"}{Math.abs(insights.cpcReduction).toFixed(1)}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Com post: R$ {insights.avgCpcWithPosts.toFixed(2)} | Sem: R$ {insights.avgCpcWithoutPosts.toFixed(2)}
              </p>
            </div>

            <div className="bg-muted/30 rounded-lg p-4 border border-border/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Lift em Conversões</span>
                {getImpactIcon(insights.conversionsLift)}
              </div>
              <div className="flex items-baseline gap-2">
                <span className={cn("text-2xl font-bold", getImpactColor(insights.conversionsLift))}>
                  {insights.conversionsLift > 0 ? "+" : ""}{insights.conversionsLift.toFixed(1)}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Com post: {insights.avgConversionsWithPosts.toFixed(0)} | Sem: {insights.avgConversionsWithoutPosts.toFixed(0)}
              </p>
            </div>
          </div>
        )}

        {/* Correlation Chart */}
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={correlationData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
              <XAxis 
                dataKey="date" 
                tick={{ fontSize: 12 }} 
                className="text-muted-foreground"
              />
              <YAxis 
                yAxisId="left"
                tick={{ fontSize: 12 }} 
                className="text-muted-foreground"
                label={{ value: 'CTR %', angle: -90, position: 'insideLeft', fontSize: 11 }}
              />
              <YAxis 
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 12 }} 
                className="text-muted-foreground"
                label={{ value: 'Conversões', angle: 90, position: 'insideRight', fontSize: 11 }}
              />
              <Tooltip content={<CustomTooltip />} />
              
              {/* Highlight days with organic posts */}
              {correlationData.map((entry, index) => 
                entry.hasPost ? (
                  <ReferenceLine
                    key={index}
                    x={entry.date}
                    yAxisId="left"
                    stroke="hsl(var(--primary))"
                    strokeDasharray="3 3"
                    strokeOpacity={0.5}
                  />
                ) : null
              )}

              <Area
                yAxisId="left"
                type="monotone"
                dataKey="ctr"
                fill="hsl(var(--primary))"
                fillOpacity={0.1}
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                name="CTR"
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="conversions"
                stroke="hsl(142 76% 36%)"
                strokeWidth={2}
                dot={(props: any) => {
                  const { cx, cy, payload } = props;
                  if (payload.hasPost) {
                    return (
                      <circle
                        key={props.key}
                        cx={cx}
                        cy={cy}
                        r={6}
                        fill="hsl(var(--primary))"
                        stroke="white"
                        strokeWidth={2}
                      />
                    );
                  }
                  return <circle key={props.key} cx={cx} cy={cy} r={3} fill="hsl(142 76% 36%)" />;
                }}
                name="Conversões"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-border/30">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-primary" />
            <span className="text-xs text-muted-foreground">CTR (%)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "hsl(142 76% 36%)" }} />
            <span className="text-xs text-muted-foreground">Conversões</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-0.5 border-t-2 border-dashed border-primary/50" />
            <span className="text-xs text-muted-foreground">Dia com post orgânico</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full border-2 border-primary bg-primary/20" />
            <span className="text-xs text-muted-foreground">Pico com post</span>
          </div>
        </div>

        {/* Insights Summary */}
        <div className="bg-gradient-to-r from-primary/5 to-primary/10 rounded-lg p-4 border border-primary/20">
          <div className="flex items-start gap-3">
            <TrendingUp className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium text-sm">Insight de Performance</p>
              <p className="text-sm text-muted-foreground mt-1">
                {insights && insights.ctrLift > 5 ? (
                  <>
                    Seus posts orgânicos estão gerando um <strong className="text-primary">lift de {insights.ctrLift.toFixed(0)}%</strong> no CTR 
                    dos anúncios pagos. Considere aumentar a frequência de publicações orgânicas para maximizar esse efeito.
                  </>
                ) : insights && insights.ctrLift > 0 ? (
                  <>
                    Há uma correlação positiva moderada entre seus posts orgânicos e o desempenho pago. 
                    Experimente publicar conteúdo orgânico 1-2 horas antes de grandes campanhas pagas.
                  </>
                ) : (
                  <>
                    A correlação entre orgânico e pago ainda está sendo calculada. 
                    Continue publicando para obter insights mais precisos.
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
