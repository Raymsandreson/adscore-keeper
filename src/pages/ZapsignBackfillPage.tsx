import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, FileSearch } from "lucide-react";
import { toast } from "sonner";

interface SummaryRow {
  doc_token: string;
  template_name: string | null;
  signer_name: string | null;
  signer_phone: string | null;
  status: string;
  outcome: string;
  lead_id?: string | null;
  groups_linked?: number;
  group_create_dispatched?: boolean;
  reason?: string;
}

interface MissingTemplate {
  template_token: string;
  template_name: string | null;
  docs_count: number;
}

interface BackfillResult {
  success: boolean;
  from_date?: string;
  instance?: string;
  scanned?: number;
  counts?: Record<string, number>;
  missing_templates?: MissingTemplate[];
  summary?: SummaryRow[];
  errors?: Array<{ doc_token?: string; error: string }>;
  error?: string;
}

const OUTCOME_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  lead_created: { label: "Lead criado", variant: "default" },
  lead_updated: { label: "Lead atualizado", variant: "secondary" },
  lead_linked_existing: { label: "Já existia", variant: "outline" },
  skipped_no_phone: { label: "Sem telefone", variant: "outline" },
  skipped_no_template_mapping: { label: "Template não mapeado", variant: "outline" },
  skipped_already_processed: { label: "Já processado", variant: "outline" },
  error: { label: "Erro", variant: "destructive" },
};

export default function ZapsignBackfillPage() {
  const [running, setRunning] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [limit, setLimit] = useState(200);
  const [result, setResult] = useState<BackfillResult | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("zapsign-backfill-from-2026", {
        body: { dry_run: dryRun, limit },
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
          <CardTitle>Executar</CardTitle>
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
              ⚠ Modo real: vai criar leads, vincular grupos e disparar criação de grupos novos.
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
            <CardContent>
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

          {(result.missing_templates?.length || 0) > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Templates sem mapeamento</CardTitle>
                <CardDescription>
                  Esses templates da ZapSign não estão vinculados a nenhum funil em
                  <code className="mx-1 bg-muted px-1 rounded">kanban_boards.zapsign_template_id</code>.
                  Mapeie-os pra que esses contratos sejam processados na próxima rodada.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-2">Template</th>
                      <th className="py-2">Token</th>
                      <th className="py-2 text-right">Contratos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.missing_templates!.map((t) => (
                      <tr key={t.template_token} className="border-b">
                        <td className="py-2">{t.template_name || "—"}</td>
                        <td className="py-2 font-mono text-xs">{t.template_token}</td>
                        <td className="py-2 text-right">{t.docs_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

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
                    <th className="py-2 px-2">Template</th>
                    <th className="py-2 px-2">Signatário</th>
                    <th className="py-2 px-2">Telefone</th>
                    <th className="py-2 px-2">Status</th>
                    <th className="py-2 px-2">Resultado</th>
                    <th className="py-2 px-2 text-center">Grupos</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.summary || []).map((r) => {
                    const meta = OUTCOME_LABELS[r.outcome] || { label: r.outcome, variant: "outline" as const };
                    return (
                      <tr key={r.doc_token} className="border-b hover:bg-muted/30">
                        <td className="py-2 px-2 font-mono text-xs">{r.doc_token.slice(0, 8)}…</td>
                        <td className="py-2 px-2">{r.template_name || "—"}</td>
                        <td className="py-2 px-2">{r.signer_name || "—"}</td>
                        <td className="py-2 px-2">{r.signer_phone || "—"}</td>
                        <td className="py-2 px-2">{r.status}</td>
                        <td className="py-2 px-2">
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                          {r.reason && <div className="text-xs text-muted-foreground mt-1">{r.reason}</div>}
                        </td>
                        <td className="py-2 px-2 text-center">
                          {r.groups_linked ? `${r.groups_linked} vinculado(s)` : r.group_create_dispatched ? "criação disparada" : "—"}
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
