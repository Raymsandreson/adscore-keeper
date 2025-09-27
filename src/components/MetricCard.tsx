import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
        return 'border-success/50 bg-gradient-success text-success-foreground shadow-[0_0_20px_-10px_hsl(var(--success))]';
      case 'warning':
        return 'border-warning/50 bg-gradient-warning text-warning-foreground shadow-[0_0_20px_-10px_hsl(var(--warning))]';
      case 'danger':
        return 'border-danger/50 bg-gradient-danger text-danger-foreground shadow-[0_0_20px_-10px_hsl(var(--danger))]';
      default:
        return 'border-border bg-gradient-card text-card-foreground';
    }
  };

  return (
    <Card 
      className={cn(
        "transition-all duration-300 hover:scale-105 shadow-card-custom border",
        isConnected ? getStatusStyles(status) : "border-border bg-gradient-card text-card-foreground",
        !isConnected && "opacity-60"
      )}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium opacity-90">
          {title}
        </CardTitle>
        <Icon className={cn(
          "h-5 w-5",
          isConnected && status === 'success' && "animate-pulse"
        )} />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold mb-2">
          {isConnected ? value : "--"}
        </div>
        <p className="text-xs opacity-75 leading-relaxed">
          {benchmark}
        </p>
        {!isConnected && (
          <p className="text-xs mt-2 opacity-60 italic">
            Conecte ao BM para dados em tempo real
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default MetricCard;