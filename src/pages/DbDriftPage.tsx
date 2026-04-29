import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Loader2, RefreshCw, AlertTriangle, CheckCircle2, ArrowDown, ArrowUp,
  Microscope, ChevronDown, ChevronRight,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type Trigger = { name: string; when: string; fn: string };
type SideStats = { total: number | null; last_at: string | null; error: string | null };
type Detail = {
  columns: string[];
  cloud_rows: any[];
  ext_rows: any[];
  cloud_error: string | null;
  ext_error: string | null;
} | null;
type Row = {
  table: string;
  cloud: SideStats;
  ext: SideStats;
  delta: number;
  sample: { in_both: number; only_cloud: number; only_ext: number; sample_size: number };
  triggers: { cloud: Trigger[]; ext: Trigger[] };
  detail: Detail;
};

function fmt(n: number | null) {
  return n == null ? '—' : n.toLocaleString('pt-BR');
}
function rel(iso: string | null) {
  if (!iso) return '—';
  try {
    return formatDistanceToNow(new Date(iso), { locale: ptBR, addSuffix: true });
  } catch {
    return iso;
  }
}
function fmtCell(v: any) {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  if (typeof v === 'string' && v.length > 60) return <span title={v}>{v.slice(0, 57)}…</span>;
  if (typeof v === 'object') {
    const s = JSON.stringify(v);
    return <span title={s} className="font-mono">{s.length > 60 ? s.slice(0, 57) + '…' : s}</span>;
  }
  return String(v);
}

function SamplesTable({ title, columns, rows, error }: {
  title: string; columns: string[]; rows: any[]; error: string | null;
}) {
  return (
    <div>
      <div className="text-xs font-semibold mb-1 flex items-center gap-2">
        {title} <Badge variant="outline" className="text-[10px]">{rows.length}</Badge>
      </div>
      {error && <div className="text-xs text-destructive mb-1">{error}</div>}
      <div className="rounded border overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="bg-muted/50">
            <tr>
              {columns.map((c) => (
                <th key={c} className="text-left px-2 py-1 font-medium whitespace-nowrap">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={columns.length} className="px-2 py-2 text-muted-foreground">Sem linhas</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className="border-t">
                {columns.map((c) => (
                  <td key={c} className="px-2 py-1 align-top whitespace-nowrap max-w-[220px] overflow-hidden">
                    {fmtCell(r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function DbDriftPage() {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState(false);
  const [openDetail, setOpenDetail] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    setErr(null);
    const path = detailMode ? 'db-drift-monitor?detail=1' : 'db-drift-monitor';
    const { data, error } = await supabase.functions.invoke(path);
    setLoading(false);
    if (error) { setErr(error.message); return; }
    if (!data?.success) { setErr(data?.error ?? 'Erro desconhecido'); return; }
    setRows(data.results);
    setGeneratedAt(data.generated_at);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-6xl">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Drift de Banco — Cloud × Externo</h1>
          <p className="text-sm text-muted-foreground">
            Compara totais, última escrita e amostra das últimas 50 linhas em cada tabela crítica.
          </p>
          {generatedAt && (
            <p className="text-xs text-muted-foreground mt-1">Gerado {rel(generatedAt)}</p>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 rounded border px-3 py-1.5">
            <Microscope className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="detail-mode" className="text-xs cursor-pointer">Modo diagnóstico</Label>
            <Switch id="detail-mode" checked={detailMode} onCheckedChange={setDetailMode} />
          </div>
          <Button onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Atualizar
          </Button>
        </div>
      </header>

      {detailMode && (
        <Card className="border-blue-500/40 bg-blue-500/5">
          <CardContent className="p-3 text-xs text-muted-foreground">
            <strong className="text-foreground">Modo diagnóstico ativo.</strong> Cada tabela mostra as
            últimas 10 linhas de Cloud e Externo lado a lado, com colunas-chave (instance_name, source,
            created_by, etc.) para você identificar QUAL código gravou cada registro.
          </CardContent>
        </Card>
      )}

      {err && (
        <Card className="border-destructive">
          <CardContent className="p-4 text-sm text-destructive">{err}</CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {rows.map((r) => {
          const driftCount = Math.abs(r.delta) > 0;
          const driftSample = r.sample.only_cloud > 0 || r.sample.only_ext > 0;
          const isDup = r.sample.in_both > 0;
          const isOpen = openDetail[r.table] ?? true;
          return (
            <Card key={r.table} className={driftCount || driftSample ? 'border-amber-500/60' : ''}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <code className="text-base">{r.table}</code>
                    {driftCount || driftSample ? (
                      <Badge variant="outline" className="border-amber-500 text-amber-600">
                        <AlertTriangle className="h-3 w-3 mr-1" /> Divergência
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-emerald-500 text-emerald-600">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Sincronizado
                      </Badge>
                    )}
                    {isDup && (
                      <Badge variant="secondary">
                        Duplicação ativa: {r.sample.in_both}/{r.sample.sample_size} últimas em ambos
                      </Badge>
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded border p-3">
                    <div className="text-xs text-muted-foreground">Cloud</div>
                    <div className="text-xl font-semibold">{fmt(r.cloud.total)}</div>
                    <div className="text-xs text-muted-foreground">última: {rel(r.cloud.last_at)}</div>
                    {r.cloud.error && <div className="text-xs text-destructive mt-1">{r.cloud.error}</div>}
                  </div>
                  <div className="rounded border p-3">
                    <div className="text-xs text-muted-foreground">Externo</div>
                    <div className="text-xl font-semibold">{fmt(r.ext.total)}</div>
                    <div className="text-xs text-muted-foreground">última: {rel(r.ext.last_at)}</div>
                    {r.ext.error && <div className="text-xs text-destructive mt-1">{r.ext.error}</div>}
                  </div>
                  <div className="rounded border p-3">
                    <div className="text-xs text-muted-foreground">Delta (Cloud − Ext)</div>
                    <div className={`text-xl font-semibold flex items-center gap-1 ${
                      r.delta > 0 ? 'text-amber-600' : r.delta < 0 ? 'text-blue-600' : ''
                    }`}>
                      {r.delta > 0 ? <ArrowUp className="h-4 w-4" /> : r.delta < 0 ? <ArrowDown className="h-4 w-4" /> : null}
                      {fmt(r.delta)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.delta > 0 ? 'Cloud à frente' : r.delta < 0 ? 'Externo à frente' : 'Em paridade'}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded bg-muted p-2">
                    <div className="text-muted-foreground">Em ambos (últ. 50)</div>
                    <div className="font-semibold text-base">{r.sample.in_both}</div>
                  </div>
                  <div className="rounded bg-muted p-2">
                    <div className="text-muted-foreground">Só no Cloud</div>
                    <div className="font-semibold text-base">{r.sample.only_cloud}</div>
                  </div>
                  <div className="rounded bg-muted p-2">
                    <div className="text-muted-foreground">Só no Externo</div>
                    <div className="font-semibold text-base">{r.sample.only_ext}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs font-semibold mb-1">Triggers Cloud ({r.triggers.cloud.length})</div>
                    {r.triggers.cloud.length === 0 ? (
                      <div className="text-xs text-muted-foreground">Sem triggers — escrita vem de código (edge/cliente)</div>
                    ) : (
                      <ul className="text-xs space-y-1">
                        {r.triggers.cloud.map((t) => (
                          <li key={t.name} className="rounded bg-muted/50 p-1.5">
                            <code>{t.name}</code> <span className="text-muted-foreground">({t.when})</span>
                            <div className="text-muted-foreground truncate">{t.fn}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-semibold mb-1">Triggers Externo ({r.triggers.ext.length})</div>
                    {r.triggers.ext.length === 0 ? (
                      <div className="text-xs text-muted-foreground">Sem triggers — escrita vem de código (edge/cliente)</div>
                    ) : (
                      <ul className="text-xs space-y-1">
                        {r.triggers.ext.map((t) => (
                          <li key={t.name} className="rounded bg-muted/50 p-1.5">
                            <code>{t.name}</code> <span className="text-muted-foreground">({t.when})</span>
                            <div className="text-muted-foreground truncate">{t.fn}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                {r.detail && (
                  <div className="border-t pt-3">
                    <button
                      onClick={() => setOpenDetail((p) => ({ ...p, [r.table]: !isOpen }))}
                      className="flex items-center gap-1 text-xs font-semibold mb-2 hover:underline"
                    >
                      {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      Diagnóstico — últimas 10 linhas (campos-chave)
                    </button>
                    {isOpen && (
                      <div className="space-y-3">
                        <SamplesTable
                          title="Cloud"
                          columns={r.detail.columns}
                          rows={r.detail.cloud_rows}
                          error={r.detail.cloud_error}
                        />
                        <SamplesTable
                          title="Externo"
                          columns={r.detail.columns}
                          rows={r.detail.ext_rows}
                          error={r.detail.ext_error}
                        />
                        <p className="text-[11px] text-muted-foreground">
                          💡 Compare <code>instance_name</code>, <code>source</code>, <code>created_by</code>{' '}
                          e <code>id</code> entre Cloud e Externo. Se IDs forem diferentes mas mesmo phone/timestamp,
                          duas funções estão gravando em paralelo.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {!loading && rows.length === 0 && !err && (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">Sem dados ainda. Clique em Atualizar.</CardContent></Card>
        )}
      </div>
    </div>
  );
}
