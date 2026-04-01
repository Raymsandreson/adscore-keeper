import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Sparkles, Search, RefreshCw, CheckCircle, Clock, AlertTriangle, User, Briefcase, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface AIActivity {
  id: string;
  lead_id: string | null;
  lead_name: string | null;
  title: string;
  description: string | null;
  activity_type: string;
  status: string;
  priority: string;
  assigned_to: string | null;
  assigned_to_name: string | null;
  deadline: string | null;
  next_steps: string | null;
  created_at: string;
  ai_generation_context: any;
}

export function AIActivitiesPanel() {
  const [activities, setActivities] = useState<AIActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [generating, setGenerating] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchActivities = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('lead_activities')
        .select('id, lead_id, lead_name, title, description, activity_type, status, priority, assigned_to, assigned_to_name, deadline, next_steps, created_at, ai_generation_context')
        .eq('created_by_ai', true)
        .order('created_at', { ascending: false })
        .limit(200);

      if (!error) setActivities((data || []) as AIActivity[]);
    } catch (e) {
      console.error('Error fetching AI activities:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchActivities(); }, [fetchActivities]);

  const handleGenerateActivities = async (leadId: string, regenerate = false) => {
    setGenerating(leadId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await cloudFunctions.invoke('generate-case-activities', {
        body: { lead_id: leadId, regenerate },
        authToken: session?.access_token,
      });

      if (error) throw error;

      toast({
        title: 'Atividades geradas',
        description: data?.message || `${data?.count || 0} atividades criadas`,
      });
      fetchActivities();
    } catch (e: any) {
      toast({
        title: 'Erro ao gerar atividades',
        description: e.message || 'Tente novamente',
        variant: 'destructive',
      });
    } finally {
      setGenerating(null);
    }
  };

  const uniqueAssignees = useMemo(() =>
    [...new Set(activities.map(a => a.assigned_to_name).filter(Boolean))].sort() as string[],
    [activities]
  );

  const filteredActivities = useMemo(() =>
    activities.filter(a => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (assigneeFilter !== 'all' && a.assigned_to_name !== assigneeFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return a.title.toLowerCase().includes(q) ||
          a.lead_name?.toLowerCase().includes(q) ||
          a.assigned_to_name?.toLowerCase().includes(q) ||
          a.description?.toLowerCase().includes(q);
      }
      return true;
    }),
    [activities, statusFilter, assigneeFilter, searchQuery]
  );

  const stats = useMemo(() => ({
    total: activities.length,
    pendente: activities.filter(a => a.status === 'pendente').length,
    em_andamento: activities.filter(a => a.status === 'em_andamento').length,
    concluida: activities.filter(a => a.status === 'concluida' || a.status === 'completed').length,
  }), [activities]);

  const priorityColor = (p: string) => {
    switch (p) {
      case 'urgente': return 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400';
      case 'alta': return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const statusIcon = (s: string) => {
    switch (s) {
      case 'concluida':
      case 'completed': return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
      case 'em_andamento': return <Clock className="h-3.5 w-3.5 text-blue-500" />;
      default: return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
    }
  };

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <Sparkles className="h-4 w-4 mx-auto mb-1 text-primary" />
            <p className="text-xl font-bold">{stats.total}</p>
            <p className="text-[10px] text-muted-foreground">Total Geradas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <AlertTriangle className="h-4 w-4 mx-auto mb-1 text-amber-500" />
            <p className="text-xl font-bold text-amber-600">{stats.pendente}</p>
            <p className="text-[10px] text-muted-foreground">Pendentes</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <Clock className="h-4 w-4 mx-auto mb-1 text-blue-500" />
            <p className="text-xl font-bold text-blue-600">{stats.em_andamento}</p>
            <p className="text-[10px] text-muted-foreground">Em Andamento</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <CheckCircle className="h-4 w-4 mx-auto mb-1 text-green-500" />
            <p className="text-xl font-bold text-green-600">{stats.concluida}</p>
            <p className="text-[10px] text-muted-foreground">Concluídas</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos Status</SelectItem>
            <SelectItem value="pendente">Pendente</SelectItem>
            <SelectItem value="em_andamento">Em Andamento</SelectItem>
            <SelectItem value="concluida">Concluída</SelectItem>
          </SelectContent>
        </Select>

        {uniqueAssignees.length > 1 && (
          <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue placeholder="Responsável" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {uniqueAssignees.map(a => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Buscar..." value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)} className="pl-8 h-8 text-xs" />
        </div>

        <Button variant="outline" size="sm" className="h-8" onClick={fetchActivities} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">{filteredActivities.length} atividades geradas pela IA</p>

      {/* Activity list */}
      <ScrollArea className="h-[calc(100vh-500px)]">
        <div className="space-y-2">
          {filteredActivities.map(a => (
            <Card key={a.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {statusIcon(a.status)}
                      <span className="text-sm font-semibold">{a.title}</span>
                      <Badge className={`text-[9px] h-4 ${priorityColor(a.priority)}`}>
                        {a.priority}
                      </Badge>
                      <Badge variant="outline" className="text-[9px] h-4">
                        {a.activity_type}
                      </Badge>
                    </div>

                    {a.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.description}</p>
                    )}

                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground flex-wrap">
                      {a.assigned_to_name && (
                        <span className="flex items-center gap-0.5">
                          <User className="h-3 w-3" /> {a.assigned_to_name}
                        </span>
                      )}
                      {a.ai_generation_context?.position_name && (
                        <span className="flex items-center gap-0.5">
                          <Briefcase className="h-3 w-3" /> {a.ai_generation_context.position_name}
                        </span>
                      )}
                      {a.lead_name && (
                        <span className="flex items-center gap-0.5">
                          📋 {a.lead_name}
                        </span>
                      )}
                      {a.ai_generation_context?.product && (
                        <Badge variant="secondary" className="text-[9px] h-4">
                          {a.ai_generation_context.product}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="text-right shrink-0 space-y-1">
                    <p className="text-[10px] text-muted-foreground">
                      {format(new Date(a.created_at), 'dd/MM HH:mm', { locale: ptBR })}
                    </p>
                    {a.deadline && (
                      <p className="text-[10px] flex items-center gap-0.5 justify-end">
                        <Calendar className="h-3 w-3" />
                        {format(new Date(a.deadline + 'T12:00:00'), 'dd/MM')}
                      </p>
                    )}
                  </div>
                </div>

                {a.next_steps && (
                  <div className="mt-2 p-2 bg-muted/50 rounded text-[10px]">
                    <span className="font-semibold">Próximos passos:</span> {a.next_steps}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}

          {filteredActivities.length === 0 && !loading && (
            <div className="text-center py-12 text-muted-foreground">
              <Sparkles className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Nenhuma atividade gerada pela IA ainda</p>
              <p className="text-[10px] mt-1">Atividades serão criadas automaticamente quando casos forem fechados</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
