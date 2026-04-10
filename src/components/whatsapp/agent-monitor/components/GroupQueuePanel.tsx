import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Play, RefreshCw, Trash2, Clock, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface QueueItem {
  id: string;
  lead_id: string | null;
  lead_name: string;
  phone: string | null;
  contact_phone: string | null;
  board_id: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  processed_at: string | null;
}

export function GroupQueuePanel() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('group_creation_queue')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    setItems((data as QueueItem[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  const processQueue = async () => {
    setProcessing(true);
    try {
      const { data, error } = await cloudFunctions.invoke('process-group-queue');
      if (error) throw error;
      toast.success(`Processados: ${data?.processed || 0} itens`);
      fetchQueue();
    } catch (e: any) {
      toast.error('Erro: ' + (e.message || ''));
    } finally {
      setProcessing(false);
    }
  };

  const removeItem = async (id: string) => {
    await supabase.from('group_creation_queue').delete().eq('id', id);
    setItems(prev => prev.filter(i => i.id !== id));
    toast.success('Item removido da fila');
  };

  const retryItem = async (id: string) => {
    await supabase
      .from('group_creation_queue')
      .update({ status: 'pending', attempts: 0, last_error: null } as any)
      .eq('id', id);
    toast.success('Item reenfileirado');
    fetchQueue();
  };

  const pendingCount = items.filter(i => i.status === 'pending').length;
  const failedCount = items.filter(i => i.status === 'failed').length;

  const statusIcon = (status: string) => {
    switch (status) {
      case 'pending': return <Clock className="h-3.5 w-3.5 text-yellow-500" />;
      case 'processing': return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />;
      case 'completed': return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
      case 'failed': return <XCircle className="h-3.5 w-3.5 text-red-500" />;
      default: return <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  const statusLabel: Record<string, string> = {
    pending: 'Pendente',
    processing: 'Processando',
    completed: 'Concluído',
    failed: 'Falhou',
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="text-center py-6 text-sm text-muted-foreground">
          Nenhum grupo na fila de criação
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            📋 Fila de Criação de Grupos
            {pendingCount > 0 && <Badge variant="secondary" className="text-xs">{pendingCount} pendentes</Badge>}
            {failedCount > 0 && <Badge variant="destructive" className="text-xs">{failedCount} falhas</Badge>}
          </CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={fetchQueue} disabled={loading}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            {pendingCount > 0 && (
              <Button size="sm" onClick={processQueue} disabled={processing}>
                {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                Processar fila
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map(item => (
          <div key={item.id} className="flex items-center justify-between p-2 rounded-md border text-xs">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {statusIcon(item.status)}
              <div className="min-w-0">
                <p className="font-medium truncate">{item.lead_name}</p>
                <p className="text-muted-foreground">
                  {formatDistanceToNow(new Date(item.created_at), { addSuffix: true, locale: ptBR })}
                  {item.attempts > 0 && ` · ${item.attempts} tentativas`}
                </p>
                {item.last_error && item.status === 'failed' && (
                  <p className="text-red-500 truncate mt-0.5">{item.last_error}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Badge variant={item.status === 'failed' ? 'destructive' : 'secondary'} className="text-[10px]">
                {statusLabel[item.status] || item.status}
              </Badge>
              {item.status === 'failed' && (
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => retryItem(item.id)}>
                  <RefreshCw className="h-3 w-3" />
                </Button>
              )}
              {['completed', 'failed'].includes(item.status) && (
                <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground" onClick={() => removeItem(item.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
