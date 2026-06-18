import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import ListPagination from "@/components/processes/ListPagination";
import { db } from "@/integrations/supabase";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, Mail, RefreshCw } from "lucide-react";
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
      .limit(500);
    if (error) toast.error("Erro ao carregar: " + error.message);
    setItems((data || []) as any);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const triggerSync = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await fetch(`${RAILWAY_BASE}/functions/gmail-processual-sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": (import.meta as any).env?.VITE_RAILWAY_API_KEY || "",
        },
        body: JSON.stringify({ lookback_hours: 168, max_messages: 100 }),
      });
      const j = await r.json();
      if (!j.success) toast.error(j.error || "Falha no sync");
      else toast.success(`Sync ok — ${j.total_inserted} novo(s), ${j.total_skipped} ignorado(s)`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || String(e));
    } finally {
      setSyncing(false);
    }
  };

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
          <Button onClick={triggerSync} disabled={syncing} variant="outline" size="sm" className="gap-2">
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizando..." : "Sincronizar agora"}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Carregando e-mails...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {search ? "Nenhum e-mail encontrado." : "Nenhum e-mail processual ainda. Use \"Sincronizar agora\"."}
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
            <pre className="whitespace-pre-wrap text-sm font-sans">{emailView.body}</pre>
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
