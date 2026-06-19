import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import ListPagination from "@/components/processes/ListPagination";
import { LeadEditDialog } from "@/components/kanban/LeadEditDialog";
import InssAdminPushEmailView from "@/components/processes/InssAdminPushEmailView";
import { useLeads, type Lead } from "@/hooks/useLeads";
import { useKanbanBoards } from "@/hooks/useKanbanBoards";
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
  Sparkles, User, DownloadCloud, Fingerprint, Users,
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
}

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

interface CaseOption {
  id: string; // case_id real OU "lead:<lead_id>" quando lead ainda não tem caso
  case_number: string;
  title: string;
  lead_id: string | null;
  lead_name?: string | null;
  matched_via?: string;
  needs_case_creation?: boolean; // true quando id é "lead:..."
}

const RAILWAY_BASE =
  (import.meta as any).env?.VITE_RAILWAY_BASE_URL ||
  "https://adscore-keeper-production.up.railway.app";

const statusVariant = (s?: string | null) => {
  const v = (s || "").toLowerCase();
  if (v.includes("exig")) return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
  if (v.includes("conclu")) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
  if (v.includes("inde")) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  if (v.includes("pend") || v.includes("anali")) return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
  return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
};

const normalizeCpf = (s?: string | null) => (s || "").replace(/\D/g, "");
const fmtDate = (s?: string | null, withTime = false) => {
  if (!s) return null;
  try { return format(new Date(s), withTime ? "dd/MM/yyyy HH:mm" : "dd/MM/yyyy"); }
  catch { return null; }
};
// Normaliza texto para busca: tira acento, ignora caixa e deixa só letras/números.
// Metáfora: antes de comparar, todos os nomes vestem o mesmo uniforme.
const stripAccents = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const normalizeSearchText = (s?: string | null) =>
  stripAccents(String(s || ""))
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const tokenizeName = (s?: string | null): string[] => {
  if (!s) return [];
  return normalizeSearchText(s)
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !["DOS", "DAS", "DEL", "DE", "DA", "DO", "E"].includes(t));
};
const safeIlikeToken = (s: string) => s.replace(/[%,()]/g, " ").trim();
const uniqueTokens = (tokens: string[]) => Array.from(new Set(tokens));
const accentAlternates: Record<string, string[]> = {
  A: ["Á", "À", "Â", "Ã"],
  E: ["É", "Ê"],
  I: ["Í"],
  O: ["Ó", "Ô", "Õ"],
  U: ["Ú"],
  C: ["Ç"],
};
const ilikeAccentVariants = (token: string) => {
  const base = safeIlikeToken(token).toUpperCase();
  const variants = new Set<string>([base]);
  for (let i = 0; i < base.length; i++) {
    for (const alt of accentAlternates[base[i]] || []) {
      variants.add(`${base.slice(0, i)}${alt}${base.slice(i + 1)}`);
    }
  }
  return Array.from(variants).filter(Boolean);
};
const buildIlikeSearchTokens = (tokens: string[]) => uniqueTokens(tokens.flatMap(ilikeAccentVariants));
const tokenLooksMatched = (queryToken: string, candidateToken: string) => {
  if (!queryToken || !candidateToken) return false;
  if (candidateToken.includes(queryToken) || queryToken.includes(candidateToken)) return true;
  const minPrefix = Math.min(5, queryToken.length, candidateToken.length);
  if (minPrefix >= 4 && candidateToken.slice(0, minPrefix) === queryToken.slice(0, minPrefix)) return true;
  // Pequena tolerância para Sousa/Souza e outros nomes com 1 letra diferente.
  if (queryToken.length >= 5 && candidateToken.length >= 5 && Math.abs(queryToken.length - candidateToken.length) <= 1) {
    let diff = Math.abs(queryToken.length - candidateToken.length);
    const size = Math.min(queryToken.length, candidateToken.length);
    for (let i = 0; i < size; i++) if (queryToken[i] !== candidateToken[i]) diff++;
    return diff <= 1;
  }
  return false;
};
const tokenMatchScore = (query: string, candidate?: string | null) => {
  const qTokens = uniqueTokens(tokenizeName(query));
  const cTokens = uniqueTokens(tokenizeName(candidate));
  if (!qTokens.length || !cTokens.length) return 0;
  return qTokens.filter((qt) => cTokens.some((ct) => tokenLooksMatched(qt, ct))).length;
};
// Compatibilidade de nomes (assimétrica): query = nome no processo do INSS
// (sempre completo), candidate = nome do lead/contato/grupo (pode ser curto).
// Regras:
//  - Se o processo tem 3+ partes (ex: "Francisco Cicero de Sousa"), exigir que
//    o candidato bata em pelo menos 2 tokens E pelo menos um deles seja
//    sobrenome (não só o primeiro nome). Assim "Francisco" sozinho NÃO casa
//    com "Francisco Cicero de Sousa", mas "Francisco Sousa" casa.
//  - Se ambos têm 3+ tokens, exigir margem de 1 (cobre Sousa/Souza), evitando
//    que "Maria Eduarda Medeiros Moraes" case com "Maria Eduarda Alves Maia".
//  - Se o processo tem 1-2 partes, basta que todos os tokens da query batam.
const namesAreCompatible = (query: string, candidate?: string | null) => {
  const qTokens = uniqueTokens(tokenizeName(query));
  const cTokens = uniqueTokens(tokenizeName(candidate));
  if (!qTokens.length || !cTokens.length) return false;
  const matched = qTokens.filter((qt) => cTokens.some((ct) => tokenLooksMatched(qt, ct)));
  const score = matched.length;
  if (qTokens.length >= 3) {
    if (score < 2) return false;
    const firstName = qTokens[0];
    const hasSurnameMatch = matched.some((t) => t !== firstName);
    if (!hasSurnameMatch) return false;
    if (cTokens.length >= 3) {
      const shorter = Math.min(qTokens.length, cTokens.length);
      return score >= shorter - 1;
    }
    return true;
  }
  return score >= qTokens.length;
};
const isLooseTokenMatch = (query: string, candidate?: string | null) => {
  const qTokens = uniqueTokens(tokenizeName(query));
  if (!qTokens.length) return false;
  if (qTokens.some((t) => /^\d+$/.test(t))) return tokenMatchScore(query, candidate) >= 1;
  return namesAreCompatible(query, candidate);
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
      const resp = await fetch(`${RAILWAY_BASE}/functions/gmail-message-body`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": (import.meta as any).env?.VITE_RAILWAY_API_KEY || "",
        },
        body: JSON.stringify({ gmail_message_id: gmailId }),
      });
      const j = await resp.json();
      if (!j.success) return null;
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

  // Paginação client-side (25/página)
  const PAGE_SIZE = 25;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => { setPage(1); }, [search, showOnlyOrphans]);
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
        const resp = await fetch(`${RAILWAY_BASE}/functions/gmail-inss-sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": (import.meta as any).env?.VITE_RAILWAY_API_KEY || "",
          },
          body: JSON.stringify({ backfill: true, max_messages: 150, cursor }),
        });
        const j = await resp.json();
        if (!j.success) {
          toast.error("Backfill falhou: " + (j.error || "erro desconhecido"));
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

  // === Sugestões automáticas ao abrir o dialog ===
  const fetchSuggestions = useCallback(async (proc: InssProcess) => {
    setLoadingSuggestions(true);
    const found = new Map<string, CaseOption>(); // case_id -> option

    const addCase = async (caseId: string, via: string) => {
      if (found.has(caseId)) return;
      const { data: c } = await db
        .from("legal_cases" as any)
        .select("id, case_number, title, lead_id")
        .eq("id", caseId)
        .maybeSingle();
      if (!c) return;
      let leadName: string | null = null;
      if ((c as any).lead_id) {
        const { data: l } = await db
          .from("leads" as any)
          .select("lead_name")
          .eq("id", (c as any).lead_id)
          .maybeSingle();
        leadName = (l as any)?.lead_name || null;
      }
      found.set(caseId, { ...(c as any), lead_name: leadName, matched_via: via });
    };

    const addLead = async (leadId: string, leadName: string | null, via: string) => {
      const { data: cs } = await db
        .from("legal_cases" as any)
        .select("id, case_number, title, lead_id")
        .eq("lead_id", leadId)
        .limit(5);
      for (const c of (cs || []) as any[]) {
        if (found.has(c.id)) continue;
        found.set(c.id, { ...c, lead_name: leadName, matched_via: via });
      }
    };

    const reqDigits = (proc.requerimento_number || "").replace(/\D/g, "");
    if (reqDigits) {
      const { data: processesByNumber } = await db
        .from("lead_processes" as any)
        .select("lead_id, case_id, title, process_number")
        .or(`process_number.ilike.%${reqDigits}%,title.ilike.%${reqDigits}%`)
        .not("case_id", "is", null)
        .order("updated_at", { ascending: false })
        .limit(10);
      for (const lp of (processesByNumber || []) as any[]) {
        if (lp.case_id) await addCase(lp.case_id, `Nº do processo bate: ${lp.process_number || lp.title}`);
        else if (lp.lead_id) await addLead(lp.lead_id, null, `Nº do processo bate: ${lp.process_number || lp.title}`);
      }
    }

    // 1) Match por CPF exato em contacts
    const cpf = normalizeCpf(proc.cpf_segurado);
    if (cpf) {
      const { data: contactsByCpf } = await db
        .from("contacts" as any)
        .select("id, full_name, cpf, lead_id")
        .or(`cpf.eq.${cpf},cpf.eq.${proc.cpf_segurado}`)
        .is("deleted_at", null)
        .limit(10);
      for (const ct of (contactsByCpf || []) as any[]) {
        // contato pode estar ligado direto a lead via contacts.lead_id
        if (ct.lead_id) await addLead(ct.lead_id, ct.full_name, `CPF bate com contato "${ct.full_name}"`);
        // ou via tabela ponte contact_leads
        const { data: cl } = await db
          .from("contact_leads" as any)
          .select("lead_id")
          .eq("contact_id", ct.id);
        for (const link of (cl || []) as any[]) {
          await addLead(link.lead_id, ct.full_name, `CPF bate com contato "${ct.full_name}"`);
        }
      }

      // 2) CPF em leads diretamente (campos comuns: cpf, document)
      const { data: leadsByCpf } = await db
        .from("leads" as any)
        .select("id, lead_name")
        .or(`cpf.eq.${cpf},cpf.eq.${proc.cpf_segurado}`)
        .limit(10);
      for (const l of (leadsByCpf || []) as any[]) {
        await addLead(l.id, l.lead_name, "CPF bate com o lead");
      }
    }

    // 3) Match por nome (tokens, tolerante a acento) em contacts (Externo + Cloud)
    const tokens = uniqueTokens(tokenizeName(proc.nome_segurado));
    const matchTokens = (full?: string | null) => namesAreCompatible(proc.nome_segurado || "", full);
    if (tokens.length) {
      const searchTokens = buildIlikeSearchTokens([...tokens].sort((a, b) => b.length - a.length).slice(0, 4));
      const nameOr = searchTokens.map((t) => `full_name.ilike.%${t}%`).join(",");
      // contacts no EXTERNO
      const { data: ctExt } = await db
        .from("contacts" as any)
        .select("id, full_name, lead_id")
        .or(nameOr)
        .is("deleted_at", null)
        .limit(100);
      // contacts no CLOUD (alguns só existem lá)
      const { data: ctCloud } = await authClient
        .from("contacts" as any)
        .select("id, full_name, lead_id")
        .or(nameOr)
        .is("deleted_at", null)
        .limit(100);
      const allContacts = [...(ctExt || []), ...(ctCloud || [])].filter((ct: any) => matchTokens(ct.full_name));
      const seenContact = new Set<string>();
      for (const ct of allContacts as any[]) {
        if (seenContact.has(ct.id)) continue;
        seenContact.add(ct.id);
        if (ct.lead_id) await addLead(ct.lead_id, ct.full_name, `Nome bate com contato "${ct.full_name}"`);
        const { data: cl } = await db
          .from("contact_leads" as any)
          .select("lead_id")
          .eq("contact_id", ct.id);
        for (const link of (cl || []) as any[]) {
          await addLead(link.lead_id, ct.full_name, `Nome bate com contato "${ct.full_name}"`);
        }
      }

      // 4) Nome em leads (Externo) — busca por tokens + filtro normalizado
      const { data: leadsRaw } = await db
        .from("leads" as any)
        .select("id, lead_name")
        .or(searchTokens.map((t) => `lead_name.ilike.%${t}%`).join(","))
        .limit(100);
      const leadsFiltered = (leadsRaw || []).filter((l: any) => matchTokens(l.lead_name));
      for (const l of leadsFiltered as any[]) {
        await addLead(l.id, l.lead_name, "Nome bate com o lead");
      }

      // 5) Nome em grupos WhatsApp vinculados — caso o grupo tenha o nome certo
      const { data: groupsByName } = await db
        .from("lead_whatsapp_groups" as any)
        .select("lead_id, group_name")
        .or(searchTokens.map((t) => `group_name.ilike.%${t}%`).join(","))
        .limit(100);
      const groupsFiltered = (groupsByName || []).filter((g: any) => matchTokens(g.group_name));
      for (const g of groupsFiltered as any[]) {
        if (g.lead_id) await addLead(g.lead_id, g.group_name, `Nome bate com grupo WhatsApp "${g.group_name}"`);
      }
    }

    setSuggestions(Array.from(found.values()).slice(0, 12));
    setLoadingSuggestions(false);
  }, []);

  useEffect(() => {
    if (linkingProc) {
      setSuggestions([]);
      setCaseSearch("");
      fetchSuggestions(linkingProc);
    }
  }, [linkingProc, fetchSuggestions]);

  // Busca manual: aceita nº/título de caso, nome de lead, nome de contato, telefone, CPF
  useEffect(() => {
    if (!linkingProc) return;
    const q = caseSearch.trim();
    if (!q) { setCaseOptions([]); return; }
    const run = async () => {
      const results = new Map<string, CaseOption>();
      const digitsOnly = q.replace(/\D/g, "");

      // 1) Casos por número/título
      const { data: casesByCaseFields } = await db
        .from("legal_cases" as any)
        .select("id, case_number, title, lead_id")
        .or(`case_number.ilike.%${q}%,title.ilike.%${q}%`)
        .order("created_at", { ascending: false })
        .limit(10);
      for (const c of (casesByCaseFields || []) as any[]) {
        results.set(c.id, { ...c, matched_via: "Caso" });
      }

      const qTokens = uniqueTokens(tokenizeName(q));
      const textSearchTokens = qTokens.length
        ? buildIlikeSearchTokens(qTokens.sort((a, b) => b.length - a.length).slice(0, 5))
        : [safeIlikeToken(q)].filter(Boolean);
      if (!textSearchTokens.length) { setCaseOptions([]); return; }

      // 2) Leads por nome / telefone / CPF — busca por pedaços, filtra sem acento/caixa
      const leadOr: string[] = textSearchTokens.map((t) => `lead_name.ilike.%${t}%`);
      if (digitsOnly.length >= 4) {
        leadOr.push(`lead_phone.ilike.%${digitsOnly}%`);
        leadOr.push(`cpf.ilike.%${digitsOnly}%`);
      }
      const { data: leadsRaw } = await db
        .from("leads" as any)
        .select("id, lead_name")
        .or(leadOr.join(","))
        .limit(80);
      const leads = ((leadsRaw || []) as any[]).filter((l) =>
        digitsOnly.length >= 4 || isLooseTokenMatch(q, l.lead_name)
      );

      // 3) Contatos por nome/telefone/CPF (Externo + Cloud)
      const contactOr: string[] = textSearchTokens.map((t) => `full_name.ilike.%${t}%`);
      if (digitsOnly.length >= 4) {
        contactOr.push(`phone.ilike.%${digitsOnly}%`);
        contactOr.push(`cpf.ilike.%${digitsOnly}%`);
      }
      const [ctExtR, ctCloudR] = await Promise.all([
        db.from("contacts" as any).select("id, full_name, lead_id").or(contactOr.join(",")).is("deleted_at", null).limit(80),
        authClient.from("contacts" as any).select("id, full_name, lead_id").or(contactOr.join(",")).is("deleted_at", null).limit(80),
      ]);
      const contacts = [...((ctExtR.data || []) as any[]), ...((ctCloudR.data || []) as any[])].filter((ct: any) =>
        digitsOnly.length >= 4 || isLooseTokenMatch(q, ct.full_name)
      );

      // 4) Grupos de WhatsApp por nome → leads vinculados
      const { data: groupsRaw } = await db
        .from("lead_whatsapp_groups" as any)
        .select("lead_id, group_name")
        .or(textSearchTokens.map((t) => `group_name.ilike.%${t}%`).join(","))
        .limit(100);
      const groups = ((groupsRaw || []) as any[]).filter((g) => isLooseTokenMatch(q, g.group_name));

      // Para cada lead candidato (direto ou via contato), busca casos vinculados
      const candidateLeads = new Map<string, { lead_name: string | null; via: string }>();
      for (const l of leads as any[]) {
        candidateLeads.set(l.id, { lead_name: l.lead_name, via: "Lead" });
      }
      for (const ct of contacts) {
        if (ct.lead_id && !candidateLeads.has(ct.lead_id)) {
          candidateLeads.set(ct.lead_id, { lead_name: ct.full_name, via: `Contato "${ct.full_name}"` });
        }
        const { data: cl } = await db.from("contact_leads" as any).select("lead_id").eq("contact_id", ct.id);
        for (const link of (cl || []) as any[]) {
          if (!candidateLeads.has(link.lead_id)) {
            candidateLeads.set(link.lead_id, { lead_name: ct.full_name, via: `Contato "${ct.full_name}"` });
          }
        }
      }
      for (const g of groups as any[]) {
        if (g.lead_id && !candidateLeads.has(g.lead_id)) {
          candidateLeads.set(g.lead_id, { lead_name: g.group_name, via: `Grupo WhatsApp "${g.group_name}"` });
        }
      }

      for (const [leadId, info] of candidateLeads.entries()) {
        const { data: cs } = await db
          .from("legal_cases" as any)
          .select("id, case_number, title, lead_id")
          .eq("lead_id", leadId)
          .limit(5);
        if (cs && cs.length) {
          for (const c of cs as any[]) {
            if (!results.has(c.id)) results.set(c.id, { ...c, lead_name: info.lead_name, matched_via: info.via });
          }
        } else {
          // lead sem caso ainda — oferece criar
          const key = `lead:${leadId}`;
          results.set(key, {
            id: key,
            case_number: "(criar caso)",
            title: info.lead_name || "Lead sem caso ainda",
            lead_id: leadId,
            lead_name: info.lead_name,
            matched_via: info.via + " — sem caso. Clique para criar e vincular.",
            needs_case_creation: true,
          });
        }
      }

      setCaseOptions(Array.from(results.values()).slice(0, 20));
    };
    const t = setTimeout(run, 300);
    return () => clearTimeout(t);
  }, [linkingProc, caseSearch]);

  const INSS_FIELD_ID = "111f9a38-98c3-4f83-9095-5c469106a7bf";

  // Cria (ou atualiza) lead_processes com todos os dados do INSS puxados do email
  const upsertLeadProcess = async (caseId: string, leadId: string | null, proc: InssProcess) => {
    if (!proc.requerimento_number) return;
    // Pega o último despacho do histórico para popular description
    const { data: lastHist } = await db
      .from("inss_status_history" as any)
      .select("email_snippet, email_subject, email_received_at, to_status")
      .eq("process_id", proc.id)
      .order("email_received_at", { ascending: false })
      .limit(1);
    const last = (lastHist || [])[0] as any;

    const title = `INSS Administrativo — Req. ${proc.requerimento_number}${proc.benefit_type ? ` (${proc.benefit_type})` : ""}`;
    const descLines = [
      proc.nome_segurado ? `Segurado: ${proc.nome_segurado}` : null,
      proc.cpf_segurado ? `CPF: ${proc.cpf_segurado}` : null,
      proc.benefit_type ? `Benefício: ${proc.benefit_type}` : null,
      proc.benefit_number ? `NB: ${proc.benefit_number}` : null,
      proc.protocol_date ? `Protocolo: ${fmtDate(proc.protocol_date)}` : null,
      proc.current_status ? `Status: ${proc.current_status}` : null,
      last?.email_snippet ? `\nÚltimo despacho: ${last.email_snippet}` : null,
    ].filter(Boolean);

    // Já existe lead_processes para este requerimento? (procura por process_number ou case_id+tipo)
    const { data: existing } = await db
      .from("lead_processes" as any)
      .select("id")
      .eq("process_number", proc.requerimento_number)
      .limit(1);

    const payload: any = {
      lead_id: leadId,
      case_id: caseId,
      process_type: "inss_admin",
      process_number: proc.requerimento_number,
      title,
      description: descLines.join("\n"),
      status: proc.current_status || "Em andamento",
      started_at: proc.protocol_date || proc.created_at,
      fonte_nome: "INSS",
      fonte_tipo: "Administrativo",
      data_ultima_verificacao: proc.last_email_at,
    };

    if (existing && existing[0]) {
      await db.from("lead_processes" as any).update(payload).eq("id", (existing[0] as any).id);
    } else {
      await db.from("lead_processes" as any).insert({ ...payload, created_by: userId });
    }
  };

  const linkToCase = async (caseOpt: CaseOption) => {
    if (!linkingProc) return;
    setLinkingBusy(true);
    try {
      let caseId = caseOpt.id;
      let leadId = caseOpt.lead_id;
      let caseNumberLabel = caseOpt.case_number;

      // Se for um "lead sem caso", cria o caso primeiro
      if (caseOpt.needs_case_creation && leadId) {
        // gera número via RPC (usa specialized_nuclei se houver)
        const { data: newCaseNum } = await db.rpc("generate_case_number" as any, { p_nucleus_id: null } as any);
        const { data: newCase, error: caseErr } = await db
          .from("legal_cases" as any)
          .insert({
            lead_id: leadId,
            case_number: newCaseNum || `CASO-${Date.now()}`,
            title: linkingProc.nome_segurado || caseOpt.lead_name || "Caso INSS",
            status: "active",
          } as any)
          .select("id, case_number")
          .single();
        if (caseErr || !newCase) throw caseErr || new Error("Falha ao criar caso");
        caseId = (newCase as any).id;
        caseNumberLabel = (newCase as any).case_number;
      }

      const { error } = await db
        .from("inss_admin_processes" as any)
        .update({
          case_id: caseId,
          lead_id: leadId,
          linked_at: new Date().toISOString(),
          linked_by: userId,
        })
        .eq("id", linkingProc.id);
      if (error) throw error;

      // Memoriza nº do requerimento no lead (auto-match futuro)
      if (leadId && linkingProc.requerimento_number) {
        await db
          .from("lead_custom_field_values" as any)
          .upsert(
            {
              lead_id: leadId,
              field_id: INSS_FIELD_ID,
              value_text: linkingProc.requerimento_number,
            } as any,
            { onConflict: "lead_id,field_id" } as any
          );
      }

      // Cria/atualiza o lead_processes completo
      try {
        await upsertLeadProcess(caseId, leadId, linkingProc);
      } catch (e: any) {
        console.warn("Falha ao popular lead_processes:", e?.message);
        toast.warning("Vinculado, mas não consegui popular o processo no caso: " + (e?.message || ""));
      }

      toast.success("Processo vinculado ao caso " + caseNumberLabel);

      fetch(`${RAILWAY_BASE}/functions/notify-inss-update`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": (import.meta as any).env?.VITE_RAILWAY_API_KEY || "",
        },
        body: JSON.stringify({ process_id: linkingProc.id }),
      }).catch(() => {});

      setLinkingProc(null);
      loadProcesses();
    } catch (e: any) {
      toast.error("Erro ao vincular: " + e.message);
    } finally {
      setLinkingBusy(false);
    }
  };

  const runAutoMatch = async () => {
    toast.info("Procurando órfãos que casam com leads...");
    try {
      const resp = await fetch(`${RAILWAY_BASE}/functions/match-inss-orphans`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": (import.meta as any).env?.VITE_RAILWAY_API_KEY || "",
        },
        body: "{}",
      });
      const j = await resp.json();
      if (j.success) {
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
      const resp = await fetch(`${RAILWAY_BASE}/functions/auto-link-inss-by-name`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": (import.meta as any).env?.VITE_RAILWAY_API_KEY || "",
        },
        body: "{}",
      });
      const j = await resp.json();
      if (j.success) {
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
      const resp = await fetch(`${RAILWAY_BASE}/functions/bulk-link-inss-by-cpf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": (import.meta as any).env?.VITE_RAILWAY_API_KEY || "",
        },
        body: "{}",
      });
      const j = await resp.json();
      if (j.success) {
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
      const resp = await fetch(`${RAILWAY_BASE}/functions/auto-link-inss-by-name`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": (import.meta as any).env?.VITE_RAILWAY_API_KEY || "",
        },
        body: JSON.stringify({ dry_run: true }),
      });
      const j = await resp.json();
      if (!j.success) {
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
          <Button
            variant="outline"
            size="sm"
            onClick={runAutoMatch}
            className="gap-2"
            title="Tenta vincular órfãos a leads que tenham o nº do requerimento salvo"
          >
            <Sparkles className="h-4 w-4" />
            Vincular órfãos
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={runAutoLinkByName}
            className="gap-2"
            title="Vincula órfãos por nome (apenas quando há um único lead/contato candidato)"
          >
            <User className="h-4 w-4" />
            Vincular por nome
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
                      </div>
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        {p.nome_segurado && <div>👤 {p.nome_segurado}</div>}
                        {p.cpf_segurado && <div>CPF: {p.cpf_segurado}</div>}
                        {p.benefit_type && <div>Benefício: {p.benefit_type}</div>}
                        {p.benefit_number && <div>NB: {p.benefit_number}</div>}
                        {p.protocol_date && (
                          <div>📅 Protocolo: {fmtDate(p.protocol_date)}</div>
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

      {/* Dialog de vínculo */}
      <Dialog open={!!linkingProc} onOpenChange={(open) => !open && setLinkingProc(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Vincular {linkingProc?.requerimento_number} a um caso</DialogTitle>
            {linkingProc?.nome_segurado && (
              <p className="text-sm text-muted-foreground">
                Segurado: <span className="font-medium">{linkingProc.nome_segurado}</span>
                {linkingProc.cpf_segurado && <> · CPF {linkingProc.cpf_segurado}</>}
              </p>
            )}
          </DialogHeader>

          <div className="space-y-4">
            {/* Sugestões automáticas */}
            <div>
              <div className="flex items-center gap-2 text-sm font-medium mb-2">
                <Sparkles className="h-4 w-4 text-amber-500" />
                Sugestões automáticas
                {loadingSuggestions && (
                  <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
                )}
              </div>
              {loadingSuggestions ? (
                <div className="text-xs text-muted-foreground py-2">Procurando matches…</div>
              ) : suggestions.length === 0 ? (
                <div className="text-xs text-muted-foreground py-2">
                  Nenhum lead/contato encontrado com esse nome ou CPF. Use a busca manual abaixo.
                </div>
              ) : (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {suggestions.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="w-full text-left p-2 rounded-md hover:bg-muted text-sm border border-amber-200 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/10"
                      disabled={linkingBusy}
                      onClick={() => linkToCase(c)}
                    >
                      <div className="font-medium flex items-center gap-2">
                        {c.case_number}
                        {c.lead_name && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <User className="h-3 w-3" /> {c.lead_name}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{c.title}</div>
                      {c.matched_via && (
                        <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
                          ↳ {c.matched_via}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Busca manual */}
            <div>
              <div className="text-sm font-medium mb-2">Busca manual</div>
              <Input
                placeholder="Caso, lead, contato, telefone ou CPF..."
                value={caseSearch}
                onChange={(e) => setCaseSearch(e.target.value)}
              />
              <div className="max-h-48 overflow-y-auto space-y-1 mt-2">
                {caseOptions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`w-full text-left p-2 rounded hover:bg-muted text-sm border ${c.needs_case_creation ? "border-blue-300 bg-blue-50/40 dark:bg-blue-950/10" : ""}`}
                    disabled={linkingBusy}
                    onClick={() => linkToCase(c)}
                  >
                    <div className="font-medium flex items-center gap-2">
                      {c.case_number}
                      {c.lead_name && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <User className="h-3 w-3" /> {c.lead_name}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{c.title}</div>
                    {c.matched_via && (
                      <div className={`text-[11px] mt-0.5 ${c.needs_case_creation ? "text-blue-700 dark:text-blue-400" : "text-muted-foreground"}`}>
                        ↳ {c.matched_via}
                      </div>
                    )}
                  </button>
                ))}
                {caseSearch && caseOptions.length === 0 && (
                  <div className="text-xs text-muted-foreground text-center py-2">
                    Nenhum caso, lead ou contato encontrado.
                  </div>
                )}
              </div>
            </div>

          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkingProc(null)}>
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
