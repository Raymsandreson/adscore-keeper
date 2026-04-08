import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowRightLeft, MessageSquare, Bell, Users } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { RedirectionData } from '../types';

interface RedirectionsTabProps {
  redirections: RedirectionData[];
  loading: boolean;
}

export function RedirectionsTab({ redirections, loading }: RedirectionsTabProps) {
  const stats = useMemo(() => {
    const byAgent = new Map<string, number>();
    redirections.forEach(r => {
      const name = r.agent_name || 'Desconhecido';
      byAgent.set(name, (byAgent.get(name) || 0) + 1);
    });
    return {
      total: redirections.length,
      withNotification: redirections.filter(r => r.notify_instance_name).length,
      byAgent: Array.from(byAgent.entries()).sort((a, b) => b[1] - a[1]),
    };
  }, [redirections]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <ArrowRightLeft className="h-5 w-5 mx-auto mb-1 text-primary" />
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-[10px] text-muted-foreground">Redirecionamentos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <Bell className="h-5 w-5 mx-auto mb-1 text-amber-500" />
            <p className="text-2xl font-bold">{stats.withNotification}</p>
            <p className="text-[10px] text-muted-foreground">Com notificação</p>
          </CardContent>
        </Card>
        {stats.byAgent.slice(0, 2).map(([name, count]) => (
          <Card key={name}>
            <CardContent className="pt-4 pb-3 text-center">
              <Users className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
              <p className="text-2xl font-bold">{count}</p>
              <p className="text-[10px] text-muted-foreground truncate">{name}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-2">
        {redirections.map(r => (
          <Card key={r.id} className="overflow-hidden">
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{r.agent_name || 'Desconhecido'}</Badge>
                  <span className="text-xs text-muted-foreground">{r.phone}</span>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {format(new Date(r.created_at), "dd/MM HH:mm", { locale: ptBR })}
                </span>
              </div>
              {r.group_message && (
                <div className="flex items-start gap-1.5">
                  <MessageSquare className="h-3 w-3 mt-0.5 text-primary shrink-0" />
                  <p className="text-xs text-muted-foreground line-clamp-2">{r.group_message}</p>
                </div>
              )}
              <div className="flex items-center gap-2 text-[10px]">
                <Badge variant="secondary" className="text-[10px]">{r.instance_name}</Badge>
                {r.notify_instance_name && (
                  <>
                    <span>→</span>
                    <Badge variant="outline" className="text-[10px] gap-1">
                      <Bell className="h-2.5 w-2.5" />{r.notify_instance_name}
                    </Badge>
                  </>
                )}
                {r.group_jid && <Badge variant="outline" className="text-[10px]">Grupo ✓</Badge>}
              </div>
            </CardContent>
          </Card>
        ))}
        {redirections.length === 0 && !loading && (
          <div className="text-center py-12 text-muted-foreground">
            <ArrowRightLeft className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Nenhum redirecionamento no período</p>
          </div>
        )}
      </div>
    </div>
  );
}
