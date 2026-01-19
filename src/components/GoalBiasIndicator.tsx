import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Target, 
  TrendingUp, 
  TrendingDown, 
  Minus,
  Flame,
  AlertTriangle,
  CheckCircle,
  Clock,
  Zap
} from "lucide-react";
import { GoalBias } from "@/hooks/useUnifiedMetaConnection";
import { cn } from "@/lib/utils";

interface GoalBiasIndicatorProps {
  biases: GoalBias[];
  compact?: boolean;
  maxItems?: number;
}

const TYPE_LABELS: Record<string, string> = {
  leads: 'Leads',
  conversions: 'Conversões',
  revenue: 'Receita',
  followers: 'Seguidores',
  engagement: 'Engajamento',
  cpc: 'CPC',
  ctr: 'CTR'
};

const TYPE_ICONS: Record<string, typeof Target> = {
  leads: Target,
  conversions: CheckCircle,
  revenue: Zap,
  followers: TrendingUp,
  engagement: Flame,
  cpc: TrendingDown,
  ctr: TrendingUp
};

const URGENCY_COLORS = {
  critical: 'border-red-500 bg-red-500/10',
  high: 'border-orange-500 bg-orange-500/10',
  medium: 'border-yellow-500 bg-yellow-500/10',
  low: 'border-green-500 bg-green-500/10'
};

const URGENCY_BADGES = {
  critical: { label: 'Crítico', className: 'bg-red-500 text-white' },
  high: { label: 'Urgente', className: 'bg-orange-500 text-white' },
  medium: { label: 'Atenção', className: 'bg-yellow-500 text-white' },
  low: { label: 'No caminho', className: 'bg-green-500 text-white' }
};

export const GoalBiasIndicator = ({ biases, compact = false, maxItems = 3 }: GoalBiasIndicatorProps) => {
  if (!biases || biases.length === 0) return null;

  const displayBiases = biases
    .sort((a, b) => {
      const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    })
    .slice(0, maxItems);

  const getTrendIcon = (trend: 'up' | 'down' | 'stable') => {
    switch (trend) {
      case 'up':
        return <TrendingUp className="h-3 w-3 text-green-500" />;
      case 'down':
        return <TrendingDown className="h-3 w-3 text-red-500" />;
      default:
        return <Minus className="h-3 w-3 text-muted-foreground" />;
    }
  };

  if (compact) {
    return (
      <TooltipProvider>
        <div className="flex gap-1.5 flex-wrap">
          {displayBiases.map((bias, index) => {
            const Icon = TYPE_ICONS[bias.type] || Target;
            return (
              <Tooltip key={index}>
                <TooltipTrigger asChild>
                  <Badge 
                    variant="outline" 
                    className={cn(
                      "gap-1 cursor-help text-xs",
                      URGENCY_COLORS[bias.urgency]
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    <span>{Math.round(bias.progress)}%</span>
                    {getTrendIcon(bias.trend)}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <div className="space-y-1">
                    <p className="font-medium">{TYPE_LABELS[bias.type]}</p>
                    <p className="text-sm text-muted-foreground">{bias.message}</p>
                    <div className="flex items-center gap-2 text-xs">
                      <Clock className="h-3 w-3" />
                      <span>{bias.daysLeft} dias restantes</span>
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <Flame className="h-4 w-4 text-orange-500" />
        <span className="text-sm font-medium">Vieses de Atingimento</span>
      </div>
      
      {displayBiases.map((bias, index) => {
        const Icon = TYPE_ICONS[bias.type] || Target;
        return (
          <Card 
            key={index} 
            className={cn(
              "border-l-4 transition-all hover:shadow-md",
              URGENCY_COLORS[bias.urgency]
            )}
          >
            <CardContent className="p-3">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  <span className="font-medium text-sm">{TYPE_LABELS[bias.type]}</span>
                </div>
                <Badge className={cn("text-xs", URGENCY_BADGES[bias.urgency].className)}>
                  {URGENCY_BADGES[bias.urgency].label}
                </Badge>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{(bias.currentValue ?? 0).toLocaleString('pt-BR')} / {(bias.targetValue ?? 0).toLocaleString('pt-BR')}</span>
                  <span className="flex items-center gap-1">
                    {getTrendIcon(bias.trend)}
                    {Math.round(bias.progress)}%
                  </span>
                </div>
                
                <Progress 
                  value={bias.progress} 
                  className="h-1.5"
                />
                
                <p className="text-xs text-muted-foreground mt-1">
                  {bias.message}
                </p>
                
                {bias.daysLeft <= 7 && (
                  <div className="flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400">
                    <AlertTriangle className="h-3 w-3" />
                    <span>{bias.daysLeft} dia{bias.daysLeft !== 1 ? 's' : ''} restante{bias.daysLeft !== 1 ? 's' : ''}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

export default GoalBiasIndicator;
