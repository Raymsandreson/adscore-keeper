import { useState, useEffect, useMemo } from "react";
import { db } from "@/integrations/supabase";
import { authClient } from "@/integrations/supabase";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Search, Mail, Link2, Unlink, ChevronDown, RefreshCw, AlertCircle, Clock,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

interface InssProcess {
  id: string;
  requerimento_number: string;
  current_status: string | null;
  benefit_type: string | null;
  cpf_segurado: string | null;
  nome_segurado: string | null;
  case_id: string | null;
  lead_id: string | null;
  last_email_at: string | null;
  last_email_subject: string | null;
  created_at: string;
}

interface InssHistoryRow {
  id: string;
  from_status: string | null;
  to_status: string | null;
  email_subject: string | null;
  email_received_at: string | null;
  notified: boolean;
}

interface CaseOption {
  id: string;
  case_number: string;
  title: string;
  lead_id: string | null;
}

const RAILWAY_BASE =
  (import.meta as any).env?.VITE_RAILWAY_BASE_URL ||
  "https://adscore-railway-production.up.railway.app";

const statusVariant = (s?: string | null) => {
  const v = (s || "").toLowerCase();
  if (v.includes("exig")) return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
  if (v.includes("conclu")) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
  if (v.includes("inde")) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  if (v.includes("pend") || v.includes("anali")) return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
  return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
};

export default function InssAdminProcessesTab() {
  const [processes, setProcesses] = useState<InssProcess[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [showOnlyOrphans, setShowOnlyOrphans] = useState(false);
  const [historyByProc, setHistoryByProc] = useState<Record<string, InssHistoryRow[]>>({});
  const [linkingProc, setLinkingProc] = useState<InssProcess | null>(null);

  // Dialog state
  const [caseSearch, setCaseSearch] = useState("");
  const [caseOptions, setCaseOptions] = useState<CaseOption[]>([]);
  const [linkingBusy, setLinkingBusy] = useState(false);

  // Auth UUID for linked_by
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await authClient.auth.getUser();
      setUserId(data.user?.id || null);
    })();
    loadProcesses();
  }, []);

  const loadProcesses = async () => {
    setLoading(true);
    const { data, error } = await db
      .from("inss_admin_processes" as any)
      .select("*")
      .is("deleted_at", null)
      .order("last_email_at", { ascending: false, nullsFirst: false });
    if (error) toast.error("Erro ao carregar: " + error.message);
    setProcesses((data || []) as any);
    setLoading(false);
  };

  const loadHistory = async (procId: string) => {
    if (historyByProc[procId]) return;
    const { data } = await db
      .from("inss_status_history" as any)
      .select("id, from_status, to_status, email_subject, email_received_at, notified")
      .eq("process_id", procId)
      .order("email_received_at", { ascending: false });
    setHistoryByProc((prev) => ({ ...prev, [procId]: (data || []) as any }));
  };

  const filtered = useMemo(() => {
    let list = processes;
    if (showOnlyOrphans) list = list.filter((p) => !p.case_id);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.requerimento_number?.toLowerCase().includes(q) ||
          p.nome_segurado?.toLowerCase().includes(q) ||
          p.cpf_segurado?.toLowerCase().includes(q) ||
          p.current_status?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [processes, search, showOnlyOrphans]);

  const orphanCount = processes.filter((p) => !p.case_id).length;

  const triggerSync = async () => {
    setSyncing(true);
    try {
      const resp = await fetch(`${RAILWAY_BASE}/functions/gmail-inss-sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": (import.meta as any).env?.VITE_RAILWAY_API_KEY || "",
        },
        body: JSON.stringify({ lookback_hours: 48, max_messages: 100 }),
      });
      const j = await resp.json();
      if (j.success) {
        toast.success(
          `Sync OK — ${j.new || 0} novos emails, ${j.created_processes || 0} processos criados`,
        );
        loadProcesses();
      } else {
        toast.error("Sync falhou: " + (j.error || "erro desconhecido"));
      }
    } catch (e: any) {
      toast.error("Erro: " + e.message);
    } finally {
      setSyncing(false);
    }
  };

  // Busca casos pelo termo
  useEffect(() => {
    if (!linkingProc) return;
    const q = caseSearch.trim();
    const run = async () => {
      let query = db
        .from("legal_cases" as any)
        .select("id, case_number, title, lead_id")
        .order("created_at", { ascending: false })
        .limit(20);
      if (q) {
        query = query.or(`case_number.ilike.%${q}%,title.ilike.%${q}%`);
      }
      const { data } = await query;
      setCaseOptions((data || []) as any);
    };
    const t = setTimeout(run, 200);
    return () => clearTimeout(t);
  }, [linkingProc, caseSearch]);

  const linkToCase = async (caseOpt: CaseOption) => {
    if (!linkingProc) return;
    setLinkingBusy(true);
    try {
      const { error } = await db
        .from("inss_admin_processes" as any)
        .update({
          case_id: caseOpt.id,
          lead_id: caseOpt.lead_id,
          linked_at: new Date().toISOString(),
          linked_by: userId,
        })
        .eq("id", linkingProc.id);
      if (error) throw error;
      toast.success("Processo vinculado ao caso " + caseOpt.case_number);

      // Dispara notificação retroativa
      fetch(`${RAILWAY_BASE}/functions/notify-inss-update`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": (import.meta as any).env?.VITE_RAILWAY_API_KEY || "",
        },
        body: JSON.stringify({ process_id: linkingProc.id }),
      }).catch(() => {});

      setLinkingProc(null);
      setCaseSearch("");
      loadProcesses();
    } catch (e: any) {
      toast.error("Erro ao vincular: " + e.message);
    } finally {
      setLinkingBusy(false);
    }
  };

  const unlink = async (p: InssProcess) => {
    if (!confirm(`Desvincular requerimento ${p.requerimento_number} do caso?`)) return;
    const { error } = await db
      .from("inss_admin_processes" as any)
      .update({ case_id: null, lead_id: null, linked_at: null, linked_by: null })
      .eq("id", p.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Desvinculado");
      loadProcesses();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant={showOnlyOrphans ? "default" : "outline"}
            size="sm"
            onClick={() => setShowOnlyOrphans((v) => !v)}
            className="gap-2"
          >
            <AlertCircle className="h-4 w-4" />
            Órfãos
            {orphanCount > 0 && (
              <Badge variant="destructive" className="ml-1">{orphanCount}</Badge>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={triggerSync}
            disabled={syncing}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizando..." : "Sincronizar agora"}
          </Button>
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por requerimento, CPF, nome..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Mail className="h-8 w-8 mx-auto mb-2 opacity-50" />
          {processes.length === 0
            ? "Nenhum email do INSS processado ainda. Clique em \"Sincronizar agora\" pra rodar a 1ª vez."
            : "Nenhum resultado para esse filtro."}
        </div>
      ) : (
        <div className="grid gap-2">
          {filtered.map((p) => (
            <Card key={p.id} className={!p.case_id ? "border-orange-300 dark:border-orange-700" : ""}>
              <CardContent className="p-3">
                <Collapsible onOpenChange={(open) => open && loadHistory(p.id)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-semibold">{p.requerimento_number}</span>
                        <Badge className={statusVariant(p.current_status)}>
                          {p.current_status || "—"}
                        </Badge>
                        {!p.case_id && (
                          <Badge variant="outline" className="border-orange-400 text-orange-700 dark:text-orange-300">
                            Órfão
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        {p.nome_segurado && <div>👤 {p.nome_segurado}</div>}
                        {p.cpf_segurado && <div>CPF: {p.cpf_segurado}</div>}
                        {p.benefit_type && <div>Benefício: {p.benefit_type}</div>}
                        {p.last_email_at && (
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {format(new Date(p.last_email_at), "dd/MM/yyyy HH:mm")}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      {p.case_id ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => unlink(p)}
                          className="gap-1 h-7"
                          title="Desvincular"
                        >
                          <Unlink className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => setLinkingProc(p)}
                          className="gap-1 h-7"
                        >
                          <Link2 className="h-3.5 w-3.5" />
                          Vincular
                        </Button>
                      )}
                      <CollapsibleTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-7 gap-1">
                          <ChevronDown className="h-3.5 w-3.5" />
                          Histórico
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                  </div>
                  <CollapsibleContent className="mt-3 pt-3 border-t">
                    <div className="space-y-1.5">
                      {(historyByProc[p.id] || []).map((h) => (
                        <div key={h.id} className="text-xs flex items-center gap-2">
                          <span className="text-muted-foreground">
                            {h.email_received_at ? format(new Date(h.email_received_at), "dd/MM HH:mm") : "—"}
                          </span>
                          <Badge variant="outline" className={statusVariant(h.to_status)}>
                            {h.from_status || "?"} → {h.to_status || "?"}
                          </Badge>
                          {h.notified && <span className="text-green-600">✓ notificado</span>}
                        </div>
                      ))}
                      {(historyByProc[p.id]?.length ?? 0) === 0 && (
                        <div className="text-xs text-muted-foreground">Sem histórico.</div>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground text-right">
        {filtered.length} de {processes.length} processo(s) administrativo(s)
      </p>

      {/* Dialog de vínculo */}
      <Dialog open={!!linkingProc} onOpenChange={(open) => !open && setLinkingProc(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Vincular {linkingProc?.requerimento_number} a um caso</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Buscar caso por número ou título..."
              value={caseSearch}
              onChange={(e) => setCaseSearch(e.target.value)}
              autoFocus
            />
            <div className="max-h-80 overflow-y-auto space-y-1">
              {caseOptions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="w-full text-left p-2 rounded hover:bg-muted text-sm border"
                  disabled={linkingBusy}
                  onClick={() => linkToCase(c)}
                >
                  <div className="font-medium">{c.case_number}</div>
                  <div className="text-xs text-muted-foreground">{c.title}</div>
                </button>
              ))}
              {caseOptions.length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-4">
                  Nenhum caso encontrado.
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkingProc(null)}>
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
