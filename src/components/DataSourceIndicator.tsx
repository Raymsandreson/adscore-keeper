import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle2, AlertCircle, Database, Wifi, WifiOff } from "lucide-react";

interface DataSourceIndicatorProps {
  isRealData: boolean;
  source?: string;
  lastUpdated?: Date;
  compact?: boolean;
}

const DataSourceIndicator = ({ 
  isRealData, 
  source = "Meta API", 
  lastUpdated,
  compact = false 
}: DataSourceIndicatorProps) => {
  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge 
              variant="outline" 
              className={`gap-1 cursor-help ${
                isRealData 
                  ? 'border-success/50 bg-success/10 text-success hover:bg-success/20' 
                  : 'border-warning/50 bg-warning/10 text-warning hover:bg-warning/20'
              }`}
            >
              {isRealData ? (
                <Wifi className="h-3 w-3" />
              ) : (
                <WifiOff className="h-3 w-3" />
              )}
              <span className="text-xs">
                {isRealData ? 'Dados reais' : 'Demo'}
              </span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <div className="space-y-1">
              <p className="font-semibold">
                {isRealData ? '✅ Dados Reais' : '⚠️ Dados de Demonstração'}
              </p>
              <p className="text-sm text-muted-foreground">
                {isRealData 
                  ? `Conectado à ${source}. Dados atualizados em tempo real.`
                  : 'Valores fictícios para visualização. Conecte sua conta para ver dados reais.'
                }
              </p>
              {lastUpdated && isRealData && (
                <p className="text-xs text-muted-foreground">
                  Última atualização: {lastUpdated.toLocaleTimeString('pt-BR')}
                </p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
      isRealData 
        ? 'border-success/30 bg-success/5' 
        : 'border-warning/30 bg-warning/5'
    }`}>
      {isRealData ? (
        <CheckCircle2 className="h-4 w-4 text-success" />
      ) : (
        <AlertCircle className="h-4 w-4 text-warning" />
      )}
      <div className="flex flex-col">
        <span className={`text-sm font-medium ${isRealData ? 'text-success' : 'text-warning'}`}>
          {isRealData ? 'Dados Reais' : 'Dados de Demonstração'}
        </span>
        <span className="text-xs text-muted-foreground">
          {isRealData 
            ? `Fonte: ${source}` 
            : 'Conecte sua conta para dados reais'
          }
        </span>
      </div>
      {lastUpdated && isRealData && (
        <span className="text-xs text-muted-foreground ml-auto">
          Atualizado às {lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
    </div>
  );
};

export default DataSourceIndicator;
