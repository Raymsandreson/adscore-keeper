import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  Calendar,
  Megaphone,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { CampaignInsight, DailyInsight } from "@/hooks/useMetaAPI";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer,
  Cell,
  LineChart,
  Line,
  CartesianGrid
} from "recharts";

interface SpendBreakdownProps {
  campaigns: CampaignInsight[];
  dailyData: DailyInsight[];
  totalSpend: number;
  isConnected: boolean;
}

const SpendBreakdown = ({ campaigns, dailyData, totalSpend, isConnected }: SpendBreakdownProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Sort campaigns by spend (descending)
  const sortedCampaigns = [...campaigns].sort((a, b) => b.spend - a.spend);
  
  // Calculate campaign percentages
  const campaignData = sortedCampaigns.map(campaign => ({
    name: campaign.name.length > 25 ? campaign.name.substring(0, 25) + '...' : campaign.name,
    fullName: campaign.name,
    spend: campaign.spend,
    percentage: totalSpend > 0 ? (campaign.spend / totalSpend) * 100 : 0,
    conversions: campaign.conversions,
    cpa: campaign.conversions > 0 ? campaign.spend / campaign.conversions : 0
  }));

  // Format daily data for chart
  const dailyChartData = dailyData.map(day => ({
    date: new Date(day.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
    fullDate: day.date,
    spend: day.spend,
    conversions: day.conversions
  }));

  // Calculate daily average
  const dailyAverage = dailyData.length > 0 
    ? dailyData.reduce((sum, day) => sum + day.spend, 0) / dailyData.length 
    : 0;

  // Get trend (compare last 3 days vs first 3 days)
  const getTrend = () => {
    if (dailyData.length < 6) return null;
    const firstHalf = dailyData.slice(0, 3).reduce((sum, d) => sum + d.spend, 0) / 3;
    const lastHalf = dailyData.slice(-3).reduce((sum, d) => sum + d.spend, 0) / 3;
    const change = ((lastHalf - firstHalf) / firstHalf) * 100;
    return { change, direction: change >= 0 ? 'up' : 'down' };
  };

  const trend = getTrend();

  const formatCurrency = (value: number) => 
    `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
          <p className="font-medium text-foreground">{payload[0]?.payload?.fullName || label}</p>
          <p className="text-primary font-bold">{formatCurrency(payload[0]?.value || 0)}</p>
          {payload[0]?.payload?.conversions !== undefined && (
            <p className="text-muted-foreground text-sm">
              {payload[0].payload.conversions} conversões
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  const colors = ['hsl(var(--primary))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

  return (
    <Card className="border-border/50">
      <CardHeader 
        className="cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <DollarSign className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Gasto Total</CardTitle>
              <p className="text-2xl font-bold text-foreground">
                {formatCurrency(totalSpend)}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {trend && (
              <Badge 
                variant="outline" 
                className={trend.direction === 'up' 
                  ? 'border-red-500/50 text-red-600 dark:text-red-400' 
                  : 'border-green-500/50 text-green-600 dark:text-green-400'
                }
              >
                {trend.direction === 'up' ? (
                  <TrendingUp className="h-3 w-3 mr-1" />
                ) : (
                  <TrendingDown className="h-3 w-3 mr-1" />
                )}
                {Math.abs(trend.change).toFixed(1)}%
              </Badge>
            )}
            
            {isExpanded ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0">
          <Tabs defaultValue="campaigns" className="w-full">
            <TabsList className="grid w-full max-w-xs grid-cols-2 mb-4">
              <TabsTrigger value="campaigns" className="gap-1.5 text-sm">
                <Megaphone className="h-3.5 w-3.5" />
                Por Campanha
              </TabsTrigger>
              <TabsTrigger value="daily" className="gap-1.5 text-sm">
                <Calendar className="h-3.5 w-3.5" />
                Por Dia
              </TabsTrigger>
            </TabsList>

            <TabsContent value="campaigns" className="space-y-4">
              {!isConnected || campaignData.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Megaphone className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Conecte-se ao Meta para ver breakdown por campanha</p>
                </div>
              ) : (
                <>
                  {/* Bar Chart */}
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={campaignData} layout="vertical" margin={{ left: 10, right: 30 }}>
                        <XAxis type="number" tickFormatter={(v) => `R$ ${v}`} />
                        <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="spend" radius={[0, 4, 4, 0]}>
                          {campaignData.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Campaign List */}
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {campaignData.map((campaign, index) => (
                      <div 
                        key={index}
                        className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div 
                            className="w-3 h-3 rounded-full shrink-0" 
                            style={{ backgroundColor: colors[index % colors.length] }}
                          />
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate" title={campaign.fullName}>
                              {campaign.fullName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {campaign.conversions} conv. | CPA: {formatCurrency(campaign.cpa)}
                            </p>
                          </div>
                        </div>
                        <div className="text-right shrink-0 ml-4">
                          <p className="font-bold text-sm">{formatCurrency(campaign.spend)}</p>
                          <p className="text-xs text-muted-foreground">
                            {campaign.percentage.toFixed(1)}%
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="daily" className="space-y-4">
              {!isConnected || dailyChartData.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Conecte-se ao Meta para ver breakdown diário</p>
                </div>
              ) : (
                <>
                  {/* Daily Stats */}
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="p-3 rounded-lg bg-muted/30">
                      <p className="text-xs text-muted-foreground mb-1">Média diária</p>
                      <p className="font-bold text-lg">{formatCurrency(dailyAverage)}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/30">
                      <p className="text-xs text-muted-foreground mb-1">Dias analisados</p>
                      <p className="font-bold text-lg">{dailyData.length} dias</p>
                    </div>
                  </div>

                  {/* Line Chart */}
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={dailyChartData} margin={{ left: 10, right: 30, top: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis tickFormatter={(v) => `R$ ${v}`} tick={{ fontSize: 11 }} />
                        <Tooltip content={<CustomTooltip />} />
                        <Line 
                          type="monotone" 
                          dataKey="spend" 
                          stroke="hsl(var(--primary))" 
                          strokeWidth={2}
                          dot={{ fill: 'hsl(var(--primary))', strokeWidth: 2, r: 3 }}
                          activeDot={{ r: 5 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Daily List */}
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {[...dailyChartData].reverse().map((day, index) => (
                      <div 
                        key={index}
                        className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm">{day.date}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <Badge variant="outline" className="text-xs">
                            {day.conversions} conv.
                          </Badge>
                          <span className="font-medium text-sm">{formatCurrency(day.spend)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      )}
    </Card>
  );
};

export default SpendBreakdown;
