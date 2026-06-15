import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2, RefreshCw, Wand2, Play, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { cloudFunctions } from '@/lib/functionRouter';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface LeadRow {
  id: string;
  lead_name: string | null;
  lead_phone: string | null;
  has_group: boolean;
  whatsapp_group_id: string | null;
  lead_status: string | null;
  created_at: string;
}

interface ListResponse {
  success: boolean;
  error?: string;
  total?: number;
  totalPages?: number;
  returned?: number;
  leads?: LeadRow[];
}

interface RecoverResult {
  lead_id: string;
  status: string;
  old_phone?: string;
  new_phone?: string;
  group_jid?: string;
  candidates?: string[];
  message?: string;
}

const STATUS_COLORS: Record<string, string> = {
  recovered: 'bg-green-500/15 text-green-700 border-green-500/30',
  would_recover: 'bg-blue-500/15 text-blue-700 border-blue-500/30',
  ambiguous: 'bg-yellow-500/15 text-yellow-700 border-yellow-500/30',
  no_candidates: 'bg-orange-500/15 text-orange-700 border-orange-500/30',
  no_group: 'bg-muted text-muted-foreground',
  group_fetch_failed: 'bg-red-500/15 text-red-700 border-red-500/30',
  already_valid: 'bg-muted text-muted-foreground',
  error: 'bg-red-500/15 text-red-700 border-red-500/30',
};

export default function RecoverPhone55Page() {
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [onlyWithGroup, setOnlyWithGroup] = useState(true);
  const [data, setData] = useState<ListResponse | null>(null);
  const [results, setResults] = useState<Record<string, RecoverResult>>({});

  async function fetchList(p = page) {
    setLoading(true);
    try {
      const { data: res } = await cloudFunctions.invoke<ListResponse>('recover-leads-phone-55', {
        body: { mode: 'list', page: p, pageSize, onlyWithGroup },
      });
      if (!res?.success) {
        toast({ title: 'Erro', description: res?.error || 'falha ao listar', variant: 'destructive' });
        return;
      }
      setData(res);
      setPage(p);
    } catch (e: any) {
      toast({ title: 'Erro', description: e?.message || 'falha ao listar', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  async function runOne(leadId: string, dryRun: boolean) {
    setRunning(leadId);
    try {
      const { data: res } = await cloudFunctions.invoke<{ success: boolean; error?: string; result?: RecoverResult }>(
        'recover-leads-phone-55',
        { body: { leadId, dryRun } }
      );
      if (!res?.success) {
        toast({ title: 'Erro', description: res?.error || 'falha', variant: 'destructive' });
        return;
      }
      if (res.result) {
        setResults((prev) => ({ ...prev, [leadId]: res.result! }));
        toast({
          title: dryRun ? 'Simulação concluída' : 'Execução concluída',
          description: `${res.result.status}${res.result.new_phone ? ' → ' + res.result.new_phone : ''}`,
        });
        if (!dryRun && res.result.status === 'recovered') {
          // remove da lista local
          setData((prev) =>
            prev
              ? { ...prev, leads: (prev.leads || []).filter((l) => l.id !== leadId), total: (prev.total || 1) - 1 }
              : prev
          );
        }
      }
    } catch (e: any) {
      toast({ title: 'Erro', description: e?.message || 'falha', variant: 'destructive' });
    } finally {
      setRunning(null);
    }
  }

  const totalPages = data?.totalPages || 1;

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-6xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wand2 className="h-6 w-6" />
            Recuperar telefone "55"
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ferramenta temporária. Cada lead listado teve o telefone gravado como "55" (vazio).
            O sistema busca os membros do grupo WhatsApp, remove os números das suas instâncias e,
            sobrando apenas 1 candidato, atualiza o lead.
          </p>
        </div>
        <Button onClick={() => fetchList(1)} disabled={loading} variant="default">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="ml-2">Carregar</span>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <Switch id="only-group" checked={onlyWithGroup} onCheckedChange={setOnlyWithGroup} />
            <Label htmlFor="only-group" className="cursor-pointer">
              Apenas leads com grupo (recuperáveis)
            </Label>
          </div>
          {data && (
            <div className="text-sm text-muted-foreground">
              Total: <strong className="text-foreground">{data.total}</strong> · Página {page} de {totalPages}
            </div>
          )}
        </CardContent>
      </Card>

      {data?.leads && data.leads.length > 0 && (
        <>
          <div className="space-y-2">
            {data.leads.map((lead) => {
              const r = results[lead.id];
              return (
                <Card key={lead.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{lead.lead_name || '(sem nome)'}</span>
                          {lead.lead_status && (
                            <Badge variant="outline" className="text-xs">
                              {lead.lead_status}
                            </Badge>
                          )}
                          {lead.has_group ? (
                            <Badge variant="outline" className="text-xs bg-green-500/10 text-green-700 border-green-500/30">
                              tem grupo
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-700 border-orange-500/30">
                              sem grupo
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 font-mono">
                          {lead.id} · phone: "{lead.lead_phone || ''}" ·{' '}
                          {format(new Date(lead.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                        </div>
                        {lead.whatsapp_group_id && (
                          <div className="text-xs text-muted-foreground mt-1 font-mono truncate">
                            grupo: {lead.whatsapp_group_id}
                          </div>
                        )}
                        {r && (
                          <div className="mt-3 flex items-start gap-2 flex-wrap">
                            <Badge className={STATUS_COLORS[r.status] || ''}>{r.status}</Badge>
                            {r.new_phone && (
                              <span className="text-sm font-mono">
                                {r.old_phone || '—'} → <strong>{r.new_phone}</strong>
                              </span>
                            )}
                            {r.candidates && r.candidates.length > 1 && (
                              <span className="text-xs text-muted-foreground">
                                Candidatos: {r.candidates.join(', ')}
                              </span>
                            )}
                            {r.message && <span className="text-xs text-muted-foreground">{r.message}</span>}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!lead.has_group || running === lead.id}
                          onClick={() => runOne(lead.id, true)}
                        >
                          {running === lead.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <AlertTriangle className="h-3.5 w-3.5" />
                          )}
                          <span className="ml-1.5">Simular</span>
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          disabled={
                            !lead.has_group ||
                            running === lead.id ||
                            (r && r.status !== 'would_recover' && r.status !== 'ambiguous')
                          }
                          onClick={() => {
                            if (!confirm(`Recuperar telefone do lead "${lead.lead_name || lead.id}"? Vai sobrescrever lead_phone.`)) return;
                            runOne(lead.id, false);
                          }}
                        >
                          {running === lead.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Play className="h-3.5 w-3.5" />
                          )}
                          <span className="ml-1.5">Executar</span>
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="flex justify-center gap-2 pt-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => fetchList(page - 1)}>
              ← Anterior
            </Button>
            <span className="flex items-center px-3 text-sm text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => fetchList(page + 1)}>
              Próxima →
            </Button>
          </div>
        </>
      )}

      {data && (!data.leads || data.leads.length === 0) && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-600" />
            Nenhum lead com telefone "55" nesta página.
          </CardContent>
        </Card>
      )}

      {!data && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Clique em <strong>Carregar</strong> para listar os leads com telefone inválido.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
