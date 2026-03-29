import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Phone, Search, RefreshCw, Clock, CheckCircle, XCircle, Pause,
  Play, Trash2, AlertTriangle, PhoneCall
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';

interface CallQueueItem {
  id: string;
  phone: string;
  instance_name: string;
  contact_name: string | null;
  lead_id: string | null;
  lead_name: string | null;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  last_attempt_at: string | null;
  last_result: string | null;
  scheduled_at: string;
  created_at: string;
  updated_at: string;
}

interface CallQueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}

export function CallQueuePanel() {
  const [items, setItems] = useState<CallQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchQueue = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('whatsapp_call_queue')
        .select('*')
        .order('priority', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(200);

      if (error) throw error;
      setItems((data || []) as CallQueueItem[]);
    } catch (err) {
      console.error('Error fetching call queue:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchQueue(); }, []);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('call-queue-monitor')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_call_queue' }, () => {
        fetchQueue();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const stats: CallQueueStats = useMemo(() => {
    const pending = items.filter(i => i.status === 'pending').length;
    const processing = items.filter(i => i.status === 'processing').length;
    const completed = items.filter(i => i.status === 'completed').length;
    const failed = items.filter(i => i.status === 'failed').length;
    return { pending, processing, completed, failed, total: items.length };
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter(i => {
      if (statusFilter !== 'all' && i.status !== statusFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return i.phone.includes(q) || i.contact_name?.toLowerCase().includes(q) || i.lead_name?.toLowerCase().includes(q);
      }
      return true;
    });
  }, [items, statusFilter, searchQuery]);

  const handleCancel = async (id: string) => {
    const { error } = await supabase.from('whatsapp_call_queue').update({ status: 'cancelled' }).eq('id', id);
    if (error) {
      toast.error('Erro ao cancelar');
    } else {
      toast.success('Chamada cancelada');
      fetchQueue();
    }
  };

  const handleRetry = async (id: string) => {
    const { error } = await supabase.from('whatsapp_call_queue').update({ status: 'pending', attempts: 0, last_result: null }).eq('id', id);
    if (error) {
      toast.error('Erro ao recolocar na fila');
    } else {
      toast.success('Recolocado na fila');
      fetchQueue();
    }
  };

  const handleClearCompleted = async () => {
    const { error } = await supabase.from('whatsapp_call_queue').delete().in('status', ['completed', 'cancelled']);
    if (error) {
      toast.error('Erro ao limpar');
    } else {
      toast.success('Fila limpa');
      fetchQueue();
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending': return <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 text-[9px] h-4"><Clock className="h-2.5 w-2.5 mr-0.5" />Pendente</Badge>;
      case 'processing': return <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 text-[9px] h-4"><PhoneCall className="h-2.5 w-2.5 mr-0.5" />Ligando</Badge>;
      case 'completed': return <Badge className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400 text-[9px] h-4"><CheckCircle className="h-2.5 w-2.5 mr-0.5" />Concluída</Badge>;
      case 'failed': return <Badge className="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 text-[9px] h-4"><XCircle className="h-2.5 w-2.5 mr-0.5" />Falhou</Badge>;
      case 'cancelled': return <Badge variant="outline" className="text-[9px] h-4"><Pause className="h-2.5 w-2.5 mr-0.5" />Cancelada</Badge>;
      default: return <Badge variant="outline" className="text-[9px] h-4">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-amber-500/20">
          <CardContent className="p-3 text-center">
            <Clock className="h-4 w-4 mx-auto text-amber-500 mb-1" />
            <p className="text-2xl font-bold text-amber-600">{stats.pending}</p>
            <p className="text-[10px] text-muted-foreground">Pendentes</p>
          </CardContent>
        </Card>
        <Card className="border-blue-500/20">
          <CardContent className="p-3 text-center">
            <PhoneCall className="h-4 w-4 mx-auto text-blue-500 mb-1" />
            <p className="text-2xl font-bold text-blue-600">{stats.processing}</p>
            <p className="text-[10px] text-muted-foreground">Em andamento</p>
          </CardContent>
        </Card>
        <Card className="border-green-500/20">
          <CardContent className="p-3 text-center">
            <CheckCircle className="h-4 w-4 mx-auto text-green-500 mb-1" />
            <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
            <p className="text-[10px] text-muted-foreground">Concluídas</p>
          </CardContent>
        </Card>
        <Card className="border-red-500/20">
          <CardContent className="p-3 text-center">
            <XCircle className="h-4 w-4 mx-auto text-red-500 mb-1" />
            <p className="text-2xl font-bold text-red-600">{stats.failed}</p>
            <p className="text-[10px] text-muted-foreground">Falharam</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar telefone, nome..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-8 h-9 text-xs"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[130px] h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pending">Pendentes</SelectItem>
            <SelectItem value="processing">Em andamento</SelectItem>
            <SelectItem value="completed">Concluídas</SelectItem>
            <SelectItem value="failed">Falharam</SelectItem>
            <SelectItem value="cancelled">Canceladas</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={fetchQueue} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
        {(stats.completed > 0) && (
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={handleClearCompleted}>
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Limpar concluídas
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">{filtered.length} itens na fila</p>

      {/* Queue Items */}
      <ScrollArea className="h-[calc(100vh-480px)]">
        <div className="space-y-2">
          {filtered.map(item => (
            <Card key={item.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm font-medium truncate">
                        {item.contact_name || item.lead_name || item.phone}
                      </span>
                      {getStatusBadge(item.status)}
                      {item.priority <= 3 && (
                        <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400 text-[9px] h-4">
                          <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />P{item.priority}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground flex-wrap">
                      <span>{item.phone}</span>
                      <span>📡 {item.instance_name}</span>
                      <span>Tentativas: {item.attempts}/{item.max_attempts}</span>
                      {item.last_result && <span>Resultado: {item.last_result}</span>}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      Criado {formatDistanceToNow(new Date(item.created_at), { addSuffix: true, locale: ptBR })}
                      {item.last_attempt_at && (
                        <> · Última tentativa {formatDistanceToNow(new Date(item.last_attempt_at), { addSuffix: true, locale: ptBR })}</>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {(item.status === 'failed' || item.status === 'cancelled') && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRetry(item.id)} title="Recolocar na fila">
                        <Play className="h-3.5 w-3.5 text-green-600" />
                      </Button>
                    )}
                    {(item.status === 'pending' || item.status === 'processing') && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleCancel(item.id)} title="Cancelar">
                        <XCircle className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && !loading && (
            <div className="text-center py-12 text-muted-foreground">
              <Phone className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Nenhuma chamada na fila</p>
              <p className="text-[10px]">As ligações de follow-up aparecerão aqui automaticamente</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
