import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Phone, MessageCircle, ExternalLink, Newspaper, X } from "lucide-react";

const BOARD_ID = "2dcd54b5-502b-413b-b795-5e24a20797d2";
const BRAND = "#1D9E75";

// -------------------- Decoder de etapas --------------------
type StageId =
  | "recepcao"
  | "aguardando_documentos"
  | "analise_viabilidade"
  | "procuracao_enviada"
  | "documentos_protocolo"
  | "procuracao_assinada"
  | "closed";

const STAGES: Record<StageId, { label: string; ordem: number; cor: string }> = {
  recepcao: { label: "Cadastrados viáveis", ordem: 1, cor: "#378ADD" },
  aguardando_documentos: { label: "Primeiro contato", ordem: 2, cor: "#7F77DD" },
  analise_viabilidade: { label: "Visita acolhedor", ordem: 3, cor: "#EF9F27" },
  procuracao_enviada: { label: "Visita parceiro", ordem: 4, cor: "#1D9E75" },
  documentos_protocolo: { label: "pós 1º contato online", ordem: 5, cor: "#639922" },
  procuracao_assinada: { label: "Pós visita", ordem: 6, cor: "#3B6D11" },
  closed: { label: "Fechado", ordem: 7, cor: "#0F6E56" },
};
const STAGE_ORDER: StageId[] = (Object.keys(STAGES) as StageId[]).sort(
  (a, b) => STAGES[a].ordem - STAGES[b].ordem
);

// Time trabalhista esperado
const TEAM = [
  "Analyne Sousa de Oliveira",
  "Luiz Ricardo",
  "Bruno Wenner Dantas Nunes",
  "Mateus Santos Saraiva",
  "Juliana Clara Santos Pimentel",
  "João Manoel Cavalcante Santana",
  "(sem dono)",
];

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

// -------------------- Hooks de dados --------------------
function useFunil() {
  return useQuery({
    queryKey: ["acolhimento", "funil"],
    queryFn: async () => {
      const { data, error } = await db.from("vw_funil_acolhimento" as any).select("*");
      if (error) throw error;
      return (data ?? []) as unknown as Array<{ ordem: number; nome: string; leads: number; pct: number }>;
    },
    refetchInterval: 60_000,
  });
}
function useAging() {
  return useQuery({
    queryKey: ["acolhimento", "aging"],
    queryFn: async () => {
      const { data, error } = await db.from("vw_aging_etapa" as any).select("*");
      if (error) throw error;
      return (data ?? []) as unknown as Array<{
        ordem: number;
        nome: string;
        leads: number;
        media_dias: number;
        mediana: number;
        p90: number;
        d_0_3: number;
        d_4_7: number;
        d_8_30: number;
        d_31_90: number;
        d_90mais: number;
      }>;
    },
    refetchInterval: 60_000,
  });
}
function useConversao() {
  return useQuery({
    queryKey: ["acolhimento", "conversao"],
    queryFn: async () => {
      const { data, error } = await db
        .from("vw_conversao_real" as any)
        .select("convertido")
        .eq("board_id", BOARD_ID);
      if (error) throw error;
      return (data ?? []) as unknown as Array<{ convertido: boolean }>;
    },
    refetchInterval: 60_000,
  });
}
function useMatriz() {
  return useQuery({
    queryKey: ["acolhimento", "matriz"],
    queryFn: async () => {
      const { data, error } = await db
        .from("leads")
        .select("acolhedor,status")
        .eq("board_id", BOARD_ID)
        .is("deleted_at", null)
        .in("status", STAGE_ORDER as any);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Array<{ acolhedor: string | null; status: string }>;
      const map = new Map<string, Record<string, number>>();
      for (const r of rows) {
        const name = (r.acolhedor || "").trim() || "(sem dono)";
        if (!map.has(name)) map.set(name, {});
        const bucket = map.get(name)!;
        bucket[r.status] = (bucket[r.status] || 0) + 1;
      }
      return map;
    },
    refetchInterval: 60_000,
  });
}
function useSemDono() {
  return useQuery({
    queryKey: ["acolhimento", "sem-dono"],
    queryFn: async () => {
      const { count, error } = await db
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("board_id", BOARD_ID)
        .is("deleted_at", null)
        .or("acolhedor.is.null,acolhedor.eq.");
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 60_000,
  });
}
function useLeadsCel(acolhedor: string | null, status: StageId | null) {
  return useQuery({
    enabled: !!acolhedor && !!status,
    queryKey: ["acolhimento", "leads-cel", acolhedor, status],
    queryFn: async () => {
      let q = db
        .from("vw_leads_acolhimento" as any)
        .select("*")
        .eq("status", status!)
        .order("dias_parado", { ascending: false });
      if (acolhedor === "(sem dono)") {
        // view já normaliza
        q = q.eq("acolhedor", "(sem dono)");
      } else {
        q = q.eq("acolhedor", acolhedor!);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
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

function Funil({
  funil,
  aging,
}: {
  funil: Array<{ ordem: number; nome: string; leads: number; pct: number }>;
  aging: Array<any>;
}) {
  const max = Math.max(...funil.map((f) => f.leads), 1);
  const agingByOrder = new Map(aging.map((a) => [a.ordem, a]));
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="text-sm font-medium mb-2">Funil</div>
        {STAGE_ORDER.map((id) => {
          const s = STAGES[id];
          const row = funil.find((f) => f.ordem === s.ordem);
          const leads = row?.leads ?? 0;
          const pct = row?.pct ?? 0;
          const mediana = agingByOrder.get(s.ordem)?.mediana ?? 0;
          const width = (leads / max) * 100;
          return (
            <div key={id} className="flex items-center gap-3">
              <div className="w-40 text-xs text-muted-foreground truncate">{s.label}</div>
              <div className="flex-1 h-7 rounded bg-muted/40 overflow-hidden relative">
                <div
                  className="h-full flex items-center px-2 text-xs font-medium text-white"
                  style={{ width: `${Math.max(width, 3)}%`, background: s.cor }}
                >
                  {leads.toLocaleString("pt-BR")} · {pct?.toFixed?.(1) ?? pct}%
                </div>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "min-w-[70px] justify-center text-xs",
                  mediana >= 60 ? "border-red-500 text-red-600" : ""
                )}
              >
                med. {mediana}d
              </Badge>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function AgingHeat({ aging }: { aging: Array<any> }) {
  const cols = [
    { key: "d_0_3", label: "0-3d" },
    { key: "d_4_7", label: "4-7d" },
    { key: "d_8_30", label: "8-30d" },
    { key: "d_31_90", label: "31-90d" },
    { key: "d_90mais", label: "+90d" },
  ];
  const maxByCol: Record<string, number> = {};
  for (const c of cols) maxByCol[c.key] = Math.max(...aging.map((r) => r[c.key] ?? 0), 1);

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
              {STAGE_ORDER.map((id) => {
                const s = STAGES[id];
                const row = aging.find((a) => a.ordem === s.ordem);
                return (
                  <tr key={id}>
                    <td className="pr-2 py-1 whitespace-nowrap">{s.label}</td>
                    {cols.map((c) => {
                      const v = row?.[c.key] ?? 0;
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
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Matriz({
  matriz,
  selected,
  onSelect,
}: {
  matriz: Map<string, Record<string, number>>;
  selected: { acolhedor: string; status: StageId } | null;
  onSelect: (a: string, s: StageId) => void;
}) {
  // Build list of acolhedores: TEAM (na ordem) + "Outros (fora do time)" agregando os demais
  const known = new Set(TEAM);
  const outrosBucket: Record<string, number> = {};
  let hasOutros = false;
  for (const [name, buckets] of matriz.entries()) {
    if (!known.has(name)) {
      hasOutros = true;
      for (const [st, n] of Object.entries(buckets)) {
        outrosBucket[st] = (outrosBucket[st] || 0) + n;
      }
    }
  }

  const rows: Array<{ name: string; buckets: Record<string, number>; total: number }> = [];
  for (const name of TEAM) {
    const b = matriz.get(name) || {};
    const total = STAGE_ORDER.reduce((s, id) => s + (b[id] || 0), 0);
    rows.push({ name, buckets: b, total });
  }
  if (hasOutros) {
    const total = STAGE_ORDER.reduce((s, id) => s + (outrosBucket[id] || 0), 0);
    rows.push({ name: "Outros (fora do time)", buckets: outrosBucket, total });
  }
  rows.sort((a, b) => b.total - a.total);

  // max por coluna
  const maxByCol: Record<string, number> = {};
  for (const id of STAGE_ORDER) {
    maxByCol[id] = Math.max(...rows.map((r) => r.buckets[id] || 0), 1);
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
                {STAGE_ORDER.map((id) => (
                  <th
                    key={id}
                    className="text-center font-normal text-muted-foreground px-1"
                    title={STAGES[id].label}
                  >
                    <div className="flex flex-col items-center gap-1">
                      <span
                        className="inline-block h-2 w-8 rounded-full"
                        style={{ background: STAGES[id].cor }}
                      />
                      <span className="max-w-[80px] leading-tight">{STAGES[id].label}</span>
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
                        r.name === "(sem dono)" ? "text-amber-600 font-medium" : "",
                        r.name === "Outros (fora do time)" ? "text-muted-foreground italic" : ""
                      )}
                    >
                      {r.name}
                    </span>
                  </td>
                  {STAGE_ORDER.map((id) => {
                    const v = r.buckets[id] || 0;
                    const i = v / maxByCol[id];
                    const isSel =
                      selected?.acolhedor === r.name && selected?.status === id && v > 0;
                    return (
                      <td key={id} className="p-0">
                        <button
                          disabled={v === 0}
                          onClick={() => onSelect(r.name, id)}
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
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function LeadFicha({ lead, onClose }: { lead: any; onClose: () => void }) {
  const phone = onlyDigits(lead.lead_phone);
  const stage = STAGES[lead.status as StageId];
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
                <Badge style={{ background: stage.cor, color: "white" }}>{stage.label}</Badge>
              )}
              <Badge
                variant="outline"
                className={parado >= 60 ? "border-red-500 text-red-600" : ""}
              >
                parado há {parado}d
              </Badge>
              <span
                className={
                  lead.acolhedor === "(sem dono)"
                    ? "text-amber-600 font-medium"
                    : "text-muted-foreground"
                }
              >
                {lead.acolhedor}
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
            onClick={() => window.open(`/leads?leadId=${lead.lead_id}`, "_blank")}
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
  const funilQ = useFunil();
  const agingQ = useAging();
  const convQ = useConversao();
  const matrizQ = useMatriz();
  const semDonoQ = useSemDono();

  const [sel, setSel] = useState<{ acolhedor: string; status: StageId } | null>(null);
  const [selLead, setSelLead] = useState<any | null>(null);
  const leadsCelQ = useLeadsCel(sel?.acolhedor ?? null, sel?.status ?? null);

  const kpis = useMemo(() => {
    const noFunil = (funilQ.data || []).reduce((s, r) => s + (r.leads || 0), 0);
    const conv = convQ.data || [];
    const convertidos = conv.filter((c) => c.convertido).length;
    const total = conv.length;
    const pctConv = total ? (convertidos / total) * 100 : 0;
    const parados90 = (agingQ.data || []).reduce((s, r) => s + (r.d_90mais || 0), 0);
    return { noFunil, pctConv, parados90, semDono: semDonoQ.data ?? 0 };
  }, [funilQ.data, convQ.data, agingQ.data, semDonoQ.data]);

  const anyLoading =
    funilQ.isLoading || agingQ.isLoading || convQ.isLoading || matrizQ.isLoading;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Gerenciamento Acolhimento</h1>
          <div className="text-sm text-muted-foreground">
            Funil: <span className="font-medium">Acidente de Trabalho</span>
          </div>
        </div>
        <Badge className="bg-[#1D9E75] hover:bg-[#178761] text-white">
          <span className="inline-block h-2 w-2 rounded-full bg-white mr-1.5 animate-pulse" />
          ao vivo
        </Badge>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="No funil" value={kpis.noFunil.toLocaleString("pt-BR")} hint="Leads ativos nas 7 etapas" />
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

      {anyLoading && (
        <div className="text-xs text-muted-foreground">Carregando dados…</div>
      )}

      {/* Funil + Aging */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Funil funil={funilQ.data || []} aging={agingQ.data || []} />
        <AgingHeat aging={agingQ.data || []} />
      </div>

      {/* Matriz */}
      <Matriz
        matriz={matrizQ.data || new Map()}
        selected={sel}
        onSelect={(a, s) => {
          setSel({ acolhedor: a, status: s });
          setSelLead(null);
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
                      · {STAGES[sel.status].label}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {leadsCelQ.data?.length ?? 0} leads · ordenado por dias parado
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setSel(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-1 max-h-[520px] overflow-y-auto pr-1">
                {leadsCelQ.isLoading && (
                  <div className="text-xs text-muted-foreground">Carregando…</div>
                )}
                {(leadsCelQ.data || []).map((l) => {
                  const parado = l.dias_parado ?? 0;
                  const isActive = selLead?.lead_id === l.lead_id;
                  return (
                    <button
                      key={l.lead_id}
                      onClick={() => setSelLead(l)}
                      className={cn(
                        "w-full flex items-center gap-3 px-2 py-2 rounded text-left hover:bg-muted transition-colors",
                        isActive ? "bg-muted" : ""
                      )}
                    >
                      <div
                        className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-medium text-white shrink-0"
                        style={{ background: STAGES[l.status as StageId]?.cor || "#666" }}
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
                {leadsCelQ.data && leadsCelQ.data.length === 0 && (
                  <div className="text-xs text-muted-foreground py-4 text-center">
                    Nenhum lead nesta interseção.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {selLead ? (
            <LeadFicha lead={selLead} onClose={() => setSelLead(null)} />
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
