import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { supabase } from '@/integrations/supabase/client';
import { ensureRemapCache, remapToCloudSync } from '@/integrations/supabase/uuid-remap';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AlertTriangle, Calendar, FileText, User, Download, RefreshCw } from 'lucide-react';
import { format, differenceInCalendarDays } from 'date-fns';
import { toast } from 'sonner';

interface StaleProcess {
  id: string;
  title: string;
  process_number: string | null;
  status: string;
  data_ultima_movimentacao: string | null;
  responsible_user_id: string | null;
  case_id: string | null;
  lead_id: string;
  tribunal_sigla: string | null;
  legal_cases?: { case_number: string; title: string } | null;
  _days: number;
  _responsibleName: string;
}

type Bucket = '30' | '60' | '90' | 'all';

export function StaleProcessesReport() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<StaleProcess[]>([]);
  const [bucket, setBucket] = useState<Bucket>('30');

  const load = async () => {
    setLoading(true);
    try {
      await ensureRemapCache();
      // Só processos ativos, com data de última movimentação
      const { data, error } = await externalSupabase
        .from('lead_processes')
        .select('id, title, process_number, status, data_ultima_movimentacao, responsible_user_id, case_id, lead_id, tribunal_sigla, legal_cases(case_number, title)')
        .eq('status', 'active')
        .not('data_ultima_movimentacao', 'is', null)
        .order('data_ultima_movimentacao', { ascending: true })
        .limit(2000);
      if (error) throw error;

      // Coleta ids de responsáveis (Cloud UUIDs esperados) e busca nomes
      const responsibleIds = Array.from(new Set((data || [])
        .map((r: any) => r.responsible_user_id)
        .filter(Boolean)));

      const nameMap = new Map<string, string>();
      if (responsibleIds.length > 0) {
        // Tenta direto (Cloud UUID). Se falhar, tenta remap.
        const { data: profs } = await supabase
          .from('profiles')
          .select('user_id, full_name')
          .in('user_id', responsibleIds as string[]);
        (profs || []).forEach((p: any) => nameMap.set(p.user_id, p.full_name || '—'));
        // fallback via remap (para ids do Externo)
        for (const id of responsibleIds as string[]) {
          if (nameMap.has(id)) continue;
          const cloudId = remapToCloudSync(id);
          if (cloudId) {
            const { data: p2 } = await supabase
              .from('profiles')
              .select('full_name')
              .eq('user_id', cloudId)
              .maybeSingle();
            if (p2?.full_name) nameMap.set(id, p2.full_name);
          }
        }
      }

      const today = new Date();
      const mapped: StaleProcess[] = (data || []).map((r: any) => {
        const d = r.data_ultima_movimentacao ? new Date(r.data_ultima_movimentacao) : null;
        const days = d ? differenceInCalendarDays(today, d) : 0;
        return {
          ...r,
          _days: days,
          _responsibleName: r.responsible_user_id ? (nameMap.get(r.responsible_user_id) || '—') : '—',
        };
      }).filter(r => r._days >= 30);

      setRows(mapped);
    } catch (e: any) {
      toast.error('Erro ao carregar relatório: ' + (e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (bucket === 'all') return rows;
    if (bucket === '30') return rows.filter(r => r._days >= 30 && r._days < 60);
    if (bucket === '60') return rows.filter(r => r._days >= 60 && r._days < 90);
    return rows.filter(r => r._days >= 90);
  }, [rows, bucket]);

  const counts = useMemo(() => ({
    d30: rows.filter(r => r._days >= 30 && r._days < 60).length,
    d60: rows.filter(r => r._days >= 60 && r._days < 90).length,
    d90: rows.filter(r => r._days >= 90).length,
    all: rows.length,
  }), [rows]);

  // Agrupamento por responsável (para o bucket ativo)
  const byResponsible = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach(r => m.set(r._responsibleName, (m.get(r._responsibleName) || 0) + 1));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const exportCsv = () => {
    const header = ['Numero', 'Titulo', 'Tribunal', 'Ultima Movimentacao', 'Dias sem movimento', 'Responsavel', 'Caso'];
    const lines = filtered.map(r => [
      r.process_number || '',
      (r.title || '').replace(/[",\n]/g, ' '),
      r.tribunal_sigla || '',
      r.data_ultima_movimentacao ? format(new Date(r.data_ultima_movimentacao), 'dd/MM/yyyy') : '',
      String(r._days),
      r._responsibleName.replace(/[",\n]/g, ' '),
      r.legal_cases?.case_number || '',
    ].map(v => `"${v}"`).join(','));
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `processos-sem-movimento-${bucket}dias-${format(new Date(), 'yyyyMMdd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <h2 className="text-lg font-semibold">Processos sem movimentação</h2>
          <span className="text-sm text-muted-foreground">(fonte: Escavador)</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
            <Download className="h-4 w-4 mr-1" /> Exportar CSV
          </Button>
        </div>
      </div>

      <Tabs value={bucket} onValueChange={(v) => setBucket(v as Bucket)}>
        <TabsList>
          <TabsTrigger value="30">30–59 dias <Badge variant="secondary" className="ml-2">{counts.d30}</Badge></TabsTrigger>
          <TabsTrigger value="60">60–89 dias <Badge variant="secondary" className="ml-2">{counts.d60}</Badge></TabsTrigger>
          <TabsTrigger value="90">90+ dias <Badge variant="destructive" className="ml-2">{counts.d90}</Badge></TabsTrigger>
          <TabsTrigger value="all">Todos ≥30 <Badge variant="outline" className="ml-2">{counts.all}</Badge></TabsTrigger>
        </TabsList>

        <TabsContent value={bucket} className="space-y-4 mt-4">
          {byResponsible.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium text-muted-foreground mb-2">Por responsável</p>
                <div className="flex flex-wrap gap-2">
                  {byResponsible.map(([name, n]) => (
                    <Badge key={name} variant="outline" className="gap-1">
                      <User className="h-3 w-3" /> {name}: {n}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {loading ? (
            <div className="text-center py-12 text-muted-foreground">Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">Nenhum processo nessa faixa 🎉</div>
          ) : (
            <div className="grid gap-2">
              {filtered.map(p => (
                <Card
                  key={p.id}
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => navigate(`/processes?openProcess=${p.id}`)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <FileText className="h-4 w-4 text-primary shrink-0" />
                          <span className="font-medium truncate">{p.title}</span>
                          {p.tribunal_sigla && <Badge variant="secondary" className="text-[10px]">{p.tribunal_sigla}</Badge>}
                        </div>
                        {p.process_number && (
                          <p className="text-xs text-muted-foreground font-mono mt-1">{p.process_number}</p>
                        )}
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" /> {p._responsibleName}
                          </span>
                          {p.data_ultima_movimentacao && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              Última mov.: {format(new Date(p.data_ultima_movimentacao), 'dd/MM/yyyy')}
                            </span>
                          )}
                          {p.legal_cases?.case_number && (
                            <span>Caso: <strong>{p.legal_cases.case_number}</strong></span>
                          )}
                        </div>
                      </div>
                      <Badge
                        variant={p._days >= 90 ? 'destructive' : p._days >= 60 ? 'default' : 'secondary'}
                        className="shrink-0"
                      >
                        {p._days} dias
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default StaleProcessesReport;
