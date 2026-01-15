import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Link2, 
  Link2Off, 
  CheckCircle2, 
  XCircle, 
  RefreshCw,
  Megaphone,
  Instagram,
  Clock,
  Zap
} from "lucide-react";
import { MetaConnectionStatus } from "@/hooks/useUnifiedMetaConnection";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface UnifiedMetaStatusProps {
  status: MetaConnectionStatus;
  onRefresh?: () => void;
  onConnect?: () => void;
  isLoading?: boolean;
  compact?: boolean;
}

export const UnifiedMetaStatus = ({ 
  status, 
  onRefresh, 
  onConnect, 
  isLoading = false,
  compact = false 
}: UnifiedMetaStatusProps) => {
  const isFullyConnected = status.paid && status.organic;
  const isPartiallyConnected = status.paid || status.organic;

  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5">
              {isFullyConnected ? (
                <Badge variant="outline" className="gap-1 bg-green-500/10 border-green-500 text-green-700 dark:text-green-400">
                  <Zap className="h-3 w-3" />
                  <span className="hidden sm:inline">Unificado</span>
                </Badge>
              ) : isPartiallyConnected ? (
                <Badge variant="outline" className="gap-1 bg-yellow-500/10 border-yellow-500 text-yellow-700 dark:text-yellow-400">
                  <Link2 className="h-3 w-3" />
                  <span className="hidden sm:inline">Parcial</span>
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 bg-muted text-muted-foreground">
                  <Link2Off className="h-3 w-3" />
                  <span className="hidden sm:inline">Desconectado</span>
                </Badge>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <div className="space-y-2">
              <p className="font-medium">Status da Conexão Meta</p>
              <div className="flex items-center gap-2 text-sm">
                <Megaphone className="h-3 w-3" />
                <span>Tráfego Pago:</span>
                {status.paid ? (
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                ) : (
                  <XCircle className="h-3 w-3 text-red-500" />
                )}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Instagram className="h-3 w-3" />
                <span>Orgânico:</span>
                {status.organic ? (
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                ) : (
                  <XCircle className="h-3 w-3 text-red-500" />
                )}
              </div>
              {status.lastSync && (
                <p className="text-xs text-muted-foreground">
                  Última sincronização: {format(status.lastSync, "HH:mm", { locale: ptBR })}
                </p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Card className={cn(
      "border-l-4",
      isFullyConnected ? "border-l-green-500" : isPartiallyConnected ? "border-l-yellow-500" : "border-l-muted"
    )}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          {isFullyConnected ? (
            <Zap className="h-4 w-4 text-green-500" />
          ) : (
            <Link2 className="h-4 w-4" />
          )}
          Conexão Meta Unificada
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className={cn(
            "flex items-center gap-2 p-2 rounded-lg",
            status.paid ? "bg-green-500/10" : "bg-muted"
          )}>
            <Megaphone className="h-4 w-4" />
            <span className="text-sm">Tráfego Pago</span>
            {status.paid ? (
              <CheckCircle2 className="h-4 w-4 text-green-500 ml-auto" />
            ) : (
              <XCircle className="h-4 w-4 text-muted-foreground ml-auto" />
            )}
          </div>
          
          <div className={cn(
            "flex items-center gap-2 p-2 rounded-lg",
            status.organic ? "bg-green-500/10" : "bg-muted"
          )}>
            <Instagram className="h-4 w-4" />
            <span className="text-sm">Orgânico</span>
            {status.organic ? (
              <CheckCircle2 className="h-4 w-4 text-green-500 ml-auto" />
            ) : (
              <XCircle className="h-4 w-4 text-muted-foreground ml-auto" />
            )}
          </div>
        </div>

        {status.lastSync && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>Última sync: {format(status.lastSync, "dd/MM HH:mm", { locale: ptBR })}</span>
          </div>
        )}

        <div className="flex gap-2">
          {onRefresh && isPartiallyConnected && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={onRefresh}
              disabled={isLoading}
              className="flex-1"
            >
              <RefreshCw className={cn("h-3 w-3 mr-1", isLoading && "animate-spin")} />
              Sincronizar
            </Button>
          )}
          {onConnect && !isFullyConnected && (
            <Button 
              size="sm" 
              onClick={onConnect}
              className="flex-1"
            >
              {isPartiallyConnected ? 'Completar Conexão' : 'Conectar'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default UnifiedMetaStatus;
