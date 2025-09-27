import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  title: string;
  value: string;
  icon: LucideIcon;
  status: 'success' | 'warning' | 'danger';
  benchmark: string;
  isConnected: boolean;
}

const MetricCard = ({ title, value, icon: Icon, status, benchmark, isConnected }: MetricCardProps) => {
  const getStatusStyles = (status: string) => {
    switch (status) {
      case 'success':
        return 'border-success/30 hover:border-success/50 bg-gradient-to-br from-success/5 to-success/10';
      case 'warning':
        return 'border-warning/30 hover:border-warning/50 bg-gradient-to-br from-warning/5 to-warning/10';
      case 'danger':
        return 'border-danger/30 hover:border-danger/50 bg-gradient-to-br from-danger/5 to-danger/10';
      default:
        return 'border-border bg-gradient-card';
    }
  };

  const getIconStyles = (status: string) => {
    switch (status) {
      case 'success':
        return 'text-success bg-success/10 border-success/20';
      case 'warning':
        return 'text-warning bg-warning/10 border-warning/20';
      case 'danger':
        return 'text-danger bg-danger/10 border-danger/20';
      default:
        return 'text-muted-foreground bg-muted/10 border-muted/20';
    }
  };

  return (
    <Card className={cn(
      "metric-card group relative overflow-hidden transition-all duration-500 shadow-card-custom",
      isConnected ? getStatusStyles(status) : "border-border bg-gradient-card opacity-60",
      "hover:shadow-glow hover:-translate-y-2"
    )}>
      {/* Efeito de gradiente animado no hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-transparent via-primary/5 to-accent-bright/10 opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
      
      {/* Indicador de status */}
      <div className={cn(
        "absolute top-0 left-0 w-full h-1 transition-all duration-500",
        isConnected && status === 'success' && "bg-gradient-success animate-shimmer",
        isConnected && status === 'warning' && "bg-gradient-warning animate-shimmer",
        isConnected && status === 'danger' && "bg-gradient-danger animate-shimmer",
        !isConnected && "bg-muted/20"
      )}></div>

      <CardContent className="p-6 relative z-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={cn(
              "p-3 rounded-xl border transition-all duration-300 group-hover:scale-110",
              getIconStyles(status)
            )}>
              <Icon className="h-5 w-5" />
            </div>
            <h3 className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors duration-300">
              {title}
            </h3>
          </div>
          
          {isConnected && (
            <Badge className={cn(
              "text-xs px-3 py-1 transition-all duration-300 shadow-sm",
              status === 'success' && "bg-gradient-success text-success-foreground border-success/20",
              status === 'warning' && "bg-gradient-warning text-warning-foreground border-warning/20", 
              status === 'danger' && "bg-gradient-danger text-danger-foreground border-danger/20"
            )}>
              {status === 'success' && '🚀 Ótimo'}
              {status === 'warning' && '⚡ Médio'}
              {status === 'danger' && '🔥 Atenção'}
            </Badge>
          )}
        </div>
        
        <div className="space-y-3">
          <div className={cn(
            "text-3xl font-bold transition-all duration-500",
            isConnected ? "group-hover:scale-105 group-hover:text-primary" : "text-transparent bg-gradient-to-r from-muted via-muted-foreground to-muted bg-clip-text animate-shimmer"
          )}>
            {isConnected ? value : '━━━━'}
          </div>
          
          <div className="text-xs leading-relaxed">
            {isConnected ? (
              <span className="text-muted-foreground">{benchmark}</span>
            ) : (
              <span className="flex items-center gap-2 text-warning">
                <div className="w-1.5 h-1.5 bg-warning rounded-full animate-pulse"></div>
                Conecte para ver dados reais
              </span>
            )}
          </div>
        </div>

        {/* Indicador de conexão animado */}
        <div className={cn(
          "absolute top-6 right-6 w-2 h-2 rounded-full transition-all duration-300",
          isConnected ? "bg-success animate-pulse-glow shadow-[0_0_10px_hsl(var(--success))]" : "bg-muted-foreground/30"
        )}></div>
      </CardContent>
    </Card>
  );
};

export default MetricCard;