import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { History, Pause, Play, DollarSign, Target, Copy, RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface ActionRecord {
  id: string;
  entity_id: string;
  entity_type: 'campaign' | 'adset' | 'ad';
  entity_name: string | null;
  action: 'pause' | 'activate' | 'update_budget' | 'update_bid' | 'duplicate';
  old_value: string | null;
  new_value: string | null;
  ad_account_id: string | null;
  created_at: string;
}

const ActionHistory = () => {
  const [history, setHistory] = useState<ActionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchHistory = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('campaign_action_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Error fetching history:', error);
    } else {
      setHistory(data as ActionRecord[]);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchHistory();

    // Subscribe to realtime updates
    const channel = supabase
      .channel('action-history-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'campaign_action_history'
        },
        (payload) => {
          setHistory(prev => [payload.new as ActionRecord, ...prev].slice(0, 50));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'pause':
        return <Pause className="h-4 w-4 text-amber-500" />;
      case 'activate':
        return <Play className="h-4 w-4 text-green-500" />;
      case 'update_budget':
        return <DollarSign className="h-4 w-4 text-blue-500" />;
      case 'update_bid':
        return <Target className="h-4 w-4 text-purple-500" />;
      case 'duplicate':
        return <Copy className="h-4 w-4 text-cyan-500" />;
      default:
        return <History className="h-4 w-4" />;
    }
  };

  const getActionLabel = (action: string) => {
    switch (action) {
      case 'pause':
        return 'Pausado';
      case 'activate':
        return 'Ativado';
      case 'update_budget':
        return 'Orçamento alterado';
      case 'update_bid':
        return 'Lance alterado';
      case 'duplicate':
        return 'Duplicado';
      default:
        return action;
    }
  };

  const getEntityTypeLabel = (entityType: string) => {
    switch (entityType) {
      case 'campaign':
        return 'Campanha';
      case 'adset':
        return 'Conjunto';
      case 'ad':
        return 'Criativo';
      default:
        return entityType;
    }
  };

  const getActionBadgeVariant = (action: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (action) {
      case 'pause':
        return 'secondary';
      case 'activate':
        return 'default';
      case 'duplicate':
        return 'outline';
      default:
        return 'default';
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <History className="h-5 w-5" />
          Histórico de Ações
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={fetchHistory} disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading && history.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>Nenhuma ação registrada ainda</p>
            <p className="text-sm">As ações realizadas nas campanhas aparecerão aqui</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-3">
              {history.map((record) => (
                <div
                  key={record.id}
                  className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                >
                  <div className="mt-0.5">
                    {getActionIcon(record.action)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={getActionBadgeVariant(record.action)} className="text-xs">
                        {getActionLabel(record.action)}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {getEntityTypeLabel(record.entity_type)}
                      </Badge>
                    </div>
                    <p className="font-medium mt-1 truncate" title={record.entity_name || record.entity_id}>
                      {record.entity_name || record.entity_id}
                    </p>
                    {record.old_value && record.new_value && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {record.old_value} → {record.new_value}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {format(new Date(record.created_at), "dd 'de' MMMM 'às' HH:mm", { locale: ptBR })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
};

export default ActionHistory;
