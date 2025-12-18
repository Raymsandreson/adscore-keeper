import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { History, Pause, Play, DollarSign, Target, Copy, RefreshCw, Loader2, Filter, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format, subDays, isAfter } from 'date-fns';
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

type ActionFilter = 'all' | 'pause' | 'activate' | 'update_budget' | 'update_bid' | 'duplicate';
type EntityFilter = 'all' | 'campaign' | 'adset' | 'ad';
type PeriodFilter = 'all' | 'today' | '7days' | '30days';

const ActionHistory = () => {
  const [history, setHistory] = useState<ActionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all');
  const [entityFilter, setEntityFilter] = useState<EntityFilter>('all');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all');

  const fetchHistory = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('campaign_action_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Error fetching history:', error);
    } else {
      setHistory(data as ActionRecord[]);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchHistory();

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
          setHistory(prev => [payload.new as ActionRecord, ...prev].slice(0, 100));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filteredHistory = useMemo(() => {
    return history.filter(record => {
      // Filter by action
      if (actionFilter !== 'all' && record.action !== actionFilter) return false;
      
      // Filter by entity type
      if (entityFilter !== 'all' && record.entity_type !== entityFilter) return false;
      
      // Filter by period
      if (periodFilter !== 'all') {
        const recordDate = new Date(record.created_at);
        const now = new Date();
        
        switch (periodFilter) {
          case 'today':
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            if (!isAfter(recordDate, todayStart)) return false;
            break;
          case '7days':
            if (!isAfter(recordDate, subDays(now, 7))) return false;
            break;
          case '30days':
            if (!isAfter(recordDate, subDays(now, 30))) return false;
            break;
        }
      }
      
      return true;
    });
  }, [history, actionFilter, entityFilter, periodFilter]);

  const hasActiveFilters = actionFilter !== 'all' || entityFilter !== 'all' || periodFilter !== 'all';

  const clearFilters = () => {
    setActionFilter('all');
    setEntityFilter('all');
    setPeriodFilter('all');
  };

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
      <CardHeader className="flex flex-col gap-4 pb-3">
        <div className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <History className="h-5 w-5" />
            Histórico de Ações
            {filteredHistory.length !== history.length && (
              <Badge variant="secondary" className="ml-2">
                {filteredHistory.length} de {history.length}
              </Badge>
            )}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={fetchHistory} disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
        
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          
          <Select value={actionFilter} onValueChange={(v) => setActionFilter(v as ActionFilter)}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue placeholder="Ação" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas ações</SelectItem>
              <SelectItem value="pause">Pausar</SelectItem>
              <SelectItem value="activate">Ativar</SelectItem>
              <SelectItem value="update_budget">Orçamento</SelectItem>
              <SelectItem value="update_bid">Lance</SelectItem>
              <SelectItem value="duplicate">Duplicar</SelectItem>
            </SelectContent>
          </Select>

          <Select value={entityFilter} onValueChange={(v) => setEntityFilter(v as EntityFilter)}>
            <SelectTrigger className="w-[130px] h-8 text-xs">
              <SelectValue placeholder="Entidade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas entidades</SelectItem>
              <SelectItem value="campaign">Campanhas</SelectItem>
              <SelectItem value="adset">Conjuntos</SelectItem>
              <SelectItem value="ad">Criativos</SelectItem>
            </SelectContent>
          </Select>

          <Select value={periodFilter} onValueChange={(v) => setPeriodFilter(v as PeriodFilter)}>
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todo período</SelectItem>
              <SelectItem value="today">Hoje</SelectItem>
              <SelectItem value="7days">Últimos 7 dias</SelectItem>
              <SelectItem value="30days">Últimos 30 dias</SelectItem>
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 px-2 text-xs">
              <X className="h-3 w-3 mr-1" />
              Limpar
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && history.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredHistory.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>{hasActiveFilters ? 'Nenhuma ação encontrada com os filtros selecionados' : 'Nenhuma ação registrada ainda'}</p>
            <p className="text-sm">
              {hasActiveFilters ? 'Tente ajustar os filtros' : 'As ações realizadas nas campanhas aparecerão aqui'}
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-3">
              {filteredHistory.map((record) => (
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
