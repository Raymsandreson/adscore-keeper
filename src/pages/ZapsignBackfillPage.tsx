import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Play, FileSearch, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface KeywordRule {
  keyword: string;
  board_id: string;
}

interface SummaryRow {
  doc_token: string;
  doc_name: string | null;
  signer_name: string | null;
  signer_phone: string | null;
  status: string;
  outcome: string;
  matched_keyword?: string | null;
  board_id?: string | null;
  lead_id?: string | null;
  groups_linked?: number;
  group_create_dispatched?: boolean;
  enrich_dispatched?: boolean;
  enrich_skipped_reason?: string | null;
  reason?: string;
}

interface BackfillResult {
  success: boolean;
  dry_run?: boolean;
  from_date?: string;
  instance?: string;
  scanned?: number;
  counts?: Record<string, number>;
  summary?: SummaryRow[];
  errors?: Array<{ doc_token?: string; error: string }>;
  error?: string;
}

interface BoardOption {
  id: string;
  name: string;
}

const OUTCOME_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  lead_created: { label: "Lead criado", variant: "default" },
  lead_updated: { label: "Lead atualizado", variant: "secondary" },
  lead_linked_existing: { label: "Já existia", variant: "outline" },
  skipped_no_phone: { label: "Sem telefone", variant: "outline" },
  skipped_no_board: { label: "Sem funil compatível", variant: "outline" },
  skipped_already_processed: { label: "Já processado", variant: "outline" },
  error: { label: "Erro", variant: "destructive" },
};

const STORAGE_KEY = "zapsign_backfill_v1";

export default function ZapsignBackfillPage() {
  const [running, setRunning] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [limit, setLimit] = useState(200);
  const [boards, setBoards] = useState<BoardOption[]>([]);
  const [rules, setRules] = useState<KeywordRule[]>([{ keyword: "", board_id: "" }]);
  const [defaultBoardId, setDefaultBoardId] = useState<string>("");
  const [result, setResult] = useState<BackfillResult | null>(() => {
    // Restaura resultado anterior pra sobreviver ao HMR do Vite
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY + "_result");
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });

  // Carrega boards e estado salvo
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("kanban_boards")
        .select("id, name")
        .order("name");
      if (!error && data) setBoards(data);
    })();
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const p = JSON.parse(saved);
        if (Array.isArray(p.rules)) setRules(p.rules);
        if (typeof p.defaultBoardId === "string") setDefaultBoardId(p.defaultBoardId);
      } catch {/* ignore */}
    }
  }, []);

  // Persiste resultado pra sobreviver ao reload do dev-server
  useEffect(() => {
    try {
      if (result) sessionStorage.setItem(STORAGE_KEY + "_result", JSON.stringify(result));
      else sessionStorage.removeItem(STORAGE_KEY + "_result");
    } catch {/* ignore */}
  }, [result]);

  function persist(nextRules: KeywordRule[], nextDefault: string) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ rules: nextRules, defaultBoardId: nextDefault }));
  }

  function updateRule(idx: number, patch: Partial<KeywordRule>) {
    const next = rules.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    setRules(next);
    persist(next, defaultBoardId);
  }
  function addRule() {
    const next = [...rules, { keyword: "", board_id: "" }];
    setRules(next);
    persist(next, defaultBoardId);
  }
  function removeRule(idx: number) {
    const next = rules.filter((_, i) => i !== idx);
    setRules(next.length ? next : [{ keyword: "", board_id: "" }]);
    persist(next, defaultBoardId);
  }
  function changeDefault(v: string) {
    setDefaultBoardId(v);
    persist(rules, v);
  }

  async function run() {
    const cleanRules = rules.filter((r) => r.keyword.trim() && r.board_id);
    if (cleanRules.length === 0 && !defaultBoardId) {
      toast.error("Defina ao menos uma regra ou um funil padrão");
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("zapsign-backfill-from-2026", {
        body: {
          dry_run: dryRun,
          limit,
          keyword_rules: cleanRules,
          default_board_id: defaultBoardId || null,
        },
      });
      if (error) throw error;
      setResult(data as BackfillResult);
      if (data?.success) {
        toast.success(
          dryRun
            ? `Simulação: ${data.scanned} contratos analisados`
            : `Concluído: ${data.scanned} contratos processados`,
        );
      } else {
        toast.error(`Falhou: ${data?.error || "erro desconhecido"}`);
      }
    } catch (e: any) {
      toast.error(`Erro: ${e?.message || e}`);
      setResult({ success: false, error: e?.message || String(e) });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold">Backfill ZapSign 2026</h1>
        <p className="text-muted-foreground mt-1">
          Varre todos os contratos da ZapSign criados a partir de 01/01/2026, cria leads (signed + pending),
          e tenta vincular cada um a um grupo de WhatsApp da instância <strong>Raym</strong>. Se o
          contato não estiver em nenhum grupo, dispara a criação automática de um grupo 1:1.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. Mapeamento por palavra-chave no nome do PDF</CardTitle>
          <CardDescription>
            Os contratos não usam template — então o funil é decidido por palavras encontradas no nome do PDF
            (case-insensitive). A primeira palavra que bater define o funil. Se nenhuma bater, cai no funil padrão.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {rules.map((r, idx) => (
            <div key={idx} className="flex gap-2 items-center">
              <Input
                placeholder='Palavra (ex: "BPC", "antecipação", "aposentadoria")'
                value={r.keyword}
                onChange={(e) => updateRule(idx, { keyword: e.target.value })}
                className="flex-1"
              />
              <Select value={r.board_id} onValueChange={(v) => updateRule(idx, { board_id: v })}>
                <SelectTrigger className="w-[320px]">
                  <SelectValue placeholder="Funil destino" />
                </SelectTrigger>
                <SelectContent>
                  {boards.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon" onClick={() => removeRule(idx)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addRule}>
            <Plus className="h-4 w-4 mr-1" /> Adicionar regra
          </Button>

          <div className="pt-3 border-t">
            <label className="text-sm font-medium block mb-2">
              Funil padrão (usado quando nenhuma palavra-chave bater)
            </label>
            <Select value={defaultBoardId || "__none__"} onValueChange={(v) => changeDefault(v === "__none__" ? "" : v)}>
              <SelectTrigger className="w-[420px]">
                <SelectValue placeholder="(opcional) escolha um funil padrão" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Nenhum (ignorar contratos sem match) —</SelectItem>
                {boards.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Executar</CardTitle>
          <CardDescription>
            Comece com <strong>simulação</strong> (dry run) pra ver o que seria feito sem alterar nada.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                className="h-4 w-4"
              />
              Simulação (não altera dados)
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>Limite de contratos</span>
              <input
                type="number"
                min={1}
                max={2000}
                value={limit}
                onChange={(e) => setLimit(Math.max(1, Math.min(2000, Number(e.target.value) || 1)))}
                className="border rounded px-2 py-1 w-32"
              />
            </label>
            <Button onClick={run} disabled={running} size="lg">
              {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : dryRun ? <FileSearch className="h-4 w-4 mr-2" /> : <Play className="h-4 w-4 mr-2" />}
              {running ? "Executando..." : dryRun ? "Simular" : "Executar de verdade"}
            </Button>
          </div>
          {!dryRun && (
            <p className="text-xs text-destructive">
              ⚠ Modo real: vai criar leads no funil escolhido, vincular grupos existentes e disparar criação de grupos novos pra contratos sem grupo.
            </p>
          )}
        </CardContent>
      </Card>

      {result && !result.success && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Falhou</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-muted p-3 rounded overflow-auto">{result.error}</pre>
          </CardContent>
        </Card>
      )}

      {result?.success && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Resumo</CardTitle>
              <CardDescription>
                {result.scanned} contratos varridos a partir de {result.from_date} • instância{" "}
                <strong>{result.instance}</strong>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {result.dry_run && (
                <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-900 dark:text-yellow-200">
                  ⚠ <strong>Modo Simulação ativo</strong> — nenhum lead foi criado de verdade. Desmarque "Simulação" e clique em "Executar de verdade" para criar os leads.
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {Object.entries(result.counts || {}).map(([k, v]) => {
                  const meta = OUTCOME_LABELS[k] || { label: k, variant: "outline" as const };
                  return (
                    <Badge key={k} variant={meta.variant}>
                      {meta.label}: {v}
                    </Badge>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Detalhes por contrato</CardTitle>
              <CardDescription>{result.summary?.length || 0} linhas</CardDescription>
            </CardHeader>
            <CardContent className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 px-2">Doc</th>
                    <th className="py-2 px-2">Nome do PDF</th>
                    <th className="py-2 px-2">Signatário</th>
                    <th className="py-2 px-2">Telefone</th>
                    <th className="py-2 px-2">Status</th>
                    <th className="py-2 px-2">Match</th>
                    <th className="py-2 px-2">Resultado</th>
                    <th className="py-2 px-2 text-center">Grupos</th>
                    <th className="py-2 px-2 text-center">Enriquecimento</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.summary || []).map((r) => {
                    const meta = OUTCOME_LABELS[r.outcome] || { label: r.outcome, variant: "outline" as const };
                    return (
                      <tr key={r.doc_token} className="border-b hover:bg-muted/30">
                        <td className="py-2 px-2 font-mono text-xs">{r.doc_token.slice(0, 8)}…</td>
                        <td className="py-2 px-2 max-w-[280px] truncate" title={r.doc_name || ""}>{r.doc_name || "—"}</td>
                        <td className="py-2 px-2">{r.signer_name || "—"}</td>
                        <td className="py-2 px-2">{r.signer_phone || "—"}</td>
                        <td className="py-2 px-2">{r.status}</td>
                        <td className="py-2 px-2">{r.matched_keyword || (r.board_id ? "(padrão)" : "—")}</td>
                        <td className="py-2 px-2">
                          {r.lead_id ? (
                            <a
                              href={`/leads?tab=kanban&openLead=${r.lead_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Abrir lead em nova aba"
                            >
                              <Badge variant={meta.variant} className="cursor-pointer hover:opacity-80">
                                {meta.label} ↗
                              </Badge>
                            </a>
                          ) : (
                            <Badge variant={meta.variant}>{meta.label}</Badge>
                          )}
                          {r.lead_id && (
                            <div className="text-[10px] text-muted-foreground mt-1 font-mono">
                              {r.lead_id.slice(0, 8)}…
                            </div>
                          )}
                          {r.reason && <div className="text-xs text-muted-foreground mt-1">{r.reason}</div>}
                        </td>
                        <td className="py-2 px-2 text-center">
                          {r.groups_linked ? `${r.groups_linked} vinculado(s)` : r.group_create_dispatched ? "criação disparada" : "—"}
                        </td>
                        <td className="py-2 px-2 text-center">
                          {r.enrich_dispatched ? (
                            <Badge variant="default">disparado</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground" title={r.enrich_skipped_reason || ""}>
                              {r.enrich_skipped_reason ? "pulado" : "—"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
