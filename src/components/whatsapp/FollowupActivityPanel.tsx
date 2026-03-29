import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  RefreshCw, Clock, CheckCircle, XCircle, MessageCircle,
  Phone as PhoneIcon, ClipboardList, Zap, Calendar
} from 'lucide-react';
import { formatDistanceToNow, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface FollowupLogEntry {
  id: string;
  session_id: string | null;
  step_index: number | null;
  action_type: string;
  action_result: string | null;
  executed_at: string | null;
  // joined from session
  session_phone?: string;
  session_instance?: string;
  session_template?: string;
  session_shortcut?: string;
  session_status?: string;
  session_lead_id?: string;
}

interface FollowupStats {
  total: number;
  messages: number;
  calls: number;
  activities: number;
  executed: number;
  errors: number;
}

export function FollowupActivityPanel() {
  const [logs, setLogs] = useState<FollowupLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodDays, setPeriodDays] = useState(7);
  const [actionFilter, setActionFilter] = useState('all');

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const startDate = subDays(new Date(), periodDays).toISOString();

      // Fetch followup logs with session data
      const { data: logData } = await supabase
        .from('wjia_followup_log')
        .select('id, session_id, step_index, action_type, action_result, executed_at')
        .gte('executed_at', startDate)
        .order('executed_at', { ascending: false })
        .limit(300);

      if (!logData?.length) {
        setLogs([]);
        setLoading(false);
        return;
      }

      // Get unique session IDs
      const sessionIds = [...new Set(logData.map(l => l.session_id).filter(Boolean))] as string[];

      // Fetch session details
      const { data: sessions } = sessionIds.length > 0
        ? await supabase
            .from('wjia_collection_sessions')
            .select('id, phone, instance_name, template_name, shortcut_name, status, lead_id')
            .in('id', sessionIds)
        : { data: [] };

      const sessionMap = new Map((sessions || []).map((s: any) => [s.id, s]));

      const enriched: FollowupLogEntry[] = logData.map((l: any) => {
        const session = l.session_id ? sessionMap.get(l.session_id) : null;
        return {
          ...l,
          session_phone: session?.phone || null,
          session_instance: session?.instance_name || null,
          session_template: session?.template_name || null,
          session_shortcut: session?.shortcut_name || null,
          session_status: session?.status || null,
          session_lead_id: session?.lead_id || null,
        };
      });

      setLogs(enriched);
    } catch (err) {
      console.error('Error fetching followup logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, [periodDays]);

  const stats: FollowupStats = useMemo(() => {
    const messages = logs.filter(l => l.action_type === 'whatsapp_message').length;
    const calls = logs.filter(l => l.action_type === 'call').length;
    const activities = logs.filter(l => l.action_type === 'create_activity').length;
    const executed = logs.filter(l => l.action_result === 'executed').length;
    const errors = logs.filter(l => l.action_result === 'error').length;
    return { total: logs.length, messages, calls, activities, executed, errors };
  }, [logs]);

  const filtered = useMemo(() => {
    if (actionFilter === 'all') return logs;
    return logs.filter(l => l.action_type === actionFilter);
  }, [logs, actionFilter]);

  const getActionIcon = (type: string) => {
    switch (type) {
      case 'whatsapp_message': return <MessageCircle className="h-3.5 w-3.5 text-green-500" />;
      case 'call': return <PhoneIcon className="h-3.5 w-3.5 text-blue-500" />;
      case 'create_activity': return <ClipboardList className="h-3.5 w-3.5 text-purple-500" />;
      default: return <Zap className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  const getActionLabel = (type: string) => {
    switch (type) {
      case 'whatsapp_message': return 'Mensagem';
      case 'call': return 'Ligação (toque)';
      case 'create_activity': return 'Atividade criada';
      default: return type;
    }
  };

  const getResultBadge = (result: string | null) => {
    if (result === 'executed') return <Badge className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400 text-[9px] h-4"><CheckCircle className="h-2.5 w-2.5 mr-0.5" />Sucesso</Badge>;
    if (result === 'error') return <Badge className="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 text-[9px] h-4"><XCircle className="h-2.5 w-2.5 mr-0.5" />Erro</Badge>;
    return <Badge variant="outline" className="text-[9px] h-4">{result || 'N/A'}</Badge>;
  };

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <Zap className="h-4 w-4 mx-auto text-primary mb-1" />
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-[10px] text-muted-foreground">Total ações</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <MessageCircle className="h-4 w-4 mx-auto text-green-500 mb-1" />
            <p className="text-2xl font-bold text-green-600">{stats.messages}</p>
            <p className="text-[10px] text-muted-foreground">Mensagens</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <PhoneIcon className="h-4 w-4 mx-auto text-blue-500 mb-1" />
            <p className="text-2xl font-bold text-blue-600">{stats.calls}</p>
            <p className="text-[10px] text-muted-foreground">Toques</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <ClipboardList className="h-4 w-4 mx-auto text-purple-500 mb-1" />
            <p className="text-2xl font-bold text-purple-600">{stats.activities}</p>
            <p className="text-[10px] text-muted-foreground">Atividades</p>
          </CardContent>
        </Card>
        <Card className="border-green-500/20">
          <CardContent className="p-3 text-center">
            <CheckCircle className="h-4 w-4 mx-auto text-green-500 mb-1" />
            <p className="text-2xl font-bold text-green-600">{stats.executed}</p>
            <p className="text-[10px] text-muted-foreground">Sucesso</p>
          </CardContent>
        </Card>
        <Card className="border-red-500/20">
          <CardContent className="p-3 text-center">
            <XCircle className="h-4 w-4 mx-auto text-red-500 mb-1" />
            <p className="text-2xl font-bold text-red-600">{stats.errors}</p>
            <p className="text-[10px] text-muted-foreground">Erros</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={String(periodDays)} onValueChange={v => setPeriodDays(Number(v))}>
          <SelectTrigger className="w-[130px] h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Últimas 24h</SelectItem>
            <SelectItem value="7">Últimos 7 dias</SelectItem>
            <SelectItem value="15">Últimos 15 dias</SelectItem>
            <SelectItem value="30">Últimos 30 dias</SelectItem>
          </SelectContent>
        </Select>
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-[150px] h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas ações</SelectItem>
            <SelectItem value="whatsapp_message">Mensagens</SelectItem>
            <SelectItem value="call">Ligações</SelectItem>
            <SelectItem value="create_activity">Atividades</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">{filtered.length} ações de follow-up</p>

      {/* Log List */}
      <ScrollArea className="h-[calc(100vh-480px)]">
        <div className="space-y-2">
          {filtered.map(log => (
            <Card key={log.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {getActionIcon(log.action_type)}
                      <span className="text-sm font-medium">{getActionLabel(log.action_type)}</span>
                      {getResultBadge(log.action_result)}
                      {log.step_index != null && (
                        <Badge variant="outline" className="text-[9px] h-4">Etapa {log.step_index + 1}</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground flex-wrap">
                      {log.session_phone && <span>📱 {log.session_phone}</span>}
                      {log.session_instance && <span>📡 {log.session_instance}</span>}
                      {log.session_template && <span>📄 {log.session_template}</span>}
                      {log.session_shortcut && (
                        <Badge variant="secondary" className="text-[9px] h-4">#{log.session_shortcut}</Badge>
                      )}
                    </div>
                    {log.session_status && (
                      <div className="mt-0.5 text-[10px]">
                        <Badge variant={log.session_status === 'followup_done' ? 'default' : 'outline'} className="text-[9px] h-4">
                          {log.session_status === 'generated' ? '⏳ Aguardando assinatura' :
                           log.session_status === 'followup_done' ? '✅ Follow-up concluído' :
                           log.session_status === 'signed' ? '✍️ Assinado' :
                           log.session_status}
                        </Badge>
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    {log.executed_at && (
                      <p className="text-[10px] text-muted-foreground flex items-center gap-0.5 justify-end">
                        <Calendar className="h-3 w-3" />
                        {formatDistanceToNow(new Date(log.executed_at), { addSuffix: true, locale: ptBR })}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && !loading && (
            <div className="text-center py-12 text-muted-foreground">
              <Zap className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Nenhuma ação de follow-up no período</p>
              <p className="text-[10px]">As ações automáticas (mensagens, toques, atividades) aparecerão aqui</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
