import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import ListPagination from "@/components/processes/ListPagination";
import { db } from "@/integrations/supabase";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { PjePushEmailView } from "./PjePushEmailView";
import { Search, Mail } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

interface ProcessualEmail {
  id: string;
  gmail_message_id: string;
  inbox_label: string | null;
  subject: string | null;
  from_addr: string | null;
  snippet: string | null;
  body_text: string | null;
  received_at: string | null;
  process_number: string | null;
  created_at: string;
}

const RAILWAY_BASE =
  (import.meta as any).env?.VITE_RAILWAY_BASE_URL ||
  "https://adscore-keeper-production.up.railway.app";

const PAGE_SIZE = 25;

export default function ProcessualEmailsTab() {
  const [items, setItems] = useState<ProcessualEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillStatus, setBackfillStatus] = useState("");
  const [search, setSearch] = useState("");
  const [pushOnly, setPushOnly] = useState(true);
  const [page, setPage] = useState(1);
  const [emailView, setEmailView] = useState<{
    open: boolean; loading: boolean; subject: string | null; body: string | null; error: string | null;
  }>({ open: false, loading: false, subject: null, body: null, error: null });

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await db
      .from("processual_emails" as any)
      .select("*")
      .is("deleted_at", null)
      .order("received_at", { ascending: false, nullsFirst: false })
      .limit(2000);
    if (error) toast.error("Erro ao carregar: " + error.message);
    setItems((data || []) as any);
    setLoading(false);
  }, []);

  const hasAutoSynced = useRef(false);

  const triggerSync = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await fetch(`${RAILWAY_BASE}/functions/gmail-processual-sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": (import.meta as any).env?.VITE_RAILWAY_API_KEY || "",
        },
        body: JSON.stringify({ lookback_hours: 168, max_messages: 200 }),
      });
      const j = await r.json();
      if (!j.success) toast.error(j.error || "Falha no sync");
      else toast.success(`Sync ok — ${j.total_inserted} novo(s), ${j.total_existing} já tinha`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || String(e));
    } finally {
      setSyncing(false);
    }
  }, [load]);

  // Backfill paginado: varre TODO o histórico em lotes, seguindo o cursor
  // devolvido pelo servidor até `done`. Destrava o teto de 125 e-mails.
  const runBackfill = useCallback(async () => {
    if (!confirm("Buscar e-mails antigos: varre todo o histórico desta caixa página por página. Pode levar alguns minutos. Continuar?")) return;
    setBackfilling(true);
    let cursor: any = null;
    let totalNew = 0;
    let totalExisting = 0;
    let calls = 0;
    try {
      do {
        const r = await fetch(`${RAILWAY_BASE}/functions/gmail-processual-sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": (import.meta as any).env?.VITE_RAILWAY_API_KEY || "",
          },
          body: JSON.stringify({ backfill: true, max_messages: 150, cursor }),
        });
        const j = await r.json();
        if (!j.success) { toast.error("Backfill falhou: " + (j.error || "erro")); break; }
        totalNew += j.total_inserted || 0;
        totalExisting += j.total_existing || 0;
        calls++;
        setBackfillStatus(`Lote ${calls} · ${totalNew} novos · ${totalExisting} já tinha`);
        cursor = j.done ? null : j.cursor;
        if (j.done) {
          toast.success(`Backfill concluído — ${totalNew} novos e-mails, ${totalExisting} já existiam`);
          break;
        }
      } while (cursor && calls < 500);
      if (calls >= 500) toast.warning("Backfill interrompido no limite de 500 lotes.");
      await load();
    } catch (e: any) {
      toast.error("Erro: " + e?.message);
    } finally {
      setBackfilling(false);
      setBackfillStatus("");
    }
  }, [load]);

  useEffect(() => {
    if (!hasAutoSynced.current) {
      hasAutoSynced.current = true;
      triggerSync();
    }
  }, [triggerSync]);

  const openFullEmail = async (row: ProcessualEmail) => {
    if (row.body_text) {
      setEmailView({ open: true, loading: false, subject: row.subject, body: row.body_text, error: null });
      return;
    }
    setEmailView({ open: true, loading: true, subject: row.subject, body: null, error: null });
    try {
      const r = await fetch(`${RAILWAY_BASE}/functions/gmail-message-body`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": (import.meta as any).env?.VITE_RAILWAY_API_KEY || "",
        },
        body: JSON.stringify({ gmail_message_id: row.gmail_message_id }),
      });
      const j = await r.json();
      if (!j.success) setEmailView((s) => ({ ...s, loading: false, error: j.error || "Falha" }));
      else setEmailView({
        open: true, loading: false,
        subject: j.subject || row.subject,
        body: j.body_text || j.snippet || "(sem corpo)", error: null,
      });
    } catch (e: any) {
      setEmailView((s) => ({ ...s, loading: false, error: e?.message || String(e) }));
    }
  };

  const filtered = useMemo(() => {
    let list = items;
    if (pushOnly) {
      list = list.filter((p) =>
        (p.body_text && /PUSH/i.test(p.body_text)) ||
        (p.snippet && /PUSH/i.test(p.snippet)) ||
        (p.subject && /PUSH/i.test(p.subject))
      );
    }
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((p) =>
      p.subject?.toLowerCase().includes(q) ||
      p.from_addr?.toLowerCase().includes(q) ||
      p.snippet?.toLowerCase().includes(q) ||
      p.process_number?.toLowerCase().includes(q)
    );
  }, [items, search, pushOnly]);

  useEffect(() => { setPage(1); }, [search, pushOnly]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por assunto, remetente, nº de processo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="push-only"
              checked={pushOnly}
              onCheckedChange={setPushOnly}
            />
            <label htmlFor="push-only" className="text-sm cursor-pointer select-none">
              Apenas PUSH
            </label>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Carregando e-mails...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {search ? "Nenhum e-mail encontrado." : "Nenhum e-mail processual encontrado."}
        </div>
      ) : (
        <div className="grid gap-2">
          {paged.map((p) => (
            <Card key={p.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => openFullEmail(p)}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Mail className="h-4 w-4 shrink-0 text-primary" />
                      <span className="font-medium truncate">{p.subject || "(sem assunto)"}</span>
                      {(() => {
                        const haystack = `${p.subject || ""} ${p.snippet || ""} ${p.body_text || ""}`;
                        const hasDeadline = /\bprazo\b|intima(ç|c)(ã|a)o|intimad[oa]|ci(ê|e)ncia|dias?\s+(úteis|uteis|para)|fluir.{0,20}prazo/i.test(haystack);
                        return hasDeadline ? (
                          <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 border-0 text-xs">
                            Prazo
                          </Badge>
                        ) : null;
                      })()}
                      {p.process_number && (
                        <Badge variant="outline" className="font-mono text-xs">{p.process_number}</Badge>
                      )}
                    </div>
                    {p.from_addr && (
                      <p className="text-xs text-muted-foreground truncate">De: {p.from_addr}</p>
                    )}
                    {p.snippet && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{p.snippet}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {p.received_at ? format(new Date(p.received_at), "dd/MM/yyyy HH:mm") : "—"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ListPagination page={page} totalPages={totalPages} onPageChange={setPage} />
        <p className="text-xs text-muted-foreground sm:text-right">
          {filtered.length === 0
            ? "0 e-mails"
            : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, filtered.length)} de ${filtered.length}`}
        </p>
      </div>

      <Dialog open={emailView.open} onOpenChange={(o) => !o && setEmailView({ open: false, loading: false, subject: null, body: null, error: null })}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">{emailView.subject || "E-mail"}</DialogTitle>
          </DialogHeader>
          {emailView.loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Carregando...</div>
          ) : emailView.error ? (
            <div className="py-4 text-sm text-destructive">{emailView.error}</div>
          ) : (
            <PjePushEmailView body={emailView.body || ""} />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailView({ open: false, loading: false, subject: null, body: null, error: null })}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
