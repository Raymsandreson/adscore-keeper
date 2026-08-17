import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import ListPagination from "@/components/processes/ListPagination";
import { LeadEditDialog } from "@/components/kanban/LeadEditDialog";
import InssAdminPushEmailView from "@/components/processes/InssAdminPushEmailView";
import RegistrarProtocoloDialog, {
  type RegistrarProtocoloAlvo,
} from "@/components/processes/RegistrarProtocoloDialog";
import VincularCasoDialog from "@/components/protocolos/VincularCasoDialog";
import { useLeads, type Lead } from "@/hooks/useLeads";
import { useKanbanBoards } from "@/hooks/useKanbanBoards";
import { db } from "@/integrations/supabase";
import { authClient } from "@/integrations/supabase";
import { upsertInssLeadProcess } from "@/lib/inssLeadProcess";
import {
  buscarCasosPorTexto,
  buscarSugestoesDeCaso,
  vincularProtocoloAoCaso,
  type CaseOption,
} from "@/lib/inssVinculoCaso";
import { cloudFunctions } from "@/lib/functionRouter";
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
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Search, Mail, Link2, Unlink, ChevronDown, RefreshCw, AlertCircle, Clock,
  Sparkles, User, DownloadCloud, Fingerprint, Users, FileCheck, TriangleAlert,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

interface InssProcess {
  id: string;
  requerimento_number: string;
  current_status: string | null;
  benefit_type: string | null;
  benefit_number: string | null;
  cpf_segurado: string | null;
  nome_segurado: string | null;
  case_id: string | null;
  lead_id: string | null;
  lead_name?: string | null;
  protocol_date: string | null;
  last_email_at: string | null;
  last_email_subject: string | null;
  created_at: string;
  resultado?: string | null;
  servico?: string | null;
  exigencia_since?: string | null;
  /** Aviso de que a data informada por uma pessoa foi sobrescrita pelo e-mail
   *  do INSS. Preenchido pelo trigger trg_inss_protocol_override. */
  protocol_override?: {
    data_anterior?: string;
    data_nova?: string;
    motivo?: string;
    detectado_em?: string;
  } | null;
}

// Marcos previdenciários na ordem da jornada do requerimento. O INSS não emite
// status "Protocolado" (o e-mail inicial "realizado com sucesso" já é análise),
// então protocolado e em análise ficam juntos. "Pendente" é transitório antes de
// concluir → conta como análise. "Exigência cumprida" = está em análise mas já
// passou por exigência (precisa do histórico, daí o Set passouExig).
type StageKey =
  | "protocolado" | "analise" | "exig_aberta" | "exig_cumprida"
  | "deferido" | "indeferido" | "decurso" | "cancelada" | "sem_veredito";

const stageOf = (
  p: { id: string; current_status?: string | null; resultado?: string | null },
  passouExig: Set<string>,
): StageKey => {
  const s = (p.current_status || "").toLowerCase();
  if (s.includes("protocol")) return "protocolado";
  if (s.includes("exig")) return "exig_aberta";
  if (s.includes("cancel")) return "cancelada";
  if (s.includes("conclu")) {
    if (p.resultado === "deferido") return "deferido";
    if (p.resultado === "indeferido") return "indeferido";
    if (p.resultado === "arquivado_decurso") return "decurso";
    return "sem_veredito";
  }
  // Em análise / pendente — separa quem já passou por exigência.
  return passouExig.has(p.id) ? "exig_cumprida" : "analise";
};

const STAGES: { key: StageKey; label: string; cls: string }[] = [
  { key: "protocolado",   label: "Protocolado",          cls: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300" },
  { key: "analise",       label: "Em análise",           cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
  { key: "exig_aberta",   label: "Exigência (aberta)",   cls: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" },
  { key: "exig_cumprida", label: "Exigência cumprida",   cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
  { key: "deferido",   label: "Deferido",    cls: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
  { key: "indeferido", label: "Indeferido",  cls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
  { key: "decurso",    label: "Exig. não cumprida (decurso)", cls: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300" },
  { key: "cancelada",  label: "Cancelada",   cls: "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
  { key: "sem_veredito", label: "Concluída (sem veredito)", cls: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300" },
];

// Prazo de cumprimento de exigência: 30 dias a partir de exigencia_since.
const EXIG_PRAZO_DIAS = 30;
const exigPrazoInfo = (exigencia_since?: string | null): { dias: number; vencido: boolean } | null => {
  if (!exigencia_since) return null;
  const ms = Date.now() - new Date(exigencia_since).getTime();
  const decorridos = Math.floor(ms / 86400000);
  const restantes = EXIG_PRAZO_DIAS - decorridos;
  return { dias: Math.abs(restantes), vencido: restantes < 0 };
};

interface InssHistoryRow {
  id: string;
  from_status: string | null;
  to_status: string | null;
  email_subject: string | null;
  email_snippet: string | null;
  gmail_message_id: string | null;
  email_received_at: string | null;
  notified: boolean;
}

const statusVariant = (s?: string | null) => {
  const v = (s || "").toLowerCase();
  if (v.includes("protocol")) return "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300";
  if (v.includes("exig")) return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
  if (v.includes("conclu")) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
  if (v.includes("inde")) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  if (v.includes("pend") || v.includes("anali")) return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
  return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
};

const fmtDate = (s?: string | null, withTime = false) => {
  if (!s) return null;
  try { return format(new Date(s), withTime ? "dd/MM/yyyy HH:mm" : "dd/MM/yyyy"); }
  catch { return null; }
};
// Decodifica entidades HTML comuns (&nbsp;, &amp;, &#39;, &#x27;, etc.) que vêm
// no corpo dos e-mails do INSS já em texto plano mas com as entidades preservadas.
function decodeHtmlEntities(input: string | null | undefined): string {
  if (!input) return "";
  let s = String(input);
  // Numéricas decimais e hex
  s = s.replace(/&#(\d+);/g, (_, n) => {
    try { return String.fromCodePoint(parseInt(n, 10)); } catch { return _; }
  });
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, n) => {
    try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _; }
  });
  // Nomeadas mais comuns
  const named: Record<string, string> = {
    nbsp: "\u00a0", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
    ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»",
    aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
    Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
    atilde: "ã", otilde: "õ", Atilde: "Ã", Otilde: "Õ",
    acirc: "â", ecirc: "ê", ocirc: "ô", Acirc: "Â", Ecirc: "Ê", Ocirc: "Ô",
    ccedil: "ç", Ccedil: "Ç", agrave: "à", Agrave: "À",
  };
  s = s.replace(/&([a-zA-Z]+);/g, (m, name) => (named[name] ?? m));
  // Colapsa NBSPs em espaço normal pra leitura
  s = s.replace(/\u00a0/g, " ").replace(/[ \t]{2,}/g, " ");
  return s;
}

// Faz parse do corpo do e-mail do INSS em pares "Rótulo: valor" para exibição
// estruturada. Genérico: pega qualquer rótulo (Protocolo, Serviço, Data do
// Protocolo, Unidade responsável, Status atual, Despacho, etc.), inclusive de
// outros tipos de e-mail. Valores que quebram em mais de uma linha são juntados.

function parseInssEmail(text: string): {
  recipient: string | null;
  fields: { label: string; value: string }[];
} {
  const recipient =
    text.match(/Prezad[oa]\(a\)\s*Sr\(a\)\s*(.+?)\s*,/i)?.[1]?.trim() || null;
  const lines = text.split(/\r?\n/);
  const fields: { label: string; value: string }[] = [];
  let current: { label: string; value: string } | null = null;
  // Marcadores de rodapé/cabeçalho que encerram o campo corrente.
  const stop = /^(É poss[íi]vel acompanhar|Atenciosamente|Instituto Nacional|https?:|#{2,}|\*{2,}|Prezad)/i;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (stop.test(line)) { current = null; continue; }
    // Rótulo = só letras/espaços (evita capturar horas tipo "07:00" ou URLs).
    const m = line.match(/^([A-Za-zÀ-ú][A-Za-zÀ-ú\s]{2,40}?)\s*:\s*(.*)$/);
    if (m) {
      current = { label: m[1].replace(/\s+/g, " ").trim(), value: m[2].trim() };
      fields.push(current);
    } else if (current) {
      current.value = `${current.value} ${line}`.trim();
    }
  }
  return { recipient, fields: fields.filter((f) => f.value) };
}

export default function InssAdminProcessesTab() {
  const { updateLead } = useLeads();
  const { boards } = useKanbanBoards();
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [leadSheetOpen, setLeadSheetOpen] = useState(false);
  const [processes, setProcesses] = useState<InssProcess[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillStatus, setBackfillStatus] = useState("");
  const [search, setSearch] = useState("");
  const [showOnlyOrphans, setShowOnlyOrphans] = useState(false);
  const [stageFilter, setStageFilter] = useState<StageKey | null>(null);
  const [passouExig, setPassouExig] = useState<Set<string>>(new Set());
  const [historyByProc, setHistoryByProc] = useState<Record<string, InssHistoryRow[]>>({});
  const [linkingProc, setLinkingProc] = useState<InssProcess | null>(null);

  // Cache de corpo+parse dos e-mails (por gmail_message_id) para evitar refetch.
  const [emailBodyCache, setEmailBodyCache] = useState<
    Record<string, { body: string; despacho: string | null; subject: string | null }>
  >({});

  // Visualizador de e-mail completo (busca sob demanda no Gmail)
  const [emailView, setEmailView] = useState<{
    open: boolean; loading: boolean; subject: string | null; body: string | null; error: string | null;
  }>({ open: false, loading: false, subject: null, body: null, error: null });

  // Busca o corpo de um e-mail no Gmail e cacheia + extrai o Despacho.
  const fetchAndCacheBody = useCallback(async (gmailId: string, fallbackSubject: string | null) => {
    if (emailBodyCache[gmailId]) return emailBodyCache[gmailId];
    try {
      const { data: j, error } = await cloudFunctions.invoke<any>("gmail-message-body", {
        body: { gmail_message_id: gmailId },
      });
      if (error) throw error;
      if (!j?.success) return null;
      const text = decodeHtmlEntities(
        j.body_text ||
          (j.body_html
            ? String(j.body_html).replace(/<[^>]+>/g, " ").replace(/\s+\n/g, "\n").trim()
            : "") ||
          j.snippet ||
          ""
      );

      const parsed = parseInssEmail(text);
      const despacho =
        parsed.fields.find((f) => /despacho/i.test(f.label))?.value || null;
      const entry = { body: text, despacho, subject: j.subject || fallbackSubject };
      setEmailBodyCache((prev) => ({ ...prev, [gmailId]: entry }));
      return entry;
    } catch {
      return null;
    }
  }, [emailBodyCache]);

  const openFullEmail = async (row: InssHistoryRow) => {
    if (!row.gmail_message_id) return;
    const cached = emailBodyCache[row.gmail_message_id];
    if (cached) {
      setEmailView({
        open: true, loading: false,
        subject: cached.subject || row.email_subject,
        body: cached.body || "(e-mail sem corpo de texto)",
        error: null,
      });
      return;
    }
    setEmailView({ open: true, loading: true, subject: row.email_subject, body: null, error: null });
    const entry = await fetchAndCacheBody(row.gmail_message_id, row.email_subject);
    if (!entry) {
      setEmailView((s) => ({ ...s, loading: false, error: "Não foi possível carregar o e-mail." }));
      return;
    }
    setEmailView({
      open: true, loading: false,
      subject: entry.subject || row.email_subject,
      body: entry.body || "(e-mail sem corpo de texto)",
      error: null,
    });
  };

  const parsedEmail = useMemo(
    () => (emailView.body ? parseInssEmail(emailView.body) : null),
    [emailView.body],
  );

  // Dialog state
  const [protocoloAlvo, setProtocoloAlvo] = useState<RegistrarProtocoloAlvo | null>(null);
  const [caseSearch, setCaseSearch] = useState("");
  const [caseOptions, setCaseOptions] = useState<CaseOption[]>([]);
  const [suggestions, setSuggestions] = useState<CaseOption[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [linkingBusy, setLinkingBusy] = useState(false);

  const [userId, setUserId] = useState<string | null>(null);

  const hasAutoSynced = useRef(false);

  useEffect(() => {
    (async () => {
      const { data } = await authClient.auth.getUser();
      setUserId(data.user?.id || null);
    })();
    loadProcesses();
    if (!hasAutoSynced.current) {
      hasAutoSynced.current = true;
      triggerSync();
    }
  }, []);

  const loadProcesses = async () => {
    setLoading(true);
    const { data, error } = await db
      .from("inss_admin_processes" as any)
      .select("*")
      .is("deleted_at", null)
      .order("last_email_at", { ascending: false, nullsFirst: false });
    if (error) toast.error("Erro ao carregar: " + error.message);
    const rows = (data || []) as any[];
    const leadIds = Array.from(new Set(rows.map((r) => r.lead_id).filter(Boolean)));
    let nameById: Record<string, string> = {};
    if (leadIds.length > 0) {
      const { data: leadsData } = await db
        .from("leads")
        .select("id, lead_name")
        .in("id", leadIds);
      nameById = Object.fromEntries((leadsData || []).map((l: any) => [l.id, l.lead_name]));
    }
    const flat = rows.map((row) => ({
      ...row,
      lead_name: row.lead_id ? nameById[row.lead_id] || null : null,
    }));
    setProcesses(flat as any);
    setLoading(false);

    // Set de quem já passou por exigência (para separar "exigência cumprida"
    // de "em análise inicial" no painel). Query leve: só process_id.
    const { data: exigRows } = await db
      .from("inss_status_history" as any)
      .select("process_id")
      .ilike("to_status", "exig%")
      .limit(10000);
    setPassouExig(new Set((exigRows || []).map((r: any) => r.process_id).filter(Boolean)));
  };

  const loadHistory = async (procId: string) => {
    if (historyByProc[procId]) return;
    const { data } = await db
      .from("inss_status_history" as any)
      .select("id, from_status, to_status, email_subject, email_snippet, gmail_message_id, email_received_at, notified")
      .eq("process_id", procId)
      .order("email_received_at", { ascending: false });
    const rows = ((data || []) as unknown) as InssHistoryRow[];
    setHistoryByProc((prev) => ({ ...prev, [procId]: rows }));
    const latest = rows[0];
    if (latest?.gmail_message_id) {
      fetchAndCacheBody(latest.gmail_message_id, latest.email_subject);
    }
  };

  // Contagem por estágio sobre TODOS os processos (não só a página), para o
  // painel de topo. useMemo porque a lista pode passar de centenas de itens.
  const stageCounts = useMemo(() => {
    const acc: Record<StageKey, number> = {
      protocolado: 0, analise: 0, exig_aberta: 0, exig_cumprida: 0,
      deferido: 0, indeferido: 0, decurso: 0, cancelada: 0, sem_veredito: 0,
    };
    for (const p of processes) acc[stageOf(p, passouExig)]++;
    return acc;
  }, [processes, passouExig]);

  const filtered = useMemo(() => {
    let list = processes;
    if (showOnlyOrphans) list = list.filter((p) => !p.case_id);
    if (stageFilter) list = list.filter((p) => stageOf(p, passouExig) === stageFilter);
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
  }, [processes, search, showOnlyOrphans, stageFilter, passouExig]);

  // Paginação client-side (25/página)
  const PAGE_SIZE = 25;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => { setPage(1); }, [search, showOnlyOrphans, stageFilter]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const paged = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  // Auto-carrega histórico dos cartões visíveis (DB) e o corpo do último e-mail
  // (Gmail) para conseguir mostrar o Despacho como preview no cartão.
  useEffect(() => {
    paged.forEach((p) => {
      if (!historyByProc[p.id]) {
        loadHistory(p.id);
      } else {
        const latest = historyByProc[p.id][0];
        if (latest?.gmail_message_id && !emailBodyCache[latest.gmail_message_id]) {
          fetchAndCacheBody(latest.gmail_message_id, latest.email_subject);
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paged, historyByProc]);

  const orphanCount = processes.filter((p) => !p.case_id).length;

  const triggerSync = async () => {
    setSyncing(true);
    try {
      const { data: j, error } = await cloudFunctions.invoke<any>("gmail-inss-sync", {
        body: { lookback_hours: 48, max_messages: 100 },
      });
      if (error) throw error;
      if (j?.success) {
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

  // Backfill: varre TODO o histórico de e-mails [INSS] em lotes, seguindo o
  // cursor de paginação devolvido pelo servidor até `done`.
  const runBackfill = async () => {
    if (
      !confirm(
        "Backfill: varre os e-mails [INSS] do Gmail desde janeiro/2022 e cria os processos que faltam. Pode levar alguns minutos. Continuar?",
      )
    )
      return;
    setBackfilling(true);
    let cursor: any = null;
    let totalNew = 0;
    let totalProc = 0;
    let calls = 0;
    try {
      do {
        const { data: j, error } = await cloudFunctions.invoke<any>("gmail-inss-sync", {
          body: { backfill: true, max_messages: 150, cursor },
        });
        if (error) throw error;
        if (!j?.success) {
          toast.error("Backfill falhou: " + (j?.error || "erro desconhecido"));
          break;
        }
        totalNew += j.new || 0;
        totalProc += j.created_processes || 0;
        calls++;
        setBackfillStatus(
          `Lote ${calls} · ${totalNew} e-mails novos, ${totalProc} processos`,
        );
        cursor = j.done ? null : j.cursor;
        if (j.done) {
          toast.success(
            `Backfill concluído — ${totalNew} e-mails novos, ${totalProc} processos criados`,
          );
          break;
        }
      } while (cursor && calls < 500);
      if (calls >= 500) toast.warning("Backfill interrompido no limite de segurança (500 lotes).");
      loadProcesses();
    } catch (e: any) {
      toast.error("Erro: " + e.message);
    } finally {
      setBackfilling(false);
      setBackfillStatus("");
    }
  };

  // Cria (ou atualiza) lead_processes com todos os dados do INSS puxados do email.
  // Lógica compartilhada com a aba "Buscar no E-mail" do Cadastrar Processo.
  const upsertLeadProcess = async (caseId: string, leadId: string | null, proc: InssProcess) => {
    await upsertInssLeadProcess({ caseId, leadId, proc, createdBy: userId });
  };

  const runAutoMatch = async () => {
    toast.info("Procurando órfãos que casam com leads...");
    try {
      const { data: j, error } = await cloudFunctions.invoke<any>("match-inss-orphans", { body: {} });
      if (error) throw error;
      if (j?.success) {
        toast.success(`${j.matched}/${j.scanned} órfãos vinculados automaticamente.`);
        loadProcesses();
      } else {
        toast.error("Erro: " + (j.error || "desconhecido"));
      }
    } catch (e: any) {
      toast.error("Falha: " + e.message);
    }
  };

  const runAutoLinkByName = async () => {
    toast.info("Vinculando órfãos por nome (só candidatos únicos)...");
    try {
      const { data: j, error } = await cloudFunctions.invoke<any>("auto-link-inss-by-name", { body: {} });
      if (error) throw error;
      if (j?.success) {
        const s = j.stats || {};
        toast.success(
          `${s.linked || 0} vinculados · ${s.ambiguous || 0} ambíguos (revisar manualmente) · ${s.no_match || 0} sem match`
        );
        loadProcesses();
      } else {
        toast.error("Erro: " + (j.error || "desconhecido"));
      }
    } catch (e: any) {
      toast.error("Falha: " + e.message);
    }
  };

  const runBulkLinkByCpf = async () => {
    if (!confirm("Vincular em lote todos os órfãos cujo CPF do segurado bate com um lead ou contato existente. Continuar?")) return;
    toast.info("Vinculando órfãos por CPF…");
    try {
      const { data: j, error } = await cloudFunctions.invoke<any>("bulk-link-inss-by-cpf", { body: {} });
      if (error) throw error;
      if (j?.success) {
        const s = j.stats || {};
        toast.success(`${s.linked || 0} vinculados por CPF · ${s.no_match || 0} sem match · ${s.errors || 0} erros`);
        loadProcesses();
      } else {
        toast.error("Erro: " + (j.error || "desconhecido"));
      }
    } catch (e: any) {
      toast.error("Falha: " + e.message);
    }
  };

  // ===== Ambíguos (vários candidatos pelo mesmo nome) =====
  type AmbiguousRow = {
    processId: string;
    nome: string;
    candidates: { leadId: string; leadName: string | null }[];
  };
  const [ambiguous, setAmbiguous] = useState<AmbiguousRow[] | null>(null);
  const [ambiguousLoading, setAmbiguousLoading] = useState(false);
  const [ambiguousBusy, setAmbiguousBusy] = useState<string | null>(null);

  const openAmbiguousReview = async () => {
    setAmbiguous([]);
    setAmbiguousLoading(true);
    try {
      const { data: j, error } = await cloudFunctions.invoke<any>("auto-link-inss-by-name", {
        body: { dry_run: true },
      });
      if (error) throw error;
      if (!j?.success) {
        toast.error("Erro: " + (j.error || "desconhecido"));
        setAmbiguous(null);
        return;
      }
      const raw = (j.ambiguous || []) as Array<{ processId: string; nome: string; candidates: string[] }>;
      if (raw.length === 0) {
        toast.success("Nenhum órfão ambíguo no momento 🎉");
        setAmbiguous(null);
        return;
      }
      // Busca nomes dos candidatos pra exibir
      const leadIds = Array.from(new Set(raw.flatMap((r) => r.candidates)));
      const { data: leadsData } = await db.from("leads").select("id, lead_name").in("id", leadIds);
      const nameById: Record<string, string | null> = {};
      for (const l of (leadsData || []) as any[]) nameById[l.id] = l.lead_name;
      setAmbiguous(
        raw.map((r) => ({
          processId: r.processId,
          nome: r.nome,
          candidates: r.candidates.map((id) => ({ leadId: id, leadName: nameById[id] ?? null })),
        })),
      );
    } catch (e: any) {
      toast.error("Falha: " + e.message);
      setAmbiguous(null);
    } finally {
      setAmbiguousLoading(false);
    }
  };

  const pickAmbiguousCandidate = async (processId: string, leadId: string) => {
    setAmbiguousBusy(processId);
    try {
      // Reusa o caminho do link manual: abre o dialog com o processo certo
      // não é necessário — basta aplicar via applyInssMatch invocando match-orphans-for-lead
      const proc = processes.find((p) => p.id === processId);
      // Atualiza direto via DB (mesma lógica do unlink/link)
      const { data: cs } = await db
        .from("legal_cases" as any)
        .select("id")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      let caseId = (cs as any)?.id || null;
      if (!caseId) {
        const { data: newCaseNum } = await db.rpc("generate_case_number" as any, { p_nucleus_id: null } as any);
        const { data: newCase } = await db
          .from("legal_cases" as any)
          .insert({
            lead_id: leadId,
            case_number: newCaseNum || `CASO-${Date.now()}`,
            title: proc?.nome_segurado || "Caso INSS",
            status: "active",
          } as any)
          .select("id")
          .single();
        caseId = (newCase as any)?.id || null;
      }
      const { error } = await db
        .from("inss_admin_processes" as any)
        .update({ lead_id: leadId, case_id: caseId, linked_at: new Date().toISOString(), linked_by: userId })
        .eq("id", processId);
      if (error) throw error;
      // Atualiza lead_processes pra refletir
      if (proc && caseId) await upsertLeadProcess(caseId, leadId, proc);
      toast.success("Vinculado");
      setAmbiguous((prev) => (prev ? prev.filter((r) => r.processId !== processId) : prev));
      loadProcesses();
    } catch (e: any) {
      toast.error("Erro: " + e.message);
    } finally {
      setAmbiguousBusy(null);
    }
  };





  // Clicar no processo abre o painel lateral do lead vinculado (Sheet "Editar Lead").
  const goToLead = async (p: InssProcess) => {
    if (!p.lead_id) return;
    try {
      const { data, error } = await db
        .from("leads" as any)
        .select("*")
        .eq("id", p.lead_id)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        toast.error("Lead não encontrado");
        return;
      }
      setSelectedLead(data as unknown as Lead);
      setLeadSheetOpen(true);
    } catch (e: any) {
      toast.error("Erro ao abrir lead: " + e.message);
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
          <Button
            variant="outline"
            size="sm"
            onClick={runBackfill}
            disabled={backfilling || syncing}
            className="gap-2"
            title="Varre todo o histórico de e-mails do INSS no Gmail"
          >
            <DownloadCloud className={`h-4 w-4 ${backfilling ? "animate-pulse" : ""}`} />
            {backfilling ? (backfillStatus || "Importando histórico...") : "Backfill completo"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <Link2 className="h-4 w-4" />
                Vincular
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={runAutoMatch} className="gap-2 cursor-pointer">
                <Sparkles className="h-4 w-4" />
                Vincular órfãos
              </DropdownMenuItem>
              <DropdownMenuItem onClick={runAutoLinkByName} className="gap-2 cursor-pointer">
                <User className="h-4 w-4" />
                Vincular por nome (v2)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={runBulkLinkByCpf} className="gap-2 cursor-pointer">
                <Fingerprint className="h-4 w-4" />
                Vincular por CPF
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={openAmbiguousReview}
                disabled={ambiguousLoading}
                className="gap-2 cursor-pointer"
              >
                <Users className={`h-4 w-4 ${ambiguousLoading ? "animate-pulse" : ""}`} />
                Revisar ambíguos
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

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

      {/* Relatório por estágio — clique num cartão pra filtrar a lista. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-9 gap-2">
        {STAGES.map((st) => {
          const active = stageFilter === st.key;
          return (
            <button
              key={st.key}
              type="button"
              onClick={() => setStageFilter((cur) => (cur === st.key ? null : st.key))}
              className={`rounded-lg border p-2 text-left transition-colors ${
                active ? "border-primary ring-1 ring-primary" : "border-border hover:bg-muted/50"
              }`}
              title={`Filtrar por ${st.label}`}
            >
              <div className="text-2xl font-bold tabular-nums leading-none">{stageCounts[st.key]}</div>
              <Badge className={`${st.cls} mt-1 whitespace-normal text-left`}>{st.label}</Badge>
            </button>
          );
        })}
      </div>
      {stageFilter && (
        <button
          type="button"
          onClick={() => setStageFilter(null)}
          className="text-xs text-primary hover:underline"
        >
          ← limpar filtro de estágio
        </button>
      )}

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
          {paged.map((p) => {
            const history = historyByProc[p.id] || [];
            const latest = history[0];
            const olderHistory = history.slice(1);
            const hasMultiple = history.length > 1;
            const cachedBody = latest?.gmail_message_id
              ? emailBodyCache[latest.gmail_message_id]
              : undefined;
            const despachoPreview = decodeHtmlEntities(
              cachedBody?.despacho || latest?.email_snippet || ""
            ) || null;


            return (
            <Card key={p.id} className={!p.case_id ? "border-orange-300 dark:border-orange-700" : ""}>
              <CardContent className="p-3">
                <Collapsible onOpenChange={(open) => open && loadHistory(p.id)}>
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className={`flex-1 min-w-0 space-y-1 ${p.lead_id ? "cursor-pointer rounded-md -m-1 p-1 transition-colors hover:bg-muted/50" : ""}`}
                      onClick={p.lead_id ? () => goToLead(p) : undefined}
                      role={p.lead_id ? "button" : undefined}
                      title={p.lead_id ? "Abrir lead vinculado" : undefined}
                    >
                      {p.lead_id && p.lead_name && (
                        <div className="flex items-center gap-1 text-sm font-medium text-primary">
                          <User className="h-3.5 w-3.5" />
                          {p.lead_name}
                        </div>
                      )}
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
                        {/exig/i.test(p.current_status || "") && (() => {
                          const info = exigPrazoInfo(p.exigencia_since);
                          if (!info) return null;
                          return (
                            <Badge className={info.vencido
                              ? "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"}>
                              {info.vencido ? `⚠ prazo vencido há ${info.dias}d` : `prazo: ${info.dias}d restantes`}
                            </Badge>
                          );
                        })()}
                      </div>
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        {p.nome_segurado && <div>👤 {p.nome_segurado}</div>}
                        {p.cpf_segurado && <div>CPF: {p.cpf_segurado}</div>}
                        {p.benefit_type && <div>Benefício: {p.benefit_type}</div>}
                        {p.benefit_number && <div>NB: {p.benefit_number}</div>}
                        {p.protocol_date && (
                          <div>📅 Protocolo: {fmtDate(p.protocol_date)}</div>
                        )}
                        {/* A data informada por uma pessoa foi trocada pela do
                            e-mail do INSS. Mostrar as duas — quem registrou
                            precisa saber que a sua não prevaleceu. */}
                        {p.protocol_override && (
                          <div className="flex items-start gap-1 text-amber-700 dark:text-amber-400">
                            <TriangleAlert className="h-3 w-3 mt-0.5 shrink-0" />
                            <span>
                              Data corrigida pelo INSS:{" "}
                              {fmtDate(p.protocol_override.data_anterior || "")} →{" "}
                              {fmtDate(p.protocol_override.data_nova || "")}
                              {p.protocol_override.motivo ? ` — ${p.protocol_override.motivo}` : ""}
                            </span>
                          </div>
                        )}
                        {p.last_email_at && (
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Última atualização: {fmtDate(p.last_email_at, true)}
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
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setProtocoloAlvo({
                          id: p.id,
                          requerimento_number: p.requerimento_number,
                          nome_segurado: p.nome_segurado,
                        })}
                        className="gap-1 h-7"
                        title="Registrar protocolo com a certidão"
                      >
                        <FileCheck className="h-3.5 w-3.5" />
                        Protocolo
                      </Button>
                      {hasMultiple && (
                        <CollapsibleTrigger asChild>
                          <Button size="sm" variant="ghost" className="h-7 gap-1">
                            <ChevronDown className="h-3.5 w-3.5" />
                            Histórico ({history.length})
                          </Button>
                        </CollapsibleTrigger>
                      )}
                    </div>
                  </div>

                  {/* Último e-mail SEMPRE aberto */}
                  {latest && (
                    <div className="mt-3 pt-3 border-t text-xs space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-muted-foreground">
                          {latest.email_received_at
                            ? format(new Date(latest.email_received_at), "dd/MM HH:mm")
                            : "—"}
                        </span>
                        <Badge variant="outline" className={statusVariant(latest.to_status)}>
                          {latest.from_status || "?"} → {latest.to_status || "?"}
                        </Badge>
                        {latest.notified && <span className="text-green-600">✓ notificado</span>}
                        {latest.gmail_message_id && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                            onClick={() => openFullEmail(latest)}
                            title="Abrir o e-mail completo do Gmail"
                          >
                            <Mail className="h-3 w-3" /> Ver e-mail completo
                          </button>
                        )}
                      </div>
                      {despachoPreview ? (
                        <div className="rounded-md bg-muted/40 p-2 mt-1">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
                            Despacho
                          </div>
                          <div className="text-foreground/90 whitespace-pre-wrap line-clamp-4">
                            {despachoPreview}
                          </div>
                        </div>
                      ) : latest.gmail_message_id && !cachedBody ? (
                        <div className="text-muted-foreground/70 italic">Carregando despacho…</div>
                      ) : null}
                    </div>
                  )}

                  {hasMultiple && (
                    <CollapsibleContent className="mt-3 pt-3 border-t">
                      <div className="space-y-1.5">
                        {olderHistory.map((h) => (
                          <div key={h.id} className="text-xs space-y-1 border-b border-dashed last:border-0 pb-1.5 last:pb-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-muted-foreground">
                                {h.email_received_at ? format(new Date(h.email_received_at), "dd/MM HH:mm") : "—"}
                              </span>
                              <Badge variant="outline" className={statusVariant(h.to_status)}>
                                {h.from_status || "?"} → {h.to_status || "?"}
                              </Badge>
                              {h.notified && <span className="text-green-600">✓ notificado</span>}
                              {h.gmail_message_id && (
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 text-primary hover:underline"
                                  onClick={() => openFullEmail(h)}
                                  title="Abrir o e-mail completo do Gmail"
                                >
                                  <Mail className="h-3 w-3" /> Ver e-mail completo
                                </button>
                              )}
                            </div>
                            {h.email_subject && (
                              <div className="text-muted-foreground font-medium">{h.email_subject}</div>
                            )}
                            {h.email_snippet && (
                              <div className="text-muted-foreground/80 italic line-clamp-2">{h.email_snippet}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </CollapsibleContent>
                  )}
                </Collapsible>
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ListPagination page={page} totalPages={totalPages} onPageChange={setPage} />
        <p className="text-xs text-muted-foreground sm:text-right">
          {filtered.length === 0
            ? "0 processos"
            : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, filtered.length)} de ${filtered.length}`}
          {filtered.length !== processes.length && ` (${processes.length} no total)`}
        </p>
      </div>

      {/* Dialog de vínculo — mesmo componente usado na lista de protocolos
          da Visão Geral (src/components/protocolos/VincularCasoDialog.tsx). */}
      <VincularCasoDialog
        proc={linkingProc}
        userId={userId}
        onClose={() => setLinkingProc(null)}
        onVinculado={() => loadProcesses()}
      />

      {/* Visualizador do e-mail completo */}
      <Dialog open={emailView.open} onOpenChange={(open) => !open && setEmailView((s) => ({ ...s, open: false }))}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Mail className="h-4 w-4" />
              {emailView.subject || "E-mail do INSS"}
            </DialogTitle>
          </DialogHeader>
          {emailView.loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <RefreshCw className="h-4 w-4 animate-spin" /> Carregando e-mail do Gmail…
            </div>
          ) : emailView.error ? (
            <div className="text-sm text-destructive py-4">{emailView.error}</div>
          ) : (
            <InssAdminPushEmailView body={emailView.body || ""} />
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog de revisão de órfãos ambíguos */}
      <Dialog open={ambiguous !== null} onOpenChange={(open) => !open && setAmbiguous(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Órfãos ambíguos · pelo nome</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Cada um destes órfãos bateu em mais de um lead pelo nome. Escolha o correto para vincular.
            </p>
          </DialogHeader>
          {ambiguousLoading ? (
            <div className="py-6 text-center text-muted-foreground text-sm">Procurando ambíguos…</div>
          ) : !ambiguous || ambiguous.length === 0 ? (
            <div className="py-6 text-center text-muted-foreground text-sm">Nenhum ambíguo para revisar.</div>
          ) : (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              {ambiguous.map((row) => {
                const proc = processes.find((p) => p.id === row.processId);
                return (
                  <div key={row.processId} className="border rounded-md p-3 space-y-2">
                    <div className="text-sm">
                      <div className="font-medium">{row.nome}</div>
                      {proc && (
                        <div className="text-xs text-muted-foreground">
                          Req. {proc.requerimento_number}
                          {proc.cpf_segurado ? ` · CPF ${proc.cpf_segurado}` : ""}
                          {proc.benefit_type ? ` · ${proc.benefit_type}` : ""}
                        </div>
                      )}
                    </div>
                    <div className="grid gap-1">
                      {row.candidates.map((c) => (
                        <button
                          key={c.leadId}
                          type="button"
                          disabled={ambiguousBusy === row.processId}
                          onClick={() => pickAmbiguousCandidate(row.processId, c.leadId)}
                          className="w-full text-left p-2 rounded-md hover:bg-muted text-sm border disabled:opacity-50"
                        >
                          <div className="flex items-center gap-2">
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="font-medium">{c.leadName || "(sem nome)"}</span>
                            <span className="text-xs text-muted-foreground font-mono">{c.leadId.slice(0, 8)}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setAmbiguous(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Registro do protocolo no ato, com a certidão como prova */}
      <RegistrarProtocoloDialog
        alvo={protocoloAlvo}
        onClose={() => setProtocoloAlvo(null)}
        onSaved={loadProcesses}
      />

      {/* Painel lateral do lead vinculado */}
      {selectedLead && (
        <LeadEditDialog
          open={leadSheetOpen}
          onOpenChange={(v) => {
            setLeadSheetOpen(v);
            if (!v) setSelectedLead(null);
          }}
          lead={selectedLead}
          onSave={async (id, updates) => {
            await updateLead(id, updates);
          }}
          boards={boards}
          mode="sheet"
        />
      )}
    </div>
  );
}
