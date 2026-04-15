import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

const callExt = async (fn: string, body: any) => {
  const r = await fetch(`${FUNCTIONS_BASE}/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  return r.json();
};

const callSentryExt = async (params: string) => {
  const r = await fetch(`${FUNCTIONS_BASE}/sentry-issues${params}`, {
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
  });
  return r.json();
};

const SEV: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  critical: { label: "CRÍTICO", bg: "#FF2D2D", text: "#fff", dot: "#FF2D2D" },
  high:     { label: "ALTO",    bg: "#FF6B00", text: "#fff", dot: "#FF6B00" },
  medium:   { label: "MÉDIO",   bg: "#F5A623", text: "#fff", dot: "#F5A623" },
  low:      { label: "BAIXO",   bg: "#4CAF50", text: "#fff", dot: "#4CAF50" },
};

const STATUS: Record<string, { label: string; color: string }> = {
  open:        { label: "Aberto",               color: "#EF4444" },
  in_progress: { label: "Em andamento",         color: "#F59E0B" },
  resolved:    { label: "Resolvido",            color: "#10B981" },
  wont_fix:    { label: "Não será corrigido",   color: "#6B7280" },
};

const INSTANCES = [
  "atendimento-previdenciario", "cris", "paloma", "andreza", "leticia",
  "raym", "jessica", "deyvid", "wjia", "abraci-geral",
];

export default function BugMonitorPage() {
  const [tab, setTab]                   = useState("queue");
  const [bugs, setBugs]                 = useState<any[]>([]);
  const [sentryIssues, setSentryIssues] = useState<any[]>([]);
  const [loading, setLoading]           = useState(false);
  const [sentryLoading, setSentryLoading] = useState(false);
  const [selected, setSelected]         = useState<any>(null);
  const [showReport, setShowReport]     = useState(false);
  const [showResolve, setShowResolve]   = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [toast, setToast]               = useState<{ msg: string; type: string } | null>(null);

  const [form, setForm] = useState({
    title: "", description: "", severity: "medium",
    steps_to_reproduce: "", reported_by: "",
    notify_instance_name: "", notify_phone: "",
  });
  const [resolveForm, setResolveForm] = useState({
    status: "resolved", resolution_notes: "",
    notify_instance_name: "", notify_phone: "",
  });

  const showToast = (msg: string, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadBugs = useCallback(async () => {
    setLoading(true);
    const res = await callExt("bug-manager", {
      action: "list",
      status_filter: statusFilter || undefined,
      limit: 100,
    });
    if (res.data) setBugs(res.data);
    setLoading(false);
  }, [statusFilter]);

  const loadSentry = useCallback(async () => {
    setSentryLoading(true);
    try {
      const data = await callSentryExt("?endpoint=issues&query=is:unresolved&statsPeriod=14d");
      setSentryIssues(Array.isArray(data) ? data : []);
    } catch { setSentryIssues([]); }
    setSentryLoading(false);
  }, []);

  useEffect(() => { loadBugs(); }, [loadBugs]);
  useEffect(() => { if (tab === "sentry") loadSentry(); }, [tab, loadSentry]);

  const submitReport = async () => {
    if (!form.title.trim()) return showToast("Título obrigatório", "error");
    const res = await callExt("bug-manager", { action: "report", source: "manual", ...form });
    if (res.success) {
      showToast("Bug reportado com sucesso!");
      setShowReport(false);
      setForm({ title: "", description: "", severity: "medium", steps_to_reproduce: "", reported_by: "", notify_instance_name: "", notify_phone: "" });
      loadBugs();
    } else showToast(res.error || "Erro ao reportar", "error");
  };

  const submitResolve = async (id: string) => {
    const res = await callExt("bug-manager", { action: "update_status", id, ...resolveForm });
    if (res.success) {
      showToast(`Status atualizado${resolveForm.notify_phone ? " — notificação enviada!" : ""}!`);
      setShowResolve(null);
      setResolveForm({ status: "resolved", resolution_notes: "", notify_instance_name: "", notify_phone: "" });
      loadBugs();
    } else showToast(res.error || "Erro ao atualizar", "error");
  };

  const importFromSentry = async (issue: any) => {
    const res = await callExt("bug-manager", {
      action: "report", source: "sentry",
      title: issue.title || issue.culprit || "Erro Sentry",
      description: `${issue.metadata?.value || ""}\n\nPrimeiro evento: ${issue.firstSeen}\nÚltimo evento: ${issue.lastSeen}\nOcorrências: ${issue.count}`,
      severity: issue.level === "fatal" ? "critical" : issue.level === "error" ? "high" : "medium",
      sentry_issue_id: issue.id,
      sentry_issue_url: issue.permalink,
      error_details: { level: issue.level, count: issue.count, firstSeen: issue.firstSeen, lastSeen: issue.lastSeen },
    });
    if (res.success) { showToast("Issue importado para a fila!"); loadBugs(); }
    else showToast(res.error || "Erro", "error");
  };

  const openBugs   = bugs.filter(b => b.status === "open").length;
  const inProgress = bugs.filter(b => b.status === "in_progress").length;
  const criticals  = bugs.filter(b => b.severity === "critical" && b.status !== "resolved" && b.status !== "wont_fix").length;

  return (
    <div style={{ fontFamily: "'Fira Code','Courier New',monospace", background: "#0D0D0D", minHeight: "100vh", color: "#E8E8E8" }}>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 20, right: 20, zIndex: 9999, background: toast.type === "error" ? "#7F1D1D" : "#14532D", border: `1px solid ${toast.type === "error" ? "#EF4444" : "#16A34A"}`, color: "#fff", padding: "12px 20px", borderRadius: 6, fontFamily: "inherit", fontSize: 13, boxShadow: "0 4px 24px rgba(0,0,0,.5)" }}>
          {toast.type === "error" ? "✗" : "✓"} {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ background: "#111", borderBottom: "1px solid #222", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: criticals > 0 ? "#EF4444" : "#16A34A", boxShadow: criticals > 0 ? "0 0 8px #EF4444" : "0 0 8px #16A34A" }} />
          <span style={{ fontSize: 13, letterSpacing: 3, textTransform: "uppercase", color: "#666" }}>Bug Monitor</span>
          <span style={{ fontSize: 13, color: "#333" }}>/</span>
          <span style={{ fontSize: 13, color: "#888" }}>prudencio-advogados</span>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          {criticals > 0 && <span style={{ fontSize: 11, background: "#7F1D1D", color: "#FCA5A5", padding: "3px 8px", borderRadius: 3, letterSpacing: 1 }}>⚠ {criticals} CRÍTICO{criticals > 1 ? "S" : ""}</span>}
          <button onClick={() => setShowReport(true)} style={{ background: "#1a1a1a", border: "1px solid #333", color: "#E8E8E8", padding: "7px 16px", borderRadius: 4, cursor: "pointer", fontSize: 12, letterSpacing: 1, fontFamily: "inherit" }}>
            + REPORTAR BUG
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "flex", borderBottom: "1px solid #1a1a1a", background: "#0f0f0f" }}>
        {[
          { label: "ABERTOS",      value: openBugs,                                           color: "#EF4444" },
          { label: "EM ANDAMENTO", value: inProgress,                                         color: "#F59E0B" },
          { label: "TOTAL",        value: bugs.length,                                        color: "#6B7280" },
          { label: "RESOLVIDOS",   value: bugs.filter(b => b.status === "resolved").length,   color: "#10B981" },
        ].map(s => (
          <div key={s.label} style={{ flex: 1, padding: "14px 24px", borderRight: "1px solid #1a1a1a" }}>
            <div style={{ fontSize: 10, color: "#444", letterSpacing: 2, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: "bold", color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #1a1a1a", background: "#0f0f0f", padding: "0 24px" }}>
        {[["queue", "FILA DE BUGS"], ["sentry", "SENTRY ISSUES"]].map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{ background: "none", border: "none", color: tab === t ? "#E8E8E8" : "#555", padding: "12px 20px 10px", cursor: "pointer", fontSize: 11, letterSpacing: 2, borderBottom: tab === t ? "2px solid #E8E8E8" : "2px solid transparent", fontFamily: "inherit" }}>
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: 24 }}>

        {/* ── FILA DE BUGS ── */}
        {tab === "queue" && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              {["", "open", "in_progress", "resolved", "wont_fix"].map(s => (
                <button key={s} onClick={() => { setStatusFilter(s); setTimeout(loadBugs, 50); }} style={{ background: statusFilter === s ? "#1a1a1a" : "none", border: `1px solid ${statusFilter === s ? "#444" : "#222"}`, color: statusFilter === s ? "#E8E8E8" : "#555", padding: "5px 12px", borderRadius: 3, cursor: "pointer", fontSize: 11, letterSpacing: 1, fontFamily: "inherit" }}>
                  {s === "" ? "TODOS" : (STATUS[s]?.label.toUpperCase() || s.toUpperCase())}
                </button>
              ))}
              <button onClick={loadBugs} style={{ background: "none", border: "1px solid #222", color: "#555", padding: "5px 12px", borderRadius: 3, cursor: "pointer", fontSize: 11, letterSpacing: 1, fontFamily: "inherit", marginLeft: "auto" }}>↻ ATUALIZAR</button>
            </div>

            {loading ? (
              <div style={{ color: "#444", fontSize: 13, padding: "40px 0", textAlign: "center", letterSpacing: 2 }}>CARREGANDO...</div>
            ) : bugs.length === 0 ? (
              <div style={{ color: "#333", fontSize: 13, padding: "60px 0", textAlign: "center", letterSpacing: 2 }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
                NENHUM BUG NA FILA
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {bugs.map(bug => (
                  <div key={bug.id} style={{ background: "#111", border: `1px solid ${selected?.id === bug.id ? "#333" : "#1a1a1a"}`, borderRadius: 4, overflow: "hidden" }}>
                    <div onClick={() => setSelected(selected?.id === bug.id ? null : bug)} style={{ padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: SEV[bug.severity]?.dot || "#666", flexShrink: 0, boxShadow: bug.severity === "critical" ? `0 0 6px ${SEV[bug.severity].dot}` : "none" }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
                          <span style={{ fontSize: 13, color: "#E8E8E8", fontWeight: 500 }}>{bug.title}</span>
                          {bug.source === "sentry"        && <span style={{ fontSize: 9, background: "#1a0a2e", color: "#a78bfa", padding: "2px 6px", borderRadius: 2, letterSpacing: 1 }}>SENTRY</span>}
                          {bug.edge_function              && <span style={{ fontSize: 9, background: "#0f1a2e", color: "#60a5fa", padding: "2px 6px", borderRadius: 2, letterSpacing: 1 }}>{bug.edge_function}</span>}
                        </div>
                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                          <span style={{ fontSize: 10, background: SEV[bug.severity]?.bg || "#333", color: SEV[bug.severity]?.text || "#fff", padding: "1px 6px", borderRadius: 2, letterSpacing: 1 }}>{SEV[bug.severity]?.label || bug.severity}</span>
                          <span style={{ fontSize: 10, color: STATUS[bug.status]?.color || "#666", letterSpacing: 1 }}>{STATUS[bug.status]?.label || bug.status}</span>
                          {bug.reported_by && <span style={{ fontSize: 10, color: "#444" }}>por {bug.reported_by}</span>}
                          <span style={{ fontSize: 10, color: "#333", marginLeft: "auto" }}>{new Date(bug.created_at).toLocaleString("pt-BR")}</span>
                        </div>
                      </div>
                      <span style={{ color: "#444", fontSize: 12 }}>{selected?.id === bug.id ? "▲" : "▼"}</span>
                    </div>

                    {selected?.id === bug.id && (
                      <div style={{ padding: "0 18px 18px", borderTop: "1px solid #1a1a1a" }}>
                        {bug.description         && <div style={{ marginTop: 12, fontSize: 12, color: "#777", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{bug.description}</div>}
                        {bug.steps_to_reproduce  && <div style={{ marginTop: 10 }}><span style={{ fontSize: 10, color: "#444", letterSpacing: 1 }}>STEPS:</span><div style={{ fontSize: 11, color: "#666", marginTop: 4, whiteSpace: "pre-wrap", background: "#0a0a0a", padding: "8px 12px", borderRadius: 3 }}>{bug.steps_to_reproduce}</div></div>}
                        {bug.resolution_notes    && <div style={{ marginTop: 10 }}><span style={{ fontSize: 10, color: "#444", letterSpacing: 1 }}>RESOLUÇÃO:</span><div style={{ fontSize: 11, color: "#16A34A", marginTop: 4 }}>{bug.resolution_notes}</div></div>}
                        {bug.notify_phone        && <div style={{ marginTop: 8, fontSize: 11, color: "#444" }}>📱 Notificar: {bug.notify_phone} via {bug.notify_instance_name}</div>}
                        {bug.sentry_issue_url    && <a href={bug.sentry_issue_url} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 8, fontSize: 11, color: "#a78bfa", textDecoration: "none" }}>↗ Ver no Sentry</a>}

                        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                          {bug.status !== "resolved" && bug.status !== "wont_fix" && (
                            <button onClick={() => { setShowResolve(bug); setResolveForm({ status: "resolved", resolution_notes: "", notify_instance_name: bug.notify_instance_name || "", notify_phone: bug.notify_phone || "" }); }} style={{ background: "#14532D", border: "1px solid #16A34A", color: "#4ADE80", padding: "6px 14px", borderRadius: 3, cursor: "pointer", fontSize: 11, letterSpacing: 1, fontFamily: "inherit" }}>
                              ✓ RESOLVER
                            </button>
                          )}
                          {bug.status === "open" && (
                            <button onClick={async () => { await callExt("bug-manager", { action: "update_status", id: bug.id, status: "in_progress" }); loadBugs(); }} style={{ background: "#451a03", border: "1px solid #F59E0B", color: "#FCD34D", padding: "6px 14px", borderRadius: 3, cursor: "pointer", fontSize: 11, letterSpacing: 1, fontFamily: "inherit" }}>
                              → EM ANDAMENTO
                            </button>
                          )}
                          <button onClick={() => { setShowResolve(bug); setResolveForm({ status: "wont_fix", resolution_notes: "", notify_instance_name: bug.notify_instance_name || "", notify_phone: bug.notify_phone || "" }); }} style={{ background: "none", border: "1px solid #333", color: "#666", padding: "6px 14px", borderRadius: 3, cursor: "pointer", fontSize: 11, letterSpacing: 1, fontFamily: "inherit" }}>
                            ✕ NÃO CORRIGIR
                          </button>
                          <button onClick={async () => { if (confirm("Deletar este bug report?")) { await callExt("bug-manager", { action: "delete", id: bug.id }); loadBugs(); } }} style={{ background: "none", border: "1px solid #1a1a1a", color: "#333", padding: "6px 10px", borderRadius: 3, cursor: "pointer", fontSize: 11, fontFamily: "inherit", marginLeft: "auto" }}>
                            🗑
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── SENTRY ISSUES ── */}
        {tab === "sentry" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <span style={{ fontSize: 11, color: "#444", letterSpacing: 2 }}>ÚLTIMOS 7 DIAS — is:unresolved</span>
              <button onClick={loadSentry} style={{ background: "none", border: "1px solid #222", color: "#555", padding: "5px 12px", borderRadius: 3, cursor: "pointer", fontSize: 11, letterSpacing: 1, fontFamily: "inherit" }}>↻ ATUALIZAR</button>
            </div>
            {sentryLoading ? (
              <div style={{ color: "#444", fontSize: 13, padding: "40px 0", textAlign: "center", letterSpacing: 2 }}>CARREGANDO SENTRY...</div>
            ) : sentryIssues.length === 0 ? (
              <div style={{ color: "#333", fontSize: 13, padding: "60px 0", textAlign: "center", letterSpacing: 2 }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
                NENHUM ISSUE ABERTO
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {sentryIssues.map((issue: any) => (
                  <div key={issue.id} style={{ background: "#111", border: "1px solid #1a1a1a", borderRadius: 4, padding: "14px 18px", display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: issue.level === "fatal" ? "#FF2D2D" : issue.level === "error" ? "#FF6B00" : "#F5A623", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: "#E8E8E8", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{issue.title}</div>
                      <div style={{ display: "flex", gap: 10 }}>
                        <span style={{ fontSize: 10, color: "#555", letterSpacing: 1 }}>{issue.level?.toUpperCase()}</span>
                        <span style={{ fontSize: 10, color: "#444" }}>{issue.count} ocorrências</span>
                        <span style={{ fontSize: 10, color: "#333" }}>último: {new Date(issue.lastSeen).toLocaleString("pt-BR")}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button onClick={() => importFromSentry(issue)} style={{ background: "#0f1a2e", border: "1px solid #1d4ed8", color: "#93c5fd", padding: "5px 12px", borderRadius: 3, cursor: "pointer", fontSize: 10, letterSpacing: 1, fontFamily: "inherit" }}>
                        + FILA
                      </button>
                      {issue.permalink && <a href={issue.permalink} target="_blank" rel="noreferrer" style={{ background: "#1a0a2e", border: "1px solid #6d28d9", color: "#c4b5fd", padding: "5px 10px", borderRadius: 3, fontSize: 10, textDecoration: "none" }}>↗</a>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Modal: Reportar Bug ── */}
      {showReport && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "#111", border: "1px solid #2a2a2a", borderRadius: 6, padding: 28, width: "100%", maxWidth: 540, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <span style={{ fontSize: 12, letterSpacing: 3, color: "#888", textTransform: "uppercase" }}>Reportar Bug</span>
              <button onClick={() => setShowReport(false)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 18 }}>×</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {([
                { label: "TÍTULO *",              key: "title",               type: "text",     placeholder: "Ex: Webhook 500 em mensagens de áudio" },
                { label: "DESCRIÇÃO",             key: "description",         type: "textarea", placeholder: "O que aconteceu? Qual o impacto?" },
                { label: "STEPS TO REPRODUCE",   key: "steps_to_reproduce",  type: "textarea", placeholder: "1. Enviar áudio\n2. Verificar logs\n3. Erro 500" },
                { label: "REPORTADO POR",         key: "reported_by",         type: "text",     placeholder: "Seu nome" },
                { label: "NOTIFICAR TELEFONE",    key: "notify_phone",        type: "text",     placeholder: "5586999999999" },
              ] as const).map(f => (
                <div key={f.key}>
                  <div style={{ fontSize: 9, color: "#444", letterSpacing: 2, marginBottom: 5 }}>{f.label}</div>
                  {f.type === "textarea" ? (
                    <textarea value={form[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.value })} placeholder={f.placeholder} rows={3}
                      style={{ width: "100%", background: "#0a0a0a", border: "1px solid #222", color: "#E8E8E8", padding: "8px 12px", borderRadius: 3, fontSize: 12, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
                  ) : (
                    <input value={form[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.value })} placeholder={f.placeholder}
                      style={{ width: "100%", background: "#0a0a0a", border: "1px solid #222", color: "#E8E8E8", padding: "8px 12px", borderRadius: 3, fontSize: 12, fontFamily: "inherit", boxSizing: "border-box" }} />
                  )}
                </div>
              ))}
              <div>
                <div style={{ fontSize: 9, color: "#444", letterSpacing: 2, marginBottom: 5 }}>INSTÂNCIA PARA NOTIFICAR</div>
                <select value={form.notify_instance_name} onChange={e => setForm({ ...form, notify_instance_name: e.target.value })}
                  style={{ width: "100%", background: "#0a0a0a", border: "1px solid #222", color: "#E8E8E8", padding: "8px 12px", borderRadius: 3, fontSize: 12, fontFamily: "inherit" }}>
                  <option value="">Nenhuma</option>
                  {INSTANCES.map(i => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 9, color: "#444", letterSpacing: 2, marginBottom: 5 }}>SEVERIDADE</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {Object.entries(SEV).map(([k, v]) => (
                    <button key={k} onClick={() => setForm({ ...form, severity: k })}
                      style={{ flex: 1, background: form.severity === k ? v.bg : "#0a0a0a", border: `1px solid ${form.severity === k ? v.bg : "#222"}`, color: form.severity === k ? v.text : "#555", padding: "6px 0", borderRadius: 3, cursor: "pointer", fontSize: 10, letterSpacing: 1, fontFamily: "inherit" }}>
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={submitReport} style={{ flex: 1, background: "#14532D", border: "1px solid #16A34A", color: "#4ADE80", padding: "10px", borderRadius: 3, cursor: "pointer", fontSize: 12, letterSpacing: 2, fontFamily: "inherit" }}>ENVIAR REPORTE</button>
                <button onClick={() => setShowReport(false)} style={{ background: "none", border: "1px solid #222", color: "#555", padding: "10px 16px", borderRadius: 3, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Resolver ── */}
      {showResolve && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "#111", border: "1px solid #2a2a2a", borderRadius: 6, padding: 28, width: "100%", maxWidth: 480 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <span style={{ fontSize: 12, letterSpacing: 3, color: "#888" }}>ATUALIZAR STATUS</span>
              <button onClick={() => setShowResolve(null)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 18 }}>×</button>
            </div>
            <div style={{ fontSize: 13, color: "#777", marginBottom: 20, padding: "10px 14px", background: "#0a0a0a", borderRadius: 3 }}>{showResolve.title}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <div style={{ fontSize: 9, color: "#444", letterSpacing: 2, marginBottom: 5 }}>STATUS</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {([["resolved", "RESOLVIDO", "#14532D", "#16A34A", "#4ADE80"], ["wont_fix", "NÃO CORRIGIR", "#1a1a1a", "#333", "#666"]] as const).map(([s, l, bg, border, color]) => (
                    <button key={s} onClick={() => setResolveForm({ ...resolveForm, status: s })}
                      style={{ flex: 1, background: resolveForm.status === s ? bg : "#0a0a0a", border: `1px solid ${resolveForm.status === s ? border : "#222"}`, color: resolveForm.status === s ? color : "#555", padding: "8px", borderRadius: 3, cursor: "pointer", fontSize: 11, letterSpacing: 1, fontFamily: "inherit" }}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 9, color: "#444", letterSpacing: 2, marginBottom: 5 }}>NOTAS DE RESOLUÇÃO</div>
                <textarea value={resolveForm.resolution_notes} onChange={e => setResolveForm({ ...resolveForm, resolution_notes: e.target.value })} placeholder="O que foi feito para resolver?" rows={3}
                  style={{ width: "100%", background: "#0a0a0a", border: "1px solid #222", color: "#E8E8E8", padding: "8px 12px", borderRadius: 3, fontSize: 12, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
              </div>
              <div style={{ background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 4, padding: 14 }}>
                <div style={{ fontSize: 9, color: "#444", letterSpacing: 2, marginBottom: 10 }}>📱 NOTIFICAÇÃO WHATSAPP (opcional)</div>
                <div style={{ fontSize: 9, color: "#333", letterSpacing: 2, marginBottom: 5 }}>INSTÂNCIA</div>
                <select value={resolveForm.notify_instance_name} onChange={e => setResolveForm({ ...resolveForm, notify_instance_name: e.target.value })}
                  style={{ width: "100%", background: "#111", border: "1px solid #222", color: "#E8E8E8", padding: "7px 10px", borderRadius: 3, fontSize: 11, fontFamily: "inherit", marginBottom: 8 }}>
                  <option value="">Nenhuma</option>
                  {INSTANCES.map(i => <option key={i} value={i}>{i}</option>)}
                </select>
                <div style={{ fontSize: 9, color: "#333", letterSpacing: 2, marginBottom: 5 }}>TELEFONE</div>
                <input value={resolveForm.notify_phone} onChange={e => setResolveForm({ ...resolveForm, notify_phone: e.target.value })} placeholder="5586999999999"
                  style={{ width: "100%", background: "#111", border: "1px solid #222", color: "#E8E8E8", padding: "7px 10px", borderRadius: 3, fontSize: 11, fontFamily: "inherit", boxSizing: "border-box" }} />
                {resolveForm.notify_phone && <div style={{ fontSize: 10, color: "#555", marginTop: 6 }}>↳ Enviará WhatsApp automaticamente ao confirmar</div>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => submitResolve(showResolve.id)} style={{ flex: 1, background: "#14532D", border: "1px solid #16A34A", color: "#4ADE80", padding: "10px", borderRadius: 3, cursor: "pointer", fontSize: 12, letterSpacing: 2, fontFamily: "inherit" }}>CONFIRMAR</button>
                <button onClick={() => setShowResolve(null)} style={{ background: "none", border: "1px solid #222", color: "#555", padding: "10px 16px", borderRadius: 3, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
