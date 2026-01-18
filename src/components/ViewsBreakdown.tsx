import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Eye, TrendingUp, TrendingDown, Megaphone, Instagram, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface ViewsBreakdownProps {
  // Paid traffic data
  paidImpressions: number;
  paidReach?: number;
  // Organic traffic data
  organicImpressions: number;
  organicReach?: number;
  // Period comparison (optional)
  previousPaidImpressions?: number;
  previousOrganicImpressions?: number;
  // Config
  period?: string;
  isLoading?: boolean;
}

export const ViewsBreakdown = ({
  paidImpressions,
  paidReach,
  organicImpressions,
  organicReach,
  previousPaidImpressions,
  previousOrganicImpressions,
  period = "últimos 28 dias",
  isLoading = false
}: ViewsBreakdownProps) => {
  // Ensure values are always valid numbers
  const safePaidImpressions = paidImpressions ?? 0;
  const safeOrganicImpressions = organicImpressions ?? 0;
  const safePaidReach = paidReach ?? 0;
  const safeOrganicReach = organicReach ?? 0;
  
  const totalImpressions = safePaidImpressions + safeOrganicImpressions;
  const totalReach = safePaidReach + safeOrganicReach;

  // Calculate percentage changes
  const getPercentChange = (current: number, previous?: number) => {
    if (!previous || previous === 0) return null;
    return ((current - previous) / previous) * 100;
  };

  const paidChange = getPercentChange(safePaidImpressions, previousPaidImpressions);
  const organicChange = getPercentChange(safeOrganicImpressions, previousOrganicImpressions);
  const totalChange = previousPaidImpressions && previousOrganicImpressions 
    ? getPercentChange(totalImpressions, previousPaidImpressions + previousOrganicImpressions)
    : null;

  // Calculate distribution percentages
  const paidPercentage = totalImpressions > 0 ? (safePaidImpressions / totalImpressions) * 100 : 0;
  const organicPercentage = totalImpressions > 0 ? (safeOrganicImpressions / totalImpressions) * 100 : 0;

  const formatNumber = (num: number | undefined | null) => {
    const safeNum = num ?? 0;
    if (safeNum >= 1000000) {
      return `${(safeNum / 1000000).toFixed(1)}M`;
    }
    if (safeNum >= 1000) {
      return `${(safeNum / 1000).toFixed(1)}K`;
    }
    return safeNum.toLocaleString('pt-BR');
  };

  const ChangeIndicator = ({ change, size = "sm" }: { change: number | null; size?: "sm" | "lg" }) => {
    if (change === null) return null;
    
    const isPositive = change >= 0;
    const Icon = isPositive ? TrendingUp : TrendingDown;
    const colorClass = isPositive ? "text-green-600" : "text-red-500";
    const iconSize = size === "lg" ? "h-4 w-4" : "h-3 w-3";
    const textSize = size === "lg" ? "text-base" : "text-sm";
    
    return (
      <span className={cn("flex items-center gap-1", colorClass, textSize)}>
        <Icon className={iconSize} />
        {isPositive ? "+" : ""}{change.toFixed(1)}%
      </span>
    );
  };

  if (isLoading) {
    return (
      <Card className="border-border/50">
        <CardContent className="py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-6 bg-muted rounded w-3/4 mx-auto" />
            <div className="h-12 bg-muted rounded w-1/2 mx-auto" />
            <div className="h-4 bg-muted rounded w-2/3 mx-auto" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" />
            Detalhamento das Visualizações
          </CardTitle>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-xs">
                <p className="text-sm">
                  Impressões separadas por origem: anúncios pagos (Meta Ads) e conteúdo orgânico (Instagram/Facebook).
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <p className="text-xs text-muted-foreground">{period}</p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Total */}
        <div className="text-center pb-4 border-b border-border/50">
          <p className="text-sm text-muted-foreground mb-1">Total</p>
          <div className="flex items-center justify-center gap-3">
            <span className="text-3xl font-bold text-foreground">
              {formatNumber(totalImpressions)}
            </span>
            <ChangeIndicator change={totalChange} size="lg" />
          </div>
          {totalReach > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              Alcance: {formatNumber(totalReach)}
            </p>
          )}
        </div>

        {/* Distribution Bar */}
        <div className="space-y-2">
          <div className="flex h-3 rounded-full overflow-hidden bg-muted">
            <div 
              className="bg-gradient-to-r from-green-500 to-green-600 transition-all duration-500"
              style={{ width: `${organicPercentage}%` }}
            />
            <div 
              className="bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-500"
              style={{ width: `${paidPercentage}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              Orgânico: {organicPercentage.toFixed(1)}%
            </span>
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              Anúncios: {paidPercentage.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Breakdown Cards */}
        <div className="grid grid-cols-1 gap-4">
          {/* Organic */}
          <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-4 border border-green-200 dark:border-green-800">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Instagram className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium text-green-700 dark:text-green-400">
                    De orgânico
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold text-green-700 dark:text-green-300">
                    {formatNumber(organicImpressions)}
                  </span>
                  <ChangeIndicator change={organicChange} />
                </div>
                {organicReach && organicReach > 0 && (
                  <p className="text-xs text-green-600/70 mt-1">
                    Alcance: {formatNumber(organicReach)}
                  </p>
                )}
              </div>
              <Badge variant="outline" className="bg-green-100 dark:bg-green-900/50 border-green-300 text-green-700 dark:text-green-400">
                {organicPercentage.toFixed(0)}%
              </Badge>
            </div>
          </div>

          {/* Paid */}
          <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Megaphone className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-medium text-blue-700 dark:text-blue-400">
                    De anúncios
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                    {formatNumber(paidImpressions)}
                  </span>
                  <ChangeIndicator change={paidChange} />
                </div>
                {paidReach && paidReach > 0 && (
                  <p className="text-xs text-blue-600/70 mt-1">
                    Alcance: {formatNumber(paidReach)}
                  </p>
                )}
              </div>
              <Badge variant="outline" className="bg-blue-100 dark:bg-blue-900/50 border-blue-300 text-blue-700 dark:text-blue-400">
                {paidPercentage.toFixed(0)}%
              </Badge>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default ViewsBreakdown;
