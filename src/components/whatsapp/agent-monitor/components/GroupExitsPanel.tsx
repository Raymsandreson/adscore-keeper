import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, UserMinus, RefreshCw, Users } from 'lucide-react';
import { db } from '@/integrations/supabase';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface ExitRow {
  id: string;
  phone: string;
  group_jid: string;
  group_name: string | null;
  contact_name: string | null;
  lead_id: string | null;
  lead_name: string | null;
  exit_action: string;
  actor: string | null;
  exited_at: string;
  instance_name: string | null;
}

export function GroupExitsPanel() {
  const [rows, setRows] = useState<ExitRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data, error } = await (db as any)
        .from('whatsapp_group_exits')
        .select('id, phone, group_jid, group_name, contact_name, lead_id, lead_name, exit_action, actor, exited_at, instance_name')
        .order('exited_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      setRows((data as ExitRow[]) || []);
    } catch (err) {
      console.error('[GroupExitsPanel] fetch error', err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <UserMinus className="h-4 w-4 text-destructive" />
            Clientes que saíram dos grupos
            <Badge variant="secondary" className="text-[10px]">{rows.length}</Badge>
          </span>
          <Button size="sm" variant="ghost" onClick={fetchData} disabled={loading} className="h-7 gap-1.5 text-xs">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Atualizar
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando...
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Nenhuma saída registrada ainda</p>
            <p className="text-[11px] mt-2 opacity-70">
              Configure o webhook <code>POST /functions/whatsapp-group-exit</code> no painel da UazAPI
              para o evento <code>group-participants-update</code>.
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {rows.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-3 p-3 rounded-lg border bg-card hover:bg-accent/40 transition">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">
                      {r.contact_name || r.lead_name || r.phone}
                    </span>
                    <Badge
                      variant={r.exit_action === 'remove' ? 'destructive' : 'outline'}
                      className="text-[10px]"
                    >
                      {r.exit_action === 'remove' ? 'Removido' : 'Saiu'}
                    </Badge>
                    {r.lead_name && r.contact_name && r.lead_name !== r.contact_name && (
                      <Badge variant="secondary" className="text-[10px]">Lead: {r.lead_name}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    📱 {r.phone} {r.instance_name ? `· ${r.instance_name}` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    👥 {r.group_name || r.group_jid}
                  </p>
                  {r.actor && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      por: {r.actor}
                    </p>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">
                  {formatDistanceToNow(new Date(r.exited_at), { addSuffix: true, locale: ptBR })}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
