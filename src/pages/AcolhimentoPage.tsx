import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/supabase";
import { useKanbanBoards, KanbanStage } from "@/hooks/useKanbanBoards";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Phone, MessageCircle, ExternalLink, Newspaper, X } from "lucide-react";

const DEFAULT_BOARD_ID = "2dcd54b5-502b-413b-b795-5e24a20797d2";

// -------------------- Utils --------------------
const fmtDate = (s?: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleDateString("pt-BR");
};
const initials = (name?: string | null) => {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
};
const onlyDigits = (s?: string | null) => (s || "").replace(/\D/g, "");
const maskPhone = (s?: string | null) => {
  const d = onlyDigits(s);
  if (!d) return "—";
  if (d.length >= 11)
    return `(${d.slice(-11, -9)}) ${d.slice(-9, -8)} ${d.slice(-8, -4)}-${d.slice(-4)}`;
  return s || "—";
};
const daysBetween = (iso?: string | null) => {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
};

// Rampa teal (1 cor)
function tealBg(intensity: number) {
  if (intensity <= 0) return "transparent";
  if (intensity < 0.15) return "#E1F5EE";
  if (intensity < 0.4) return "#9FE1CB";
  if (intensity < 0.7) return "#5DCAA5";
  return "#1D9E75";
}
function tealText(intensity: number) {
  return intensity >= 0.55 ? "#ffffff" : "#0F3B2C";
}

// -------------------- Hook único de leads --------------------
type LeadRow = {
  id: string;
  lead_name: string | null;
  victim_name: string | null;
  acolhedor: string | null;
  status: string | null;
  updated_at: string | null;
  created_at: string | null;
  lead_phone: string | null;
  cpf: string | null;
  campaign_name: string | null;
  ad_name: string | null;
  city: string | null;
  visit_city: string | null;
  sector: string | null;
  contractor_company: string | null;
  main_company: string | null;
  victim_age: number | null;
  accident_date: string | null;
  accident_address: string | null;
  legal_viability: string | null;
  news_link: string | null;
  news_links: any;
  case_number: string | null;
};

// Query leve: só o necessário pra KPIs, funil, aging e matriz.
function useBoardLeads(boardId: string | null) {
  return useQuery({
    enabled: !!boardId,
    queryKey: ["acolhimento", "leads-lite", boardId],
    staleTime: 60_000,
    queryFn: async () => {
      const cols =
        "id, lead_name, victim_name, acolhedor, status, updated_at, created_at, city, visit_city, news_link, case_number";
      const pageSize = 1000;
      let from = 0;
      const rows: LeadRow[] = [];
      while (true) {
        const { data, error } = await db
          .from("leads")
          .select(cols as any)
          .eq("board_id", boardId!)
          .is("deleted_at", null)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const chunk = (data || []) as unknown as LeadRow[];
        rows.push(...chunk);
        if (chunk.length < pageSize) break;
        from += pageSize;
        if (from > 20_000) break;
      }
      return rows;
    },
  });
}

// Query pesada: detalhes da ficha, só quando um lead é selecionado.
function useLeadDetail(leadId: string | null) {
  return useQuery({
    enabled: !!leadId,
    queryKey: ["acolhimento", "lead-detail", leadId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const cols =
        "id, lead_name, victim_name, acolhedor, status, updated_at, created_at, lead_phone, cpf, campaign_name, ad_name, city, visit_city, sector, contractor_company, main_company, victim_age, accident_date, accident_address, legal_viability, news_link, news_links, case_number";
      const { data, error } = await db
        .from("leads")
        .select(cols as any)
        .eq("id", leadId!)
        .maybeSingle();
      if (error) throw error;
      return (data || null) as unknown as LeadRow | null;
    },
  });
}

// -------------------- Sub-componentes --------------------
function KpiCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "brand" | "danger" | "warn";
}) {
  const toneClass =
    tone === "brand"
      ? "text-[#1D9E75]"
      : tone === "danger"
        ? "text-red-600"
        : tone === "warn"
          ? "text-amber-600"
          : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={cn("text-3xl font-semibold mt-1", toneClass)}>{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

interface FunilRow {
  id: string;
  name: string;
  color: string;
  leads: number;
  pct: number;
  mediana: number;
}

function Funil({ rows }: { rows: FunilRow[] }) {
  const max = Math.max(...rows.map((f) => f.leads), 1);
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="text-sm font-medium mb-2">Funil</div>
        {rows.map((s) => {
          const width = (s.leads / max) * 100;
          const label = `${s.leads.toLocaleString("pt-BR")} · ${s.pct.toFixed(1)}%`;
          const insideThreshold = 22; // % — abaixo disso, número vai pra fora
          const showInside = width >= insideThreshold;
          return (
            <div key={s.id} className="flex items-center gap-3">
              <div className="w-40 text-xs text-muted-foreground truncate" title={s.name}>
                {s.name}
              </div>
              <div className="flex-1 h-7 rounded bg-muted/40 overflow-hidden relative flex items-center">
                <div
                  className="h-full flex items-center px-2 text-xs font-medium text-white transition-[width] duration-500"
                  style={{
                    width: `${Math.max(width, 2)}%`,
                    background: s.color || "#1D9E75",
                    minWidth: s.leads > 0 ? 6 : 0,
                  }}
                >
                  {showInside && <span className="truncate">{label}</span>}
                </div>
                {!showInside && s.leads > 0 && (
                  <span className="ml-2 text-xs font-medium text-foreground tabular-nums whitespace-nowrap">
                    {label}
                  </span>
                )}
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "min-w-[70px] justify-center text-xs",
                  s.mediana >= 60 ? "border-red-500 text-red-600" : ""
                )}
              >
                med. {s.mediana}d
              </Badge>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="text-xs text-muted-foreground py-4 text-center">
            Este funil ainda não tem etapas configuradas.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface AgingRow {
  id: string;
  name: string;
  buckets: { d_0_3: number; d_4_7: number; d_8_30: number; d_31_90: number; d_90mais: number };
}

function AgingHeat({ rows }: { rows: AgingRow[] }) {
  const cols = [
    { key: "d_0_3" as const, label: "0-3d" },
    { key: "d_4_7" as const, label: "4-7d" },
    { key: "d_8_30" as const, label: "8-30d" },
    { key: "d_31_90" as const, label: "31-90d" },
    { key: "d_90mais" as const, label: "+90d" },
  ];
  const maxByCol: Record<string, number> = {};
  for (const c of cols)
    maxByCol[c.key] = Math.max(...rows.map((r) => r.buckets[c.key] ?? 0), 1);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm font-medium mb-3">Raio-x de aging</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-separate border-spacing-1">
            <thead>
              <tr>
                <th className="text-left font-normal text-muted-foreground">Etapa</th>
                {cols.map((c) => (
                  <th key={c.key} className="text-center font-normal text-muted-foreground">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="pr-2 py-1 whitespace-nowrap">{r.name}</td>
                  {cols.map((c) => {
                    const v = r.buckets[c.key] ?? 0;
                    const i = v / maxByCol[c.key];
                    return (
                      <td
                        key={c.key}
                        className="text-center rounded px-2 py-1 tabular-nums"
                        style={{
                          background: tealBg(i),
                          color: v ? tealText(i) : "hsl(var(--muted-foreground))",
                          minWidth: 44,
                        }}
                      >
                        {v ? v.toLocaleString("pt-BR") : "·"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Matriz({
  stages,
  matriz,
  selected,
  onSelect,
}: {
  stages: KanbanStage[];
  matriz: Map<string, Record<string, number>>;
  selected: { acolhedor: string; status: string } | null;
  onSelect: (a: string, s: string) => void;
}) {
  const rows: Array<{ name: string; buckets: Record<string, number>; total: number }> = [];
  for (const [name, buckets] of matriz.entries()) {
    const total = stages.reduce((s, st) => s + (buckets[st.id] || 0), 0);
    rows.push({ name, buckets, total });
  }
  rows.sort((a, b) => b.total - a.total);

  const maxByCol: Record<string, number> = {};
  for (const st of stages) {
    maxByCol[st.id] = Math.max(...rows.map((r) => r.buckets[st.id] || 0), 1);
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm font-medium mb-3">KPI por acolhedor × fase</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-separate border-spacing-1">
            <thead>
              <tr>
                <th className="text-left font-normal text-muted-foreground min-w-[180px]">
                  Acolhedor
                </th>
                {stages.map((st) => (
                  <th
                    key={st.id}
                    className="text-center font-normal text-muted-foreground px-1"
                    title={st.name}
                  >
                    <div className="flex flex-col items-center gap-1">
                      <span
                        className="inline-block h-2 w-8 rounded-full"
                        style={{ background: st.color }}
                      />
                      <span className="max-w-[80px] leading-tight">{st.name}</span>
                    </div>
                  </th>
                ))}
                <th className="text-center font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td className="pr-2 py-1 whitespace-nowrap">
                    <span
                      className={cn(
                        r.name === "(sem dono)" ? "text-amber-600 font-medium" : ""
                      )}
                    >
                      {r.name}
                    </span>
                  </td>
                  {stages.map((st) => {
                    const v = r.buckets[st.id] || 0;
                    const i = v / maxByCol[st.id];
                    const isSel =
                      selected?.acolhedor === r.name && selected?.status === st.id && v > 0;
                    return (
                      <td key={st.id} className="p-0">
                        <button
                          disabled={v === 0}
                          onClick={() => onSelect(r.name, st.id)}
                          className={cn(
                            "w-full h-8 rounded tabular-nums transition-all",
                            v > 0 ? "cursor-pointer hover:brightness-95" : "cursor-default",
                            isSel ? "ring-2 ring-[#185FA5]" : ""
                          )}
                          style={{
                            background: v > 0 ? tealBg(i) : "transparent",
                            color: v > 0 ? tealText(i) : "hsl(var(--muted-foreground))",
                          }}
                        >
                          {v || "·"}
                        </button>
                      </td>
                    );
                  })}
                  <td className="text-center font-semibold tabular-nums px-2">{r.total}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={stages.length + 2}
                    className="text-center text-muted-foreground py-4"
                  >
                    Nenhum lead neste funil.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function LeadFicha({
  lead,
  stage,
  onClose,
}: {
  lead: LeadRow & { dias_parado?: number };
  stage: KanbanStage | null;
  onClose: () => void;
}) {
  const phone = onlyDigits(lead.lead_phone);
  const news = lead.news_link && String(lead.news_link).trim() ? String(lead.news_link) : null;
  const newsExtra = Array.isArray(lead.news_links) ? lead.news_links.length : 0;
  const parado = lead.dias_parado ?? 0;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">
              {lead.victim_name || lead.lead_name || "Sem nome"}
            </div>
            <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-2">
              {stage && (
                <Badge style={{ background: stage.color, color: "white" }}>{stage.name}</Badge>
              )}
              <Badge
                variant="outline"
                className={parado >= 60 ? "border-red-500 text-red-600" : ""}
              >
                parado há {parado}d
              </Badge>
              <span
                className={
                  lead.acolhedor === "(sem dono)" || !lead.acolhedor
                    ? "text-amber-600 font-medium"
                    : "text-muted-foreground"
                }
              >
                {lead.acolhedor || "(sem dono)"}
              </span>
            </div>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Info label="Idade" value={lead.victim_age ? `${lead.victim_age} anos` : "—"} />
          <Info label="Viabilidade" value={lead.legal_viability || "—"} />
          <Info label="Empresa" value={lead.contractor_company || lead.main_company || "—"} />
          <Info label="Setor" value={lead.sector || "—"} />
          <Info label="Cidade" value={lead.city || lead.visit_city || "—"} />
          <Info label="Cidade da visita" value={lead.visit_city || "—"} />
          <Info label="Data do acidente" value={fmtDate(lead.accident_date)} />
          <Info label="Endereço" value={lead.accident_address || "—"} />
          <Info label="Telefone" value={maskPhone(lead.lead_phone)} />
          <Info label="CPF" value={lead.cpf ? "•••.•••.•••-" + String(lead.cpf).slice(-2) : "—"} />
          <Info label="Campanha" value={lead.campaign_name || "—"} />
          <Info label="Anúncio" value={lead.ad_name || "—"} />
        </div>

        <div className="mt-4">
          <div className="text-xs uppercase text-muted-foreground mb-1">Notícia</div>
          {news ? (
            <a
              href={news}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-[#1D9E75] hover:underline"
            >
              <Newspaper className="h-3.5 w-3.5" />
              Abrir notícia{newsExtra > 1 ? ` (+${newsExtra - 1})` : ""}
            </a>
          ) : (
            <div className="text-sm text-muted-foreground">não veio de notícia</div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!phone}
            onClick={() => phone && (window.location.href = `tel:${phone}`)}
          >
            <Phone className="h-3.5 w-3.5 mr-1" /> Ligar
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!phone}
            onClick={() =>
              phone && window.open(`https://wa.me/${phone}`, "_blank", "noopener,noreferrer")
            }
          >
            <MessageCircle className="h-3.5 w-3.5 mr-1" /> WhatsApp
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.open(`/leads?leadId=${lead.id}`, "_blank")}
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1" /> Abrir no board
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

// -------------------- Página --------------------
export default function AcolhimentoPage() {
  const { boards, loading: boardsLoading } = useKanbanBoards();
  const funnelBoards = useMemo(
    () => boards.filter((b) => b.board_type === "funnel"),
    [boards]
  );

  const [boardId, setBoardId] = useState<string | null>(null);

  useEffect(() => {
    if (boardId) return;
    if (funnelBoards.length === 0) return;
    const preferred =
      funnelBoards.find((b) => b.id === DEFAULT_BOARD_ID) ||
      funnelBoards.find((b) => b.is_default) ||
      funnelBoards[0];
    setBoardId(preferred.id);
  }, [funnelBoards, boardId]);

  const currentBoard = useMemo(
    () => funnelBoards.find((b) => b.id === boardId) || null,
    [funnelBoards, boardId]
  );
  const stages: KanbanStage[] = useMemo(
    () => currentBoard?.stages || [],
    [currentBoard]
  );
  const stageById = useMemo(() => {
    const m = new Map<string, KanbanStage>();
    for (const s of stages) m.set(s.id, s);
    return m;
  }, [stages]);

  const leadsQ = useBoardLeads(boardId);
  const leadRows = leadsQ.data || [];

  // Reset seleção ao trocar de funil
  const [sel, setSel] = useState<{ acolhedor: string; status: string } | null>(null);
  const [selLeadId, setSelLeadId] = useState<string | null>(null);
  useEffect(() => {
    setSel(null);
    setSelLeadId(null);
  }, [boardId]);

  // Cálculos derivados
  const stageSet = useMemo(() => new Set(stages.map((s) => s.id)), [stages]);

  const activeLeads = useMemo(
    () => leadRows.filter((l) => l.status && stageSet.has(l.status)),
    [leadRows, stageSet]
  );

  const funilRows: FunilRow[] = useMemo(() => {
    const total = activeLeads.length;
    const daysByStage = new Map<string, number[]>();
    const countByStage = new Map<string, number>();
    for (const l of activeLeads) {
      countByStage.set(l.status!, (countByStage.get(l.status!) || 0) + 1);
      const d = daysBetween(l.updated_at || l.created_at);
      const arr = daysByStage.get(l.status!) || [];
      arr.push(d);
      daysByStage.set(l.status!, arr);
    }
    const median = (arr: number[]) => {
      if (!arr.length) return 0;
      const s = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
    };
    return stages.map((st) => {
      const leads = countByStage.get(st.id) || 0;
      return {
        id: st.id,
        name: st.name,
        color: st.color,
        leads,
        pct: total ? (leads / total) * 100 : 0,
        mediana: median(daysByStage.get(st.id) || []),
      };
    });
  }, [activeLeads, stages]);

  const agingRows: AgingRow[] = useMemo(() => {
    return stages.map((st) => {
      const buckets = { d_0_3: 0, d_4_7: 0, d_8_30: 0, d_31_90: 0, d_90mais: 0 };
      for (const l of activeLeads) {
        if (l.status !== st.id) continue;
        const d = daysBetween(l.updated_at || l.created_at);
        if (d <= 3) buckets.d_0_3++;
        else if (d <= 7) buckets.d_4_7++;
        else if (d <= 30) buckets.d_8_30++;
        else if (d <= 90) buckets.d_31_90++;
        else buckets.d_90mais++;
      }
      return { id: st.id, name: st.name, buckets };
    });
  }, [activeLeads, stages]);

  const matriz = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    for (const l of activeLeads) {
      const name = (l.acolhedor || "").trim() || "(sem dono)";
      if (!map.has(name)) map.set(name, {});
      const bucket = map.get(name)!;
      bucket[l.status!] = (bucket[l.status!] || 0) + 1;
    }
    return map;
  }, [activeLeads]);

  const kpis = useMemo(() => {
    const noFunil = activeLeads.length;
    const total = leadRows.length;
    const convertidos = leadRows.filter((l) => !!l.case_number).length;
    const pctConv = total ? (convertidos / total) * 100 : 0;
    const parados90 = activeLeads.filter(
      (l) => daysBetween(l.updated_at || l.created_at) > 90
    ).length;
    const semDono = leadRows.filter((l) => !l.acolhedor || !l.acolhedor.trim()).length;
    return { noFunil, pctConv, parados90, semDono };
  }, [activeLeads, leadRows]);

  // Drill-down list (célula selecionada)
  const drillLeads = useMemo(() => {
    if (!sel) return [] as Array<LeadRow & { dias_parado: number }>;
    return activeLeads
      .filter((l) => {
        const name = (l.acolhedor || "").trim() || "(sem dono)";
        return name === sel.acolhedor && l.status === sel.status;
      })
      .map((l) => ({ ...l, dias_parado: daysBetween(l.updated_at || l.created_at) }))
      .sort((a, b) => b.dias_parado - a.dias_parado);
  }, [activeLeads, sel]);

  const selLeadLite = useMemo(
    () => drillLeads.find((l) => l.id === selLeadId) || null,
    [drillLeads, selLeadId]
  );
  const selLeadDetailQ = useLeadDetail(selLeadId);
  const selLead = useMemo(() => {
    if (!selLeadLite) return null;
    const detail = selLeadDetailQ.data;
    if (detail) return { ...selLeadLite, ...detail, dias_parado: selLeadLite.dias_parado };
    return selLeadLite;
  }, [selLeadLite, selLeadDetailQ.data]);

  const anyLoading = boardsLoading || leadsQ.isLoading;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Gerenciamento Acolhimento</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>Funil:</span>
            <Select
              value={boardId ?? ""}
              onValueChange={(v) => setBoardId(v)}
              disabled={funnelBoards.length === 0}
            >
              <SelectTrigger className="h-8 min-w-[220px] w-auto">
                <SelectValue placeholder="Selecione um funil" />
              </SelectTrigger>
              <SelectContent>
                {funnelBoards.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Badge className="bg-[#1D9E75] hover:bg-[#178761] text-white">
          <span className="inline-block h-2 w-2 rounded-full bg-white mr-1.5 animate-pulse" />
          ao vivo
        </Badge>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="No funil"
          value={kpis.noFunil.toLocaleString("pt-BR")}
          hint={`Leads ativos nas ${stages.length} etapas`}
        />
        <KpiCard
          label="Conversão real"
          value={`${kpis.pctConv.toFixed(1)}%`}
          hint="Leads com processo vinculado"
          tone="brand"
        />
        <KpiCard
          label="Parados +90d"
          value={kpis.parados90.toLocaleString("pt-BR")}
          hint="Sem movimentação há 3+ meses"
          tone="danger"
        />
        <KpiCard
          label="Sem dono"
          value={kpis.semDono.toLocaleString("pt-BR")}
          hint="Leads sem acolhedor atribuído"
          tone="warn"
        />
      </div>

      {anyLoading && <div className="text-xs text-muted-foreground">Carregando dados…</div>}

      {/* Funil + Aging */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Funil rows={funilRows} />
        <AgingHeat rows={agingRows} />
      </div>

      {/* Matriz */}
      <Matriz
        stages={stages}
        matriz={matriz}
        selected={sel}
        onSelect={(a, s) => {
          setSel({ acolhedor: a, status: s });
          setSelLeadId(null);
        }}
      />

      {/* Drill-down */}
      {sel && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-medium">
                    {sel.acolhedor}{" "}
                    <span className="text-muted-foreground">
                      · {stageById.get(sel.status)?.name || sel.status}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {drillLeads.length} leads · ordenado por dias parado
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setSel(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-1 max-h-[520px] overflow-y-auto pr-1">
                {drillLeads.map((l) => {
                  const parado = l.dias_parado;
                  const isActive = selLeadId === l.id;
                  const stage = stageById.get(l.status || "");
                  return (
                    <button
                      key={l.id}
                      onClick={() => setSelLeadId(l.id)}
                      className={cn(
                        "w-full flex items-center gap-3 px-2 py-2 rounded text-left hover:bg-muted transition-colors",
                        isActive ? "bg-muted" : ""
                      )}
                    >
                      <div
                        className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-medium text-white shrink-0"
                        style={{ background: stage?.color || "#666" }}
                      >
                        {initials(l.victim_name || l.lead_name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">
                          {l.victim_name || l.lead_name || "Sem nome"}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {l.city || l.visit_city || "—"}
                        </div>
                      </div>
                      {l.news_link && (
                        <Newspaper className="h-3.5 w-3.5 text-[#1D9E75] shrink-0" />
                      )}
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs shrink-0",
                          parado >= 60 ? "border-red-500 text-red-600" : ""
                        )}
                      >
                        {parado}d
                      </Badge>
                    </button>
                  );
                })}
                {drillLeads.length === 0 && (
                  <div className="text-xs text-muted-foreground py-4 text-center">
                    Nenhum lead nesta interseção.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {selLead ? (
            <LeadFicha
              lead={selLead}
              stage={stageById.get(selLead.status || "") || null}
              onClose={() => setSelLeadId(null)}
            />
          ) : (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                Selecione um lead da lista ao lado para abrir a ficha.
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
