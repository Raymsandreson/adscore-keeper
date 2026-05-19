import { useState, useEffect, useMemo } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, MessageSquare, Users, User, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type Period = 'today' | 'yesterday' | 'week' | 'month' | 'all';

interface ConvRow {
  phone: string;
  instance_name: string | null;
  is_group: boolean;
  contact_name: string | null;
  last_message_text: string | null;
  last_message_at: string | null;
  msg_count: number;
}

interface Props {
  agentId: string;
}

function getRange(period: Period): { from: Date | null; to: Date } {
  const now = new Date();
  const to = now;
  if (period === 'all') return { from: null, to };
  const from = new Date(now);
  if (period === 'today') {
    from.setHours(0, 0, 0, 0);
  } else if (period === 'yesterday') {
    from.setDate(from.getDate() - 1);
    from.setHours(0, 0, 0, 0);
    const yEnd = new Date(from);
    yEnd.setHours(23, 59, 59, 999);
    return { from, to: yEnd };
  } else if (period === 'week') {
    from.setDate(from.getDate() - 7);
  } else if (period === 'month') {
    from.setMonth(from.getMonth() - 1);
  }
  return { from, to };
}

export function AgentConversationsList({ agentId }: Props) {
  const [period, setPeriod] = useState<Period>('today');
  const [loading, setLoading] = useState(true);
  const [convs, setConvs] = useState<ConvRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await ensureExternalSession().catch(() => {});
        const range = getRange(period);

        // 1. Vínculos conversa↔agente
        const { data: links } = await db
          .from('whatsapp_conversation_agents')
          .select('phone, instance_name, is_active, created_at, agent_id')
          .eq('agent_id', agentId)
          .limit(500);

        const linkedKeys = new Set(
          (links || []).map((l: any) => `${(l.phone || '').replace(/\D/g, '')}|${(l.instance_name || '').toLowerCase()}`),
        );

        // 2. Mensagens onde o agente respondeu diretamente (campo agent_id em whatsapp_messages, quando existir)
        let agentMessages: any[] = [];
        try {
          let q = (db as any)
            .from('whatsapp_messages')
            .select('phone, instance_name, is_group, contact_name, message_text, created_at, agent_id')
            .eq('agent_id', agentId)
            .order('created_at', { ascending: false })
            .limit(1000);
          if (range.from) q = q.gte('created_at', range.from.toISOString());
          q = q.lte('created_at', range.to.toISOString());
          const { data } = await q;
          agentMessages = data || [];
        } catch {
          // coluna pode não existir — silencioso
        }

        // 3. Para as conversas vinculadas, buscar última mensagem no período
        const linkedPhones = Array.from(linkedKeys).map((k) => k.split('|')[0]).filter(Boolean);
        let linkedMessages: any[] = [];
        if (linkedPhones.length > 0) {
          let q = (db as any)
            .from('whatsapp_messages')
            .select('phone, instance_name, is_group, contact_name, message_text, created_at')
            .in('phone', linkedPhones.slice(0, 200))
            .order('created_at', { ascending: false })
            .limit(2000);
          if (range.from) q = q.gte('created_at', range.from.toISOString());
          q = q.lte('created_at', range.to.toISOString());
          const { data } = await q;
          linkedMessages = (data || []).filter((m: any) => {
            const key = `${(m.phone || '').replace(/\D/g, '')}|${(m.instance_name || '').toLowerCase()}`;
            return linkedKeys.has(key);
          });
        }

        // 4. Agrupar por (phone+instance) e pegar a mais recente
        const byKey = new Map<string, ConvRow>();
        const ingest = (m: any) => {
          const key = `${(m.phone || '').replace(/\D/g, '')}|${(m.instance_name || '').toLowerCase()}`;
          const existing = byKey.get(key);
          if (!existing) {
            byKey.set(key, {
              phone: m.phone,
              instance_name: m.instance_name,
              is_group: !!m.is_group,
              contact_name: m.contact_name,
              last_message_text: m.message_text,
              last_message_at: m.created_at,
              msg_count: 1,
            });
          } else {
            existing.msg_count += 1;
            if (m.created_at && (!existing.last_message_at || m.created_at > existing.last_message_at)) {
              existing.last_message_at = m.created_at;
              existing.last_message_text = m.message_text;
              existing.contact_name = existing.contact_name || m.contact_name;
            }
          }
        };
        agentMessages.forEach(ingest);
        linkedMessages.forEach(ingest);

        const rows = Array.from(byKey.values()).sort((a, b) => {
          const av = a.last_message_at || '';
          const bv = b.last_message_at || '';
          return bv.localeCompare(av);
        });

        if (!cancelled) setConvs(rows);
      } catch (e) {
        console.error('[AgentConversationsList] erro:', e);
        if (!cancelled) setConvs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, period]);

  const counts = useMemo(() => {
    return {
      total: convs.length,
      dm: convs.filter((c) => !c.is_group).length,
      group: convs.filter((c) => c.is_group).length,
    };
  }, [convs]);

  const periods: { key: Period; label: string }[] = [
    { key: 'today', label: 'Hoje' },
    { key: 'yesterday', label: 'Ontem' },
    { key: 'week', label: 'Esta semana' },
    { key: 'month', label: 'Este mês' },
    { key: 'all', label: 'Tudo' },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {periods.map((p) => (
          <Button
            key={p.key}
            size="sm"
            variant={period === p.key ? 'default' : 'outline'}
            className="h-7 text-[10px] px-2"
            onClick={() => setPeriod(p.key)}
          >
            {p.label}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground">
          <Badge variant="secondary" className="h-5 px-1.5 gap-1">
            <MessageSquare className="h-3 w-3" /> {counts.total}
          </Badge>
          <Badge variant="outline" className="h-5 px-1.5 gap-1">
            <User className="h-3 w-3" /> {counts.dm} DM
          </Badge>
          <Badge variant="outline" className="h-5 px-1.5 gap-1">
            <Users className="h-3 w-3" /> {counts.group} grupos
          </Badge>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando conversas…
        </div>
      ) : convs.length === 0 ? (
        <div className="text-center py-10 text-xs text-muted-foreground">
          Nenhuma conversa neste período.
        </div>
      ) : (
        <ScrollArea className="h-[420px] border rounded-md">
          <div className="divide-y">
            {convs.map((c) => (
              <div key={`${c.phone}|${c.instance_name}`} className="p-2.5 hover:bg-muted/40 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      {c.is_group ? (
                        <Users className="h-3 w-3 text-amber-600 shrink-0" />
                      ) : (
                        <User className="h-3 w-3 text-blue-600 shrink-0" />
                      )}
                      <span className="text-xs font-medium truncate">
                        {c.contact_name || c.phone}
                      </span>
                      {c.is_group && (
                        <Badge variant="outline" className="h-4 px-1 text-[9px]">grupo</Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {c.last_message_text || <em>sem texto</em>}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-[9px] text-muted-foreground">
                      <span>{c.phone}</span>
                      {c.instance_name && <span>· {c.instance_name}</span>}
                      <span>· {c.msg_count} msg{c.msg_count > 1 ? 's' : ''}</span>
                    </div>
                  </div>
                  {c.last_message_at && (
                    <div className="text-[9px] text-muted-foreground whitespace-nowrap flex items-center gap-1 shrink-0">
                      <Clock className="h-2.5 w-2.5" />
                      {formatDistanceToNow(new Date(c.last_message_at), { addSuffix: true, locale: ptBR })}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
