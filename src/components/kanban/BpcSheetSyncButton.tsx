import { useState } from "react";
import { Download, Loader2, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cloudFunctions } from "@/lib/functionRouter";
import { useToast } from "@/hooks/use-toast";

interface Props {
  boardId: string;
  /** Disparado depois de uma sincronização real (não dry-run) que tenha criado leads. */
  onCreated?: () => void;
  /** ID da planilha do Google Sheets. Se omitido, o backend usa a BPC-LOAS. */
  spreadsheetId?: string;
  /** Rótulo curto do funil pra exibir no diálogo (ex: "BPC", "Auxílio Acidente"). */
  label?: string;
}

type SyncResult = {
  success: boolean;
  dry_run?: boolean;
  total_rows_in_sheet?: number;
  recent_rows?: number;
  unique_recent?: number;
  already_in_board?: number;
  would_create?: number;
  created?: number;
  errors_count?: number;
  by_operator?: Record<string, number>;
  tab_errors?: Array<{ tab: string; error: string }>;
  errors?: Array<{ row: string; error: string }>;
  sample?: Array<{ name: string; phone: string; operator: string; created_at: string }>;
  error?: string;
};

const SINCE_OPTIONS = [
  { value: 7, label: "Últimos 7 dias" },
  { value: 30, label: "Últimos 30 dias" },
  { value: 90, label: "Últimos 90 dias" },
];

export function BpcSheetSyncButton({ boardId, onCreated, spreadsheetId, label }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [sinceDays, setSinceDays] = useState<number>(7);
  const [lastRunAt, setLastRunAt] = useState<Date | null>(null);

  async function run(dryRun: boolean) {
    setRunning(true);
    setResult(null);
    try {
      const { data, error: invokeErr } = await cloudFunctions.invoke<SyncResult>("bpc-sheet-sync", {
        body: {
          board_id: boardId,
          since_days: sinceDays,
          dry_run: dryRun,
          ...(spreadsheetId ? { spreadsheet_id: spreadsheetId } : {}),
        },
      });
      if (invokeErr) throw invokeErr;
      setResult(data);
      setLastRunAt(new Date());
      if (data?.success && !dryRun && (data.created || 0) > 0) {
        toast({
          title: "Sincronização concluída",
          description: `${data.created} lead(s) criados a partir da planilha.`,
        });
        onCreated?.();
      } else if (data?.success && !dryRun) {
        toast({
          title: "Nada novo",
          description: "A planilha não tem leads novos pra criar.",
        });
      } else if (!data?.success) {
        toast({
          title: "Falha na sincronização",
          description: data?.error || "Erro desconhecido.",
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "Erro ao sincronizar",
        description: err instanceof Error ? err.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5"
        title="Importar leads novos da planilha do Meta Ads"
      >
        <Download className="h-3.5 w-3.5" />
        Sincronizar planilha
        {lastRunAt && (
          <span className="text-[10px] text-muted-foreground ml-1">
            · {lastRunAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </Button>

      <Dialog open={open} onOpenChange={(v) => !running && setOpen(v)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Sincronizar planilha {label ?? "BPC"}</DialogTitle>
            <DialogDescription>
              Lê a planilha do Meta Ads (abas por acolhedor) e cria leads novos na
              primeira etapa do funil. Linhas que já existem (mesmo telefone) são ignoradas.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Janela de tempo</label>
              <div className="flex gap-1.5 flex-wrap">
                {SINCE_OPTIONS.map((o) => (
                  <Button
                    key={o.value}
                    type="button"
                    variant={sinceDays === o.value ? "default" : "outline"}
                    size="sm"
                    disabled={running}
                    onClick={() => setSinceDays(o.value)}
                  >
                    {o.label}
                  </Button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground italic">
                Só importa leads cadastrados na planilha dentro dessa janela.
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={running}
                onClick={() => run(true)}
                className="gap-1.5"
              >
                {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Pré-visualizar (sem criar)
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={running}
                onClick={() => run(false)}
                className="gap-1.5"
              >
                {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                Importar agora
              </Button>
            </div>

            {result && (
              <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-xs">
                <div className="flex items-center gap-1.5 font-semibold">
                  {result.success ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-destructive" />
                  )}
                  {result.dry_run ? "Pré-visualização" : "Resultado"}
                  {result.success ? (
                    <Badge variant="outline" className="ml-1">OK</Badge>
                  ) : (
                    <Badge variant="destructive" className="ml-1">Falha</Badge>
                  )}
                </div>

                {!result.success && (
                  <p className="text-destructive">{result.error}</p>
                )}

                {result.success && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <Stat label="Linhas na planilha" value={result.total_rows_in_sheet ?? 0} />
                    <Stat label="No período" value={result.recent_rows ?? 0} />
                    <Stat label="Únicos (sem duplicar)" value={result.unique_recent ?? 0} />
                    <Stat label="Já existem no board" value={result.already_in_board ?? 0} />
                    <Stat
                      label={result.dry_run ? "Seriam criados" : "Criados"}
                      value={result.dry_run ? (result.would_create ?? 0) : (result.created ?? 0)}
                      highlight
                    />
                    <Stat label="Erros" value={result.errors_count ?? 0} />
                  </div>
                )}

                {result.by_operator && Object.keys(result.by_operator).length > 0 && (
                  <div>
                    <div className="font-medium mb-1">Por acolhedor:</div>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(result.by_operator).map(([op, n]) => (
                        <Badge key={op} variant="secondary" className="text-[10px]">
                          {op}: {n}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {result.sample && result.sample.length > 0 && (
                  <details className="text-[11px]">
                    <summary className="cursor-pointer text-muted-foreground">
                      Amostra ({result.sample.length})
                    </summary>
                    <ul className="mt-1 space-y-0.5 pl-2">
                      {result.sample.map((s, i) => (
                        <li key={i}>
                          {s.name} — {s.phone} <span className="text-muted-foreground">({s.operator})</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {result.tab_errors && result.tab_errors.length > 0 && (
                  <details className="text-[11px]">
                    <summary className="cursor-pointer text-amber-700">
                      Abas com erro ({result.tab_errors.length})
                    </summary>
                    <ul className="mt-1 space-y-0.5 pl-2">
                      {result.tab_errors.map((e, i) => (
                        <li key={i}>
                          <span className="font-medium">{e.tab}:</span> {e.error}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {result.errors && result.errors.length > 0 && (
                  <details className="text-[11px]">
                    <summary className="cursor-pointer text-destructive">
                      Linhas que falharam ({result.errors.length})
                    </summary>
                    <ul className="mt-1 space-y-0.5 pl-2">
                      {result.errors.map((e, i) => (
                        <li key={i}>
                          <span className="font-medium">{e.row}:</span> {e.error}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={running}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div
      className={
        "rounded-sm border bg-background px-2 py-1 " +
        (highlight ? "border-primary/60 bg-primary/5" : "border-border/50")
      }
    >
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={"text-base font-semibold tabular-nums " + (highlight ? "text-primary" : "")}>
        {value}
      </div>
    </div>
  );
}
