import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RefreshCw, Search, ChevronDown, ChevronUp, AlertCircle, CheckCircle2, Phone, MessageSquare, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

interface WebhookLog {
  id: string;
  created_at: string;
  source: string;
  event_type: string | null;
  instance_name: string | null;
  phone: string | null;
  direction: string | null;
  status: string | null;
  payload: any;
  response: any;
  error_message: string | null;
  processing_ms: number | null;
}

export function WebhookLogsViewer() {
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [selectedLog, setSelectedLog] = useState<WebhookLog | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('webhook_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (filterType !== 'all') {
        query = query.eq('event_type', filterType);
      }
      if (filterStatus !== 'all') {
        query = query.eq('status', filterStatus);
      }

      const { data, error } = await query;
      if (error) throw error;
      setLogs((data as WebhookLog[]) || []);
    } catch (err) {
      console.error('Error fetching webhook logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [filterType, filterStatus]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, filterType, filterStatus]);

  const filteredLogs = logs.filter(log => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      log.event_type?.toLowerCase().includes(s) ||
      log.instance_name?.toLowerCase().includes(s) ||
      log.phone?.includes(s) ||
      log.error_message?.toLowerCase().includes(s) ||
      log.status?.toLowerCase().includes(s)
    );
  });

  const getStatusIcon = (status: string | null) => {
    if (status === 'error') return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
    if (status === 'received') return <MessageSquare className="h-3.5 w-3.5 text-amber-500" />;
    if (status?.includes('call')) return <Phone className="h-3.5 w-3.5 text-blue-500" />;
    if (status?.includes('skipped')) return <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />;
    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
  };

  const getStatusBadge = (status: string | null) => {
    if (status === 'error') return <Badge variant="destructive" className="text-[10px]">Erro</Badge>;
    if (status === 'received') return <Badge className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-200">Recebido</Badge>;
    if (status?.includes('call')) return <Badge className="text-[10px] bg-blue-500/10 text-blue-600 border-blue-200">Chamada</Badge>;
    if (status?.includes('message')) return <Badge variant="secondary" className="text-[10px]">Mensagem</Badge>;
    if (status?.includes('skipped')) return <Badge variant="outline" className="text-[10px]">Filtrado</Badge>;
    return <Badge variant="outline" className="text-[10px]">{status || 'N/A'}</Badge>;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Últimos webhooks recebidos (máx. 7 dias)
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={autoRefresh ? 'default' : 'outline'}
            onClick={() => setAutoRefresh(!autoRefresh)}
            className="text-xs gap-1.5"
          >
            {autoRefresh && <Loader2 className="h-3 w-3 animate-spin" />}
            {autoRefresh ? 'Auto ✓' : 'Auto-refresh'}
          </Button>
          <Button size="sm" variant="outline" onClick={fetchLogs} disabled={loading} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar por telefone, instância..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos tipos</SelectItem>
            <SelectItem value="messages">Mensagens</SelectItem>
            <SelectItem value="call">Chamadas</SelectItem>
            <SelectItem value="chats">Chats</SelectItem>
            <SelectItem value="groups">Grupos</SelectItem>
            <SelectItem value="error">Erros</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            <SelectItem value="message_processed">Processado</SelectItem>
            <SelectItem value="call_processed">Chamada</SelectItem>
            <SelectItem value="error">Erro</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          { label: 'Total', value: logs.length, color: 'text-foreground' },
          { label: 'Mensagens', value: logs.filter(l => l.status?.includes('message')).length, color: 'text-green-600' },
          { label: 'Chamadas', value: logs.filter(l => l.status?.includes('call')).length, color: 'text-blue-600' },
          { label: 'Erros', value: logs.filter(l => l.status === 'error').length, color: 'text-destructive' },
        ].map(stat => (
          <Card key={stat.label} className="p-2.5 text-center">
            <p className={`text-lg font-bold ${stat.color}`}>{stat.value}</p>
            <p className="text-[10px] text-muted-foreground">{stat.label}</p>
          </Card>
        ))}
      </div>

      {/* Logs list */}
      <ScrollArea className="h-[400px] border rounded-lg">
        {loading && logs.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
            <MessageSquare className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-sm">Nenhum log encontrado</p>
            <p className="text-xs">Faça uma ligação ou envie uma mensagem para ver os logs aqui</p>
          </div>
        ) : (
          <div className="divide-y">
            {filteredLogs.map(log => (
              <button
                key={log.id}
                onClick={() => setSelectedLog(log)}
                className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors flex items-center gap-3"
              >
                {getStatusIcon(log.status)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono font-medium">
                      {log.event_type || 'unknown'}
                    </span>
                    {getStatusBadge(log.status)}
                    {log.instance_name && (
                      <Badge variant="outline" className="text-[9px]">
                        📱 {log.instance_name}
                      </Badge>
                    )}
                    {log.processing_ms != null && (
                      <span className="text-[9px] text-muted-foreground">
                        {log.processing_ms}ms
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {log.phone && (
                      <span className="text-[10px] text-muted-foreground font-mono">{log.phone}</span>
                    )}
                    {log.error_message && (
                      <span className="text-[10px] text-destructive truncate">{log.error_message}</span>
                    )}
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                  {format(new Date(log.created_at), 'HH:mm:ss')}
                </span>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Detail dialog */}
      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedLog && getStatusIcon(selectedLog.status)}
              Log: {selectedLog?.event_type || 'unknown'}
              {selectedLog && getStatusBadge(selectedLog.status)}
            </DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-4">
                {/* Meta */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><strong>Data:</strong> {format(new Date(selectedLog.created_at), 'dd/MM/yyyy HH:mm:ss')}</div>
                  <div><strong>Instância:</strong> {selectedLog.instance_name || '-'}</div>
                  <div><strong>Telefone:</strong> {selectedLog.phone || '-'}</div>
                  <div><strong>Direção:</strong> {selectedLog.direction || '-'}</div>
                  <div><strong>Tempo:</strong> {selectedLog.processing_ms ?? '-'}ms</div>
                  <div><strong>Status:</strong> {selectedLog.status || '-'}</div>
                </div>

                {selectedLog.error_message && (
                  <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                    <p className="text-xs font-semibold text-destructive mb-1">Erro</p>
                    <p className="text-xs text-destructive">{selectedLog.error_message}</p>
                  </div>
                )}

                <div>
                  <p className="text-xs font-semibold mb-1">Payload Recebido (JSON)</p>
                  <pre className="text-[10px] bg-muted p-3 rounded-lg overflow-x-auto max-h-[300px] whitespace-pre-wrap break-all font-mono">
                    {JSON.stringify(selectedLog.payload, null, 2)}
                  </pre>
                </div>

                {selectedLog.response && (
                  <div>
                    <p className="text-xs font-semibold mb-1">Resposta</p>
                    <pre className="text-[10px] bg-muted p-3 rounded-lg overflow-x-auto max-h-[200px] whitespace-pre-wrap break-all font-mono">
                      {JSON.stringify(selectedLog.response, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
