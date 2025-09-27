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
  const getStatusBgColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'bg-success/10';
      case 'warning':
        return 'bg-warning/10';
      case 'danger':
        return 'bg-danger/10';
      default:
        return 'bg-muted/10';
    }
  };

  const getStatusTextColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'text-success';
      case 'warning':
        return 'text-warning';
      case 'danger':
        return 'text-danger';
      default:
        return 'text-muted-foreground';
    }
  };

  const getStatusClasses = (status: string) => {
    switch (status) {
      case 'success':
        return 'status-success';
      case 'warning':
        return 'status-warning';
      case 'danger':
        return 'status-danger';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <Card className="bg-gradient-card border-border shadow-card-custom metric-card relative">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={cn(
              "p-2 rounded-lg transition-colors",
              getStatusBgColor(status)
            )}>
              <Icon className={cn("h-5 w-5", getStatusTextColor(status))} />
            </div>
            <span className="text-sm font-medium text-foreground">{title}</span>
          </div>
          {isConnected && (
            <Badge className={getStatusClasses(status)}>
              {status === 'success' && '✓'}
              {status === 'warning' && '⚠'}
              {status === 'danger' && '✗'}
            </Badge>
          )}
        </div>
        
        <div className="space-y-3">
          <div className="text-3xl font-bold text-foreground">
            {isConnected ? value : '—'}
          </div>
          <div className="text-sm text-muted-foreground border-t border-border pt-3">
            {isConnected ? benchmark : "Conecte ao Meta BM para ver dados reais"}
          </div>
        </div>
        
        {/* Status indicator */}
        <div className={cn(
          "absolute top-4 right-4 w-2 h-2 rounded-full",
          isConnected ? "bg-success" : "bg-muted-foreground/30"
        )}></div>
      </CardContent>
    </Card>
  );
};

export default MetricCard;