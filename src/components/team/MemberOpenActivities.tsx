import { useEffect, useState } from 'react';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { remapToExternal, ensureRemapCache } from '@/integrations/supabase/uuid-remap';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, ChevronDown, ChevronUp, ListTodo } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface OpenActivity {
  id: string;
  title: string;
  activity_type: string;
  deadline: string | null;
  lead_name: string | null;
  priority: string | null;
}

export function MemberOpenActivities({ userId }: { userId: string | null | undefined }) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<OpenActivity[]>([]);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await ensureRemapCache();
        const ext = await remapToExternal(userId);
        if (!ext) { setItems([]); return; }
        const { data } = await externalSupabase
          .from('lead_activities')
          .select('id, title, activity_type, deadline, lead_name, priority')
          .is('deleted_at', null)
          .eq('assigned_to', ext)
          .eq('status', 'pendente')
          .order('deadline', { ascending: true, nullsFirst: false })
          .limit(100);
        if (!cancelled) setItems((data || []) as OpenActivity[]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const today = new Date(); today.setHours(0,0,0,0);

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between p-3 hover:bg-muted/40 rounded-t-lg"
      >
        <div className="flex items-center gap-2">
          <ListTodo className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">Atividades em aberto</span>
          <Badge variant="secondary">{loading ? '…' : items.length}</Badge>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {expanded && (
        <div className="border-t">
          {loading ? (
            <div className="flex items-center justify-center p-4 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground text-center">Sem atividades pendentes 🎉</p>
          ) : (
            <ScrollArea className="max-h-64">
              <ul className="divide-y">
                {items.map((a) => {
                  const dl = a.deadline ? new Date(a.deadline) : null;
                  const overdue = dl && dl < today;
                  return (
                    <li key={a.id} className="p-2.5 text-sm hover:bg-muted/40">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{a.title}</p>
                          {a.lead_name && (
                            <p className="text-xs text-muted-foreground truncate">{a.lead_name}</p>
                          )}
                        </div>
                        {dl && (
                          <Badge variant={overdue ? 'destructive' : 'outline'} className="shrink-0 text-[10px]">
                            {format(dl, 'dd/MM', { locale: ptBR })}
                          </Badge>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          )}
        </div>
      )}
    </div>
  );
}
