import { useEffect, useMemo, useState } from "react";
import { externalSupabase, ensureExternalSession } from "@/integrations/supabase/external-client";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Play, RefreshCw, FileSearch, Target, AlertTriangle, CheckCircle2, Link2 } from "lucide-react";
import { toast } from "sonner";
import { OperationalDetailSheet, type OperationalMetricType } from "@/components/whatsapp/agent-monitor/components/OperationalDetailSheet";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";

interface SyncState {
  last_page: number;
  last_doc_token: string | null;
  last_run_at: string | null;
  total_processed: number;
}
interface SyncRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  mode: string;
  from_page: number | null;
  to_page: number | null;
  pages_scanned: number;
  docs_scanned: number;
  counts: Record<string, number>;
  errors: any[];
  dry_run: boolean;
  status: string;
}
interface RunResult {
  success: boolean;
  dry_run?: boolean;
  mode?: string;
  from_page?: number;
  to_page?: number;
  counts?: Record<string, number>;
  errors?: any[];
  summary?: any[];
  error?: string;
  checkpoint?: { last_page: number; last_doc_token: string | null };
}

const TARGET_LINK_RATE = 95;

export default function ZapsignSyncPage() {
  const [tab, setTab] = useState("dashboard");
  const [state, setState] = useState<SyncState | null>(null);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [maxPages, setMaxPages] = useState(3);
  const [mode, setMode] = useState<"incremental" | "restart" | "window">("incremental");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "signed" | "pending" | "refused">("");
  const [templateFilter, setTemplateFilter] = useState("");
  const [instanceFilter, setInstanceFilter] = useState("");

  // Funnel rules state
  const [rules, setRules] = useState<any[]>([]);
  const [boards, setBoards] = useState<any[]>([]);
  const [editingRule, setEditingRule] = useState<any | null>(null);

  async function loadRules() {
    try {
      await ensureExternalSession();
      const [rs, bs] = await Promise.all([
        externalSupabase.from("zapsign_funnel_rules" as any).select("*").order("priority", { ascending: true }),
        externalSupabase.from("kanban_boards" as any).select("id, name, stages").order("name"),
      ]);
      if (rs.data) setRules(rs.data as any);
      if (bs.data) setBoards(bs.data as any);
    } catch (e) { console.warn("loadRules", e); }
  }

  async function saveRule(r: any) {
    try {
      await ensureExternalSession();
      const payload = { ...r };
      delete payload.id;
      if (r.id) {
        await externalSupabase.from("zapsign_funnel_rules" as any).update(payload).eq("id", r.id);
      } else {
        await externalSupabase.from("zapsign_funnel_rules" as any).insert(payload);
      }
      toast.success("Regra salva");
      setEditingRule(null);
      loadRules();
    } catch (e: any) { toast.error(e?.message || "Erro ao salvar"); }
  }

  async function deleteRule(id: string) {
    if (!confirm("Excluir regra?")) return;
    await externalSupabase.from("zapsign_funnel_rules" as any).delete().eq("id", id);
    loadRules();
  }

  async function loadState() {
    try {
      await ensureExternalSession();
      const [s, r] = await Promise.all([
        externalSupabase.from("zapsign_sync_state" as any).select("*").eq("id", true).maybeSingle(),
        externalSupabase.from("zapsign_sync_runs" as any).select("*").order("started_at", { ascending: false }).limit(30),
      ]);
      if (s.data) setState(s.data as any);
      if (r.data) setRuns(r.data as any);
    } catch (e: any) {
      console.warn("loadState", e);
    }
  }

  useEffect(() => { loadState(); loadRules(); }, []);

  async function run() {
    setRunning(true); setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("zapsign-bulk-sync", {
        body: {
          dry_run: dryRun,
          mode,
          max_pages: maxPages,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          status: statusFilter || undefined,
          template_id: templateFilter || undefined,
          instance_name: instanceFilter || undefined,
        },
      });
      if (error) throw error;
      setResult(data as RunResult);
      if ((data as any)?.success) {
        toast.success(dryRun ? "Simulação concluída" : "Sync concluído");
        await loadState();
      } else {
        toast.error(`Falhou: ${(data as any)?.error || "erro"}`);
      }
    } catch (e: any) {
      toast.error(`Erro: ${e?.message || e}`);
      setResult({ success: false, error: e?.message || String(e) });
    } finally {
      setRunning(false);
    }
  }

  // KPIs derivados dos últimos 7 runs
  const last7 = runs.filter((r) => !r.dry_run).slice(0, 7);
  const totalDocs = last7.reduce((a, r) => a + (r.docs_scanned || 0), 0);
  const totalLinked = last7.reduce((a, r) => a + (r.counts?.contacts_created || 0) + (r.counts?.contacts_updated || 0), 0);
  const totalGroups = last7.reduce((a, r) => a + (r.counts?.groups_linked || 0), 0);
  const totalEnriched = last7.reduce((a, r) => a + (r.counts?.leads_enriched || 0), 0);
  const totalErrors = last7.reduce((a, r) => a + (r.counts?.errors || 0) + (r.counts?.skipped_no_phone || 0), 0);
  const linkRate = totalDocs ? Math.round((totalLinked / totalDocs) * 100) : 0;

  // 5 porquês: agrupa erros por causa
  const errorBuckets: Record<string, number> = {};
  for (const r of last7) {
    for (const e of (r.errors || [])) {
      const stage = e?.stage || "unknown";
      errorBuckets[stage] = (errorBuckets[stage] || 0) + 1;
    }
  }

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-6xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sincronização ZapSign</h1>
          <p className="text-muted-foreground mt-1">
            PDCA de vinculação de documentos ao CRM • Meta: <strong>≥ {TARGET_LINK_RATE}%</strong> de vinculação
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadState}>
          <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="dashboard">📊 Dashboard</TabsTrigger>
          <TabsTrigger value="execute">⚡ Executar Lote</TabsTrigger>
          <TabsTrigger value="rules">🎯 Regras de Funil</TabsTrigger>
          <TabsTrigger value="history">📜 Histórico</TabsTrigger>
        </TabsList>

        {/* DASHBOARD ---- */}
        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Kpi label="Docs (7d)" value={totalDocs} icon={<FileSearch className="h-4 w-4" />} />
            <Kpi label="Contatos" value={totalLinked} icon={<Link2 className="h-4 w-4" />} />
            <Kpi label="Leads enriq." value={totalEnriched} icon={<CheckCircle2 className="h-4 w-4" />} />
            <Kpi label="Grupos WA" value={totalGroups} icon={<Link2 className="h-4 w-4" />} />
            <Kpi label="Erros" value={totalErrors} icon={<AlertTriangle className="h-4 w-4" />} variant="destructive" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Target className="h-5 w-5" /> Meta de vinculação</CardTitle>
              <CardDescription>Taxa = contatos vinculados/criados ÷ docs processados (últimos 7 runs)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-3">
                <div className="text-4xl font-bold">{linkRate}%</div>
                <Badge variant={linkRate >= TARGET_LINK_RATE ? "default" : "destructive"}>
                  Meta: {TARGET_LINK_RATE}%
                </Badge>
              </div>
              <div className="mt-3 h-3 rounded bg-muted overflow-hidden">
                <div
                  className={`h-full ${linkRate >= TARGET_LINK_RATE ? "bg-green-500" : "bg-orange-500"}`}
                  style={{ width: `${Math.min(100, linkRate)}%` }}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Checkpoint atual</CardTitle>
              <CardDescription>Próxima execução incremental continua daqui</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div>Página: <strong>{state?.last_page ?? 1}</strong></div>
              <div>Último doc: <code className="text-xs">{state?.last_doc_token?.slice(0, 12) || "—"}…</code></div>
              <div>Total processado: <strong>{state?.total_processed ?? 0}</strong></div>
              <div>Última execução: {state?.last_run_at ? new Date(state.last_run_at).toLocaleString("pt-BR") : "—"}</div>
            </CardContent>
          </Card>

          {Object.keys(errorBuckets).length > 0 && (
            <Card className="border-destructive/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                  Causa-raiz dos erros (5 porquês)
                </CardTitle>
                <CardDescription>Agrupado por etapa onde falhou</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {Object.entries(errorBuckets).map(([k, v]) => (
                  <Badge key={k} variant="destructive">{k}: {v}</Badge>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* EXECUTE ---- */}
        <TabsContent value="execute">
          <Card>
            <CardHeader>
              <CardTitle>Executar lote de sincronização</CardTitle>
              <CardDescription>
                Pagina docs do ZapSign, vincula contato por telefone, extrai answers (CPF/RG/CEP/...),
                anexa o PDF assinado e cruza com grupos do WhatsApp. Idempotente.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <Label>Modo</Label>
                  <select
                    className="w-full border rounded px-2 py-2 text-sm bg-background"
                    value={mode}
                    onChange={(e) => setMode(e.target.value as any)}
                  >
                    <option value="incremental">Continuar do checkpoint</option>
                    <option value="restart">Reiniciar do zero</option>
                    <option value="window">Janela de data (não move checkpoint)</option>
                  </select>
                </div>
                <div>
                  <Label>Páginas máx</Label>
                  <Input type="number" min={1} max={20} value={maxPages}
                    onChange={(e) => setMaxPages(Math.max(1, Math.min(20, +e.target.value || 1)))} />
                </div>
                <div>
                  <Label>Status</Label>
                  <select
                    className="w-full border rounded px-2 py-2 text-sm bg-background"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
                  >
                    <option value="">Todos</option>
                    <option value="signed">Assinados</option>
                    <option value="pending">Pendentes</option>
                    <option value="refused">Recusados</option>
                  </select>
                </div>
                {mode === "window" && (
                  <>
                    <div>
                      <Label>De</Label>
                      <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                    </div>
                    <div>
                      <Label>Até</Label>
                      <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                    </div>
                  </>
                )}
                <div>
                  <Label>Template ID (ZapSign)</Label>
                  <Input value={templateFilter} onChange={(e) => setTemplateFilter(e.target.value)} placeholder="opcional" />
                </div>
                <div>
                  <Label>Instância WhatsApp</Label>
                  <Input value={instanceFilter} onChange={(e) => setInstanceFilter(e.target.value)} placeholder="opcional (inferida)" />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
                Simulação (não altera dados)
              </label>

              <Button onClick={run} disabled={running} size="lg">
                {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                {running ? "Processando..." : dryRun ? "Simular" : "Executar"}
              </Button>

              {!dryRun && (
                <p className="text-xs text-destructive">
                  ⚠ Modo real: cria/atualiza contatos, enriquece leads, salva docs e vincula grupos.
                </p>
              )}
            </CardContent>
          </Card>

          {result && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Resultado</CardTitle>
                <CardDescription>
                  {result.success
                    ? `${result.mode} • páginas ${result.from_page}-${result.to_page}`
                    : "Falhou"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.error && (
                  <pre className="text-xs bg-destructive/10 text-destructive p-3 rounded">{result.error}</pre>
                )}
                <div className="flex flex-wrap gap-2">
                  {Object.entries(result.counts || {}).map(([k, v]) => (
                    <Badge key={k} variant="outline">{k}: {v}</Badge>
                  ))}
                </div>
                {(result.summary?.length || 0) > 0 && (
                  <div className="overflow-auto max-h-96">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b">
                        <th className="text-left p-1">Doc</th>
                        <th className="text-left p-1">Signatário</th>
                        <th className="text-left p-1">Telefone</th>
                        <th className="text-left p-1">Resultado</th>
                        <th className="text-left p-1">Grupo</th>
                      </tr></thead>
                      <tbody>
                        {result.summary!.map((s) => (
                          <tr key={s.doc_token} className="border-b hover:bg-muted/40">
                            <td className="p-1 font-mono">{s.doc_token.slice(0, 8)}…</td>
                            <td className="p-1">{s.signer_name || "—"}</td>
                            <td className="p-1">{s.signer_phone || "—"}</td>
                            <td className="p-1">
                              <Badge variant={s.outcome === "linked" ? "default" : s.outcome === "error" ? "destructive" : "outline"}>
                                {s.outcome}
                              </Badge>
                            </td>
                            <td className="p-1">{s.group_jid ? "✓" : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* HISTORY ---- */}
        {/* RULES ---- */}
        <TabsContent value="rules" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Regras de criação de Lead por Funil</CardTitle>
                <CardDescription>
                  Quando um documento bate com filtros (status, template, instância), cria um lead no funil/etapa configurado.
                </CardDescription>
              </div>
              <Button size="sm" onClick={() => setEditingRule({ name: "", active: true, priority: 100, status_filter: "signed", board_id: "", stage_id: "", skip_if_contact_has_lead: true, inherit_lead_fields: true })}>
                Nova regra
              </Button>
            </CardHeader>
            <CardContent className="overflow-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b">
                  <th className="text-left p-2">Nome</th>
                  <th className="text-left p-2">Prio</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Template</th>
                  <th className="text-left p-2">Instância</th>
                  <th className="text-left p-2">Funil</th>
                  <th className="text-left p-2">Ativa</th>
                  <th></th>
                </tr></thead>
                <tbody>
                  {rules.map((r) => {
                    const board = boards.find((b) => b.id === r.board_id);
                    return (
                      <tr key={r.id} className="border-b hover:bg-muted/40">
                        <td className="p-2">{r.name}</td>
                        <td className="p-2">{r.priority}</td>
                        <td className="p-2">{r.status_filter || "—"}</td>
                        <td className="p-2 text-xs">{r.template_id || r.template_name_pattern || "—"}</td>
                        <td className="p-2">{r.instance_name || "—"}</td>
                        <td className="p-2">{board?.name || r.board_id?.slice(0, 8)}</td>
                        <td className="p-2"><Badge variant={r.active ? "default" : "outline"}>{r.active ? "sim" : "não"}</Badge></td>
                        <td className="p-2 text-right">
                          <Button size="sm" variant="ghost" onClick={() => setEditingRule(r)}>Editar</Button>
                          <Button size="sm" variant="ghost" onClick={() => deleteRule(r.id)}>X</Button>
                        </td>
                      </tr>
                    );
                  })}
                  {rules.length === 0 && (
                    <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">Nenhuma regra cadastrada</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {editingRule && (
            <Card className="border-primary">
              <CardHeader>
                <CardTitle>{editingRule.id ? "Editar regra" : "Nova regra"}</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><Label>Nome</Label><Input value={editingRule.name || ""} onChange={(e) => setEditingRule({ ...editingRule, name: e.target.value })} /></div>
                <div><Label>Prioridade</Label><Input type="number" value={editingRule.priority || 100} onChange={(e) => setEditingRule({ ...editingRule, priority: +e.target.value })} /></div>
                <div>
                  <Label>Status do doc</Label>
                  <select className="w-full border rounded px-2 py-2 text-sm bg-background" value={editingRule.status_filter || ""} onChange={(e) => setEditingRule({ ...editingRule, status_filter: e.target.value || null })}>
                    <option value="">qualquer</option>
                    <option value="signed">signed</option>
                    <option value="pending">pending</option>
                    <option value="refused">refused</option>
                  </select>
                </div>
                <div><Label>Template ID</Label><Input value={editingRule.template_id || ""} onChange={(e) => setEditingRule({ ...editingRule, template_id: e.target.value || null })} /></div>
                <div><Label>Template nome contém</Label><Input value={editingRule.template_name_pattern || ""} onChange={(e) => setEditingRule({ ...editingRule, template_name_pattern: e.target.value || null })} /></div>
                <div><Label>Instância (nome)</Label><Input value={editingRule.instance_name || ""} onChange={(e) => setEditingRule({ ...editingRule, instance_name: e.target.value || null })} /></div>
                <div>
                  <Label>Funil (board)</Label>
                  <select className="w-full border rounded px-2 py-2 text-sm bg-background" value={editingRule.board_id || ""} onChange={(e) => setEditingRule({ ...editingRule, board_id: e.target.value, stage_id: "" })}>
                    <option value="">selecione...</option>
                    {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Etapa</Label>
                  <select className="w-full border rounded px-2 py-2 text-sm bg-background" value={editingRule.stage_id || ""} onChange={(e) => setEditingRule({ ...editingRule, stage_id: e.target.value })}>
                    <option value="">selecione...</option>
                    {(boards.find((b) => b.id === editingRule.board_id)?.stages || []).map((s: any) => (
                      <option key={s.id} value={s.id}>{s.name || s.title || s.id}</option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editingRule.active !== false} onChange={(e) => setEditingRule({ ...editingRule, active: e.target.checked })} /> Ativa</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editingRule.skip_if_contact_has_lead !== false} onChange={(e) => setEditingRule({ ...editingRule, skip_if_contact_has_lead: e.target.checked })} /> Pular se contato já tem lead nesse funil</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editingRule.inherit_lead_fields !== false} onChange={(e) => setEditingRule({ ...editingRule, inherit_lead_fields: e.target.checked })} /> Herdar campos extraídos (CPF/RG/...)</label>
                <div className="md:col-span-2 flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => setEditingRule(null)}>Cancelar</Button>
                  <Button onClick={() => saveRule(editingRule)} disabled={!editingRule.name || !editingRule.board_id || !editingRule.stage_id}>Salvar</Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Últimas execuções</CardTitle>
              <CardDescription>Histórico para análise PDCA (Act)</CardDescription>
            </CardHeader>
            <CardContent className="overflow-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b">
                  <th className="text-left p-2">Quando</th>
                  <th className="text-left p-2">Modo</th>
                  <th className="text-left p-2">Páginas</th>
                  <th className="text-left p-2">Docs</th>
                  <th className="text-left p-2">Vinc.</th>
                  <th className="text-left p-2">Enriq.</th>
                  <th className="text-left p-2">Criados</th>
                  <th className="text-left p-2">Grupos</th>
                  <th className="text-left p-2">Erros</th>
                  <th className="text-left p-2">Status</th>
                </tr></thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b hover:bg-muted/40">
                      <td className="p-2 text-xs">{new Date(r.started_at).toLocaleString("pt-BR")}</td>
                      <td className="p-2"><Badge variant="outline">{r.mode}</Badge></td>
                      <td className="p-2">{r.pages_scanned}</td>
                      <td className="p-2">{r.docs_scanned}</td>
                      <td className="p-2">{(r.counts?.contacts_created || 0) + (r.counts?.contacts_updated || 0)}</td>
                      <td className="p-2">{r.counts?.leads_enriched || 0}</td>
                      <td className="p-2">{r.counts?.leads_created || 0}</td>
                      <td className="p-2">{r.counts?.groups_linked || 0}</td>
                      <td className="p-2">{(r.errors?.length || 0) + (r.counts?.skipped_no_phone || 0)}</td>
                      <td className="p-2">
                        <Badge variant={r.status === "done" ? "default" : "outline"}>{r.status}</Badge>
                      </td>
                    </tr>
                  ))}
                  {runs.length === 0 && (
                    <tr><td colSpan={10} className="p-4 text-center text-muted-foreground">Nenhuma execução ainda</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Kpi({ label, value, icon, variant }: { label: string; value: number; icon?: React.ReactNode; variant?: "destructive" }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon} {label}</div>
        <div className={`text-2xl font-bold mt-1 ${variant === "destructive" && value > 0 ? "text-destructive" : ""}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
