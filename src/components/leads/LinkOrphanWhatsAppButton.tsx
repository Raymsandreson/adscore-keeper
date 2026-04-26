import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Link2, MessageSquare, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface InstanceSummary {
  instance_name: string;
  count: number;
  first_at: string | null;
  last_at: string | null;
}

interface Props {
  leadId: string;
  leadPhone: string | null | undefined;
}

/**
 * Detects orphan WhatsApp messages by phone (last 8 digits) that are not yet
 * linked to this lead, and lets the user link them with one click.
 */
export function LinkOrphanWhatsAppButton({ leadId, leadPhone }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [instances, setInstances] = useState<InstanceSummary[]>([]);
  const [totalOrphans, setTotalOrphans] = useState(0);

  const last8 = (leadPhone || '').replace(/\D/g, '').slice(-8);

  const scan = async () => {
    if (!last8 || last8.length < 8) {
      setInstances([]);
      setTotalOrphans(0);
      return;
    }
    setLoading(true);
    try {
      // Fetch a window of orphan messages and aggregate client-side.
      const { data, error } = await supabase
        .from('whatsapp_messages')
        .select('instance_name, created_at, lead_id, phone')
        .like('phone', `%${last8}%`)
        .or(`lead_id.is.null,lead_id.neq.${leadId}`)
        .order('created_at', { ascending: false })
        .limit(2000);

      if (error) throw error;

      const map = new Map<string, InstanceSummary>();
      (data || []).forEach((m: any) => {
        const key = m.instance_name || '(sem instância)';
        const cur = map.get(key) || { instance_name: key, count: 0, first_at: null, last_at: null };
        cur.count += 1;
        if (!cur.last_at || m.created_at > cur.last_at) cur.last_at = m.created_at;
        if (!cur.first_at || m.created_at < cur.first_at) cur.first_at = m.created_at;
        map.set(key, cur);
      });

      const list = Array.from(map.values()).sort((a, b) => (b.last_at || '').localeCompare(a.last_at || ''));
      setInstances(list);
      setTotalOrphans((data || []).length);
    } catch (err: any) {
      console.error('[LinkOrphanWhatsApp] scan error', err);
      toast({
        title: 'Erro ao buscar mensagens',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, last8]);

  const handleLink = async () => {
    if (!last8) return;
    setLinking(true);
    try {
      const { error, count } = await supabase
        .from('whatsapp_messages')
        .update({ lead_id: leadId })
        .like('phone', `%${last8}%`)
        .or(`lead_id.is.null,lead_id.neq.${leadId}`)
        .select('*', { count: 'exact', head: true });

      if (error) throw error;

      toast({
        title: 'Mensagens vinculadas',
        description: `${count ?? totalOrphans} mensagem(ns) agora aparecem no histórico do lead.`,
      });
      await scan();
    } catch (err: any) {
      console.error('[LinkOrphanWhatsApp] link error', err);
      toast({
        title: 'Erro ao vincular',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setLinking(false);
    }
  };

  if (!leadPhone || last8.length < 8) {
    return null;
  }

  if (loading && instances.length === 0) {
    return (
      <Card className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Verificando conversas órfãs no WhatsApp...
      </Card>
    );
  }

  if (totalOrphans === 0) {
    return null; // Nothing to show — keep UI clean.
  }

  return (
    <Card className="p-4 border-amber-300/50 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-800/40">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-2 flex-1 min-w-0">
          <div className="flex items-center gap-2 font-medium text-sm">
            <MessageSquare className="h-4 w-4 text-amber-700 dark:text-amber-400" />
            Conversas órfãs detectadas para este telefone
          </div>
          <p className="text-xs text-muted-foreground">
            Encontramos <strong>{totalOrphans}</strong> mensagem(ns) trocada(s) com{' '}
            <code className="text-xs">{leadPhone}</code> que ainda não estão vinculadas a este lead.
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {instances.map((i) => (
              <Badge key={i.instance_name} variant="secondary" className="text-xs">
                {i.instance_name} · {i.count}
                {i.last_at && (
                  <span className="ml-1 opacity-60">
                    ({new Date(i.last_at).toLocaleDateString('pt-BR')})
                  </span>
                )}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <Button
            onClick={handleLink}
            disabled={linking}
            size="sm"
            className="gap-1.5"
          >
            {linking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            Vincular ao lead
          </Button>
          <Button
            onClick={scan}
            disabled={loading || linking}
            size="sm"
            variant="ghost"
            className="gap-1.5 text-xs h-7"
          >
            <RefreshCw className="h-3 w-3" />
            Atualizar
          </Button>
        </div>
      </div>
    </Card>
  );
}
