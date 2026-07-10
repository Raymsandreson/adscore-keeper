import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Loader2, RefreshCw, UserRound, CheckCircle2, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface OverdueActivity {
  id: string;
  title: string;
  activity_type: string | null;
  status: string;
  priority: string | null;
  deadline: string | null;
  updated_at: string | null;
  created_at: string;
  assigned_to_name: string | null;
  lead_name: string | null;
  lead_id: string | null;
}

export function OverdueActivitiesToday() {
  const navigate = useNavigate();
  const [items, setItems] = useState<OverdueActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [author, setAuthor] = useState<string>('all');

  const load = async () => {
    setLoading(true);
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { data } = await externalSupabase
        .from('lead_activities')
        .select('id, title, activity_type, status, priority, deadline, updated_at, created_at, assigned_to_name, lead_name, lead_id')
        .is('deleted_at', null)
        .eq('status', 'pendente')
        .not('deadline', 'is', null)
        .lt('deadline', todayStart.toISOString())
        .order('deadline', { ascending: true })
        .limit(500);
      setItems((data || []) as OverdueActivity[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const authors = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => { if (i.assigned_to_name) set.add(i.assigned_to_name); });
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(() => {
    if (author === 'all') return items;
    if (author === '__none__') return items.filter((i) => !i.assigned_to_name);
    return items.filter((i) => i.assigned_to_name === author);
  }, [items, author]);

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const updatedTodayCount = useMemo(
    () => filtered.filter((i) => i.updated_at && new Date(i.updated_at) >= todayStart).length,
    [filtered, todayStart],
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 rounded-md border bg-card p-1.5 text-amber-600">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold uppercase tracking-wide">
                Atividades atrasadas — hoje
              </CardTitle>
              <CardDescription className="text-xs">
                Pendentes com prazo vencido. Status, atualização no dia e responsável.
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={author} onValueChange={setAuthor}>
              <SelectTrigger className="h-8 w-[200px] text-xs">
                <UserRound className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
                <SelectValue placeholder="Autor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos os autores</SelectItem>
                <SelectItem value="__none__" className="text-xs">Sem responsável</SelectItem>
                {authors.map((a) => (
                  <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={load} disabled={loading}>
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </Button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          <Badge variant="outline" className="gap-1.5">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            {filtered.length} atrasada{filtered.length === 1 ? '' : 's'}
          </Badge>
          <Badge variant="outline" className="gap-1.5">
            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
            {updatedTodayCount} com atualização hoje
          </Badge>
          <Badge variant="outline" className="gap-1.5">
            <Clock className="h-3 w-3 text-muted-foreground" />
            {filtered.length - updatedTodayCount} sem atualização hoje
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma atividade atrasada no filtro atual.
          </div>
        ) : (
          <ScrollArea className="max-h-[480px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Atividade</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Atualizada hoje</th>
                  <th className="px-3 py-2 text-left font-medium">Autor</th>
                  <th className="px-3 py-2 text-left font-medium">Prazo</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((a) => {
                  const updatedToday = !!a.updated_at && new Date(a.updated_at) >= todayStart;
                  const dl = a.deadline ? new Date(a.deadline) : null;
                  const daysLate = dl
                    ? Math.max(0, Math.floor((todayStart.getTime() - dl.getTime()) / 86400000))
                    : 0;
                  return (
                    <tr
                      key={a.id}
                      onClick={() => navigate(`/?openActivity=${a.id}`)}
                      className="cursor-pointer transition-colors hover:bg-muted/40"
                    >
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium text-foreground line-clamp-1">{a.title}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                          {a.activity_type && <Badge variant="outline" className="text-[10px]">{a.activity_type}</Badge>}
                          {a.lead_name && (
                            <span className="truncate">Lead: {a.lead_name}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <Badge variant="secondary" className="gap-1 capitalize">
                          <Clock className="h-3 w-3 text-amber-500" />
                          {a.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 align-top">
                        {updatedToday ? (
                          <Badge className="gap-1 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" />
                            Sim
                            {a.updated_at && (
                              <span className="ml-1 text-[10px] opacity-70">
                                {format(new Date(a.updated_at), 'HH:mm', { locale: ptBR })}
                              </span>
                            )}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 text-muted-foreground">
                            <AlertTriangle className="h-3 w-3 text-red-500" />
                            Não
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className="text-foreground">
                          {a.assigned_to_name || <span className="text-muted-foreground italic">—</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top">
                        {dl ? (
                          <div className="flex flex-col">
                            <span className="tabular-nums">{format(dl, 'dd/MM/yyyy', { locale: ptBR })}</span>
                            <span className="text-[10px] text-red-600">
                              {daysLate === 0 ? 'vence hoje' : `${daysLate}d atrasada`}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
