import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Loader2, ListTodo, CheckCircle2, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface ContactActivity {
  id: string;
  title: string;
  description: string | null;
  activity_type: string;
  status: string;
  priority: string | null;
  deadline: string | null;
  completed_at: string | null;
  assigned_to_name: string | null;
  lead_name: string | null;
  created_at: string;
}

export function ContactActivities({ contactId }: { contactId: string }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ContactActivity[]>([]);

  useEffect(() => {
    if (!contactId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await externalSupabase
          .from('lead_activities')
          .select('id, title, description, activity_type, status, priority, deadline, completed_at, assigned_to_name, lead_name, created_at')
          .is('deleted_at', null)
          .eq('contact_id', contactId)
          .order('created_at', { ascending: false })
          .limit(200);
        if (!cancelled) setItems((data || []) as ContactActivity[]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [contactId]);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const pending = items.filter(i => i.status === 'pendente');
  const done = items.filter(i => i.status !== 'pendente');

  if (loading) {
    return (
      <div className="flex items-center justify-center p-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        <ListTodo className="h-8 w-8 mx-auto mb-2 opacity-50" />
        Nenhuma atividade vinculada a este contato.
      </div>
    );
  }

  const renderItem = (a: ContactActivity) => {
    const dl = a.deadline ? new Date(a.deadline) : null;
    const overdue = dl && a.status === 'pendente' && dl < today;
    return (
      <li key={a.id} onClick={() => navigate(`/?openActivity=${a.id}`)} className="p-3 text-sm hover:bg-muted/40 cursor-pointer">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {a.status === 'pendente' ? (
                <Clock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
              )}
              <p className="font-medium truncate">{a.title}</p>
            </div>
            {a.description && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.description}</p>
            )}
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              <Badge variant="outline" className="text-[10px]">{a.activity_type}</Badge>
              {a.lead_name && (
                <Badge variant="secondary" className="text-[10px]">Lead: {a.lead_name}</Badge>
              )}
              {a.assigned_to_name && (
                <Badge variant="outline" className="text-[10px]">{a.assigned_to_name}</Badge>
              )}
            </div>
          </div>
          {dl && (
            <Badge variant={overdue ? 'destructive' : 'outline'} className="shrink-0 text-[10px]">
              {format(dl, 'dd/MM/yy', { locale: ptBR })}
            </Badge>
          )}
        </div>
      </li>
    );
  };

  return (
    <ScrollArea className="max-h-[500px]">
      {pending.length > 0 && (
        <div>
          <div className="px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/30">
            Pendentes ({pending.length})
          </div>
          <ul className="divide-y">{pending.map(renderItem)}</ul>
        </div>
      )}
      {done.length > 0 && (
        <div>
          <div className="px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/30">
            Concluídas ({done.length})
          </div>
          <ul className="divide-y opacity-75">{done.map(renderItem)}</ul>
        </div>
      )}
    </ScrollArea>
  );
}
