import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Clock, ArrowRightLeft, Loader2, AlertTriangle, Users } from "lucide-react";

import { db as supabase } from "@/integrations/supabase";
import { KanbanBoard } from "@/hooks/useKanbanBoards";
import type { BpcFormLead } from "@/hooks/useBpcFormLeads";
import { leadMatchesFilter, phoneKey, type BpcFilterResult } from "@/lib/bpcPhoneMatch";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface Props {
  board: KanbanBoard;
  /** Período já calculado pelos filtros da página (data de cadastro). */
  fromDate: Date | null;
  toDate: Date | null;
  /** Campo de data usado nos filtros da página. */
  dateField: "created_at" | "updated_at";
  /** Filtro de acolhedor (Set de últimos 8 dígitos). null = sem filtro. */
  bpcFilter: BpcFilterResult;
  /** True quando filtro acolhedor está ativo mas a planilha ainda carrega. */
  filterPending: boolean;
  /** Leads vindos da planilha BASE_UNIFICADA — fonte de verdade pra "chegadas". */
  bpcLeads: BpcFormLead[];
}

const STALE_DAYS_HIGHLIGHT = 7; // destaque visual: parado >7 dias na etapa

// ---------- helpers de período (America/Sao_Paulo, UTC-3 sem DST) ----------
const BR_OFFSET_MS = 3 * 3600 * 1000;

function brNowParts() {
  const now = new Date();
  const br = new Date(now.getTime() - BR_OFFSET_MS);
  return { y: br.getUTCFullYear(), m: br.getUTCMonth(), d: br.getUTCDate(), dow: br.getUTCDay() };
}

function brDayBoundsUTC(y: number, m: number, d: number, daysSpan = 1) {
  // 00:00 BR = 03:00 UTC do mesmo dia
  const start = new Date(Date.UTC(y, m, d, 3));
  const end = new Date(Date.UTC(y, m, d + daysSpan, 3));
  return { start, end };
}

function periodToday() {
  const { y, m, d } = brNowParts();
  return brDayBoundsUTC(y, m, d, 1);
}
function periodThisWeek() {
  // Semana começa segunda-feira (ISO)
  const { y, m, d, dow } = brNowParts();
  const offsetToMon = dow === 0 ? 6 : dow - 1;
  return brDayBoundsUTC(y, m, d - offsetToMon, 7);
}
function periodThisMonth() {
  const { y, m } = brNowParts();
  const start = new Date(Date.UTC(y, m, 1, 3));
  const end = new Date(Date.UTC(y, m + 1, 1, 3));
  return { start, end };
}

function daysBetween(a: Date, b: Date) {
  return Math.floor((a.getTime() - b.getTime()) / 86400000);
}

// ---------- componente ----------
export function BpcKpisPanel({ board, fromDate, toDate, dateField, bpcFilter, filterPending, bpcLeads }: Props) {
  const boardId = board.id;
  const stages = board.stages || [];
  const stageByName = useMemo(() => {
    const m = new Map<string, { id: string; name: string; color: string }>();
    for (const s of stages) m.set(s.name.toLowerCase(), s as any);
    return m;
  }, [stages]);
  const stageById = useMemo(() => {
    const m = new Map<string, { id: string; name: string; color: string }>();
    for (const s of stages) m.set(s.id, s as any);
    return m;
  }, [stages]);

  const procAssinadaId = stageByName.get("procuração assinada")?.id;
  const docsProtocoloId = stageByName.get("documentos p/ protocolo")?.id;

  const filterActive = !!bpcFilter?.phoneKeys;
  const phoneKeysSig = filterActive ? Array.from(bpcFilter.phoneKeys!).sort().join(",") : "all";

  // Mapa telefone(últimos 8) → operator da planilha (BASE_UNIFICADA).
  // Usado pra rotular acolhedor em B1 cruzando pelo telefone.
  const phoneToOperator = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of bpcLeads || []) {
      const k = phoneKey(l.phone_normalized || l.phone_raw);
      if (!k) continue;
      const op = (l.operator || "").trim();
      if (op && !m.has(k)) m.set(k, op);
    }
    return m;
  }, [bpcLeads]);

  // ---- A1 + A2: derivados 100% da planilha BASE_UNIFICADA (fonte de verdade) ----
  // Período rápido (clique nos cards Hoje/Semana/Mês). Quando ativo, sobrescreve o filtro da página.
  type QuickPeriod = "today" | "week" | "month" | null;
  const [quickPeriod, setQuickPeriod] = useState<QuickPeriod>(null);

  // Sem filtro rápido = mostra TODOS os leads carregados (mesmo universo do A1),
  // pra não esconder acolhedor cujas chegadas estão fora do recorte estreito da página.
  const a2Bounds = useMemo(() => {
    if (quickPeriod === "today") return periodToday();
    if (quickPeriod === "week") return periodThisWeek();
    if (quickPeriod === "month") return periodThisMonth();
    return { start: null as Date | null, end: null as Date | null };
  }, [quickPeriod]);


  // A1: Hoje / Semana / Mês (recorta a planilha por created_at, ignorando o período da página)
  const a1 = useMemo(() => {
    const today = periodToday();
    const week = periodThisWeek();
    const month = periodThisMonth();
    let hoje = 0, semana = 0, mes = 0;
    for (const l of bpcLeads || []) {
      const t = new Date(l.created_at).getTime();
      if (isNaN(t)) continue;
      if (t >= month.start.getTime() && t < month.end.getTime()) mes++;
      if (t >= week.start.getTime() && t < week.end.getTime()) semana++;
      if (t >= today.start.getTime() && t < today.end.getTime()) hoje++;
    }
    return { hoje, semana, mes };
  }, [bpcLeads]);

  // A2: chegadas por acolhedor — canônicos fixos (Mateus, Israel, Karolyne, Edilan).
  // Normaliza variações ("karol"→Karolyne, "edilan santos"→Edilan, etc.).
  // Quem não casar com nenhum desses 4 vai pra "Outros" (Cris, Andressa, Keilane, API…).
  // Quem vier sem operator vira "Sem operador".
  const CANONICAL_OPERATORS = ["Mateus", "Israel", "Karolyne", "Edilan"] as const;
  const a2 = useMemo(() => {
    const startMs = a2Bounds.start?.getTime() ?? -Infinity;
    const endMs = a2Bounds.end?.getTime() ?? Infinity;
    const counts: Record<string, number> = { Mateus: 0, Israel: 0, Karolyne: 0, Edilan: 0 };
    let semOp = 0;
    let outros = 0;
    const outrosLabels = new Set<string>();
    const normalize = (raw: string): string | null => {
      const low = raw.toLowerCase();
      if (low.includes("mateus")) return "Mateus";
      if (low.includes("israel")) return "Israel";
      if (low.includes("karol")) return "Karolyne";
      if (low.includes("edilan")) return "Edilan";
      return null;
    };
    for (const l of bpcLeads || []) {
      const t = new Date(l.created_at).getTime();
      if (isNaN(t) || t < startMs || t > endMs) continue;
      const op = (l.operator || "").trim();
      if (!op || op === "—") { semOp++; continue; }
      const canon = normalize(op);
      if (canon) counts[canon]++;
      else { outros++; outrosLabels.add(op); }
    }
    const rows = CANONICAL_OPERATORS.map((name) => ({ name, count: counts[name] }))
      .sort((a, b) => b.count - a.count);
    const allValues = [...rows.map((r) => r.count), semOp, outros];
    const max = Math.max(...allValues, 1);
    const total = rows.reduce((s, r) => s + r.count, 0) + semOp + outros;
    return { rows, semOp, outros, outrosLabels: Array.from(outrosLabels), max, total };
  }, [bpcLeads, a2Bounds.start?.getTime(), a2Bounds.end?.getTime()]);

  const arrivalsLoading = false;

  // ---- B1: tempo na etapa (Procuração Assinada / Documentos p/ Protocolo) ----
  // Buscamos leads cuja status seja uma dessas duas, junto com lead_stage_history MAX(changed_at) para to_stage = status.
  const b1Stages = [procAssinadaId, docsProtocoloId].filter(Boolean) as string[];

  const { data: b1Data, isFetching: b1Loading } = useQuery({
    queryKey: ["bpc-kpis-b1", boardId, b1Stages.join(","), phoneKeysSig, filterPending],
    queryFn: async () => {
      if (!b1Stages.length || filterPending) return [] as any[];
      const PAGE = 1000;
      const leads: Array<{ id: string; lead_name: string | null; lead_phone: string | null; status: string }> = [];
      for (let off = 0; ; off += PAGE) {
        const { data, error } = await supabase
          .from("leads")
          .select("id, lead_name, lead_phone, status")
          .eq("board_id", boardId)
          .in("status", b1Stages)
          .range(off, off + PAGE - 1);
        if (error) throw error;
        const batch = (data || []) as any[];
        leads.push(...batch);
        if (batch.length < PAGE) break;
      }
      const filtered = filterActive
        ? leads.filter((l) => leadMatchesFilter(l.lead_phone, bpcFilter))
        : leads;
      if (!filtered.length) return [];
      // Busca histórico de transições para esses leads (to_stage = status atual)
      const ids = filtered.map((l) => l.id);
      const history: Array<{ lead_id: string; to_stage: string; changed_at: string }> = [];
      const CHUNK = 200;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from("lead_stage_history")
          .select("lead_id, to_stage, changed_at")
          .in("lead_id", slice)
          .in("to_stage", b1Stages)
          .order("changed_at", { ascending: false });
        if (error) throw error;
        history.push(...((data || []) as any[]));
      }
      // último changed_at por (lead_id, to_stage)
      const lastEntry = new Map<string, string>();
      for (const h of history) {
        const k = `${h.lead_id}::${h.to_stage}`;
        if (!lastEntry.has(k)) lastEntry.set(k, h.changed_at);
      }
      const now = new Date();
      return filtered.map((l) => {
        const entered = lastEntry.get(`${l.id}::${l.status}`);
        const days = entered ? daysBetween(now, new Date(entered)) : null;
        return {
          id: l.id,
          name: l.lead_name || "(sem nome)",
          phone: l.lead_phone,
          stage: l.status,
          days,
        };
      });
    },
    enabled: !!boardId && b1Stages.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const b1ByStage = useMemo(() => {
    const map = new Map<string, Array<{ id: string; name: string; acolhedor: string; days: number | null }>>();
    for (const sid of b1Stages) map.set(sid, []);
    for (const row of b1Data || []) {
      const arr = map.get(row.stage) || [];
      const k = phoneKey(row.phone);
      const acolhedor = (k && phoneToOperator.get(k)) || "—";
      arr.push({ id: row.id, name: row.name, acolhedor, days: row.days });
      map.set(row.stage, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (b.days ?? -1) - (a.days ?? -1));
    }
    return map;
  }, [b1Data, b1Stages.join(","), phoneToOperator]);

  // ---- B2: mudanças de etapa no período (lead_stage_history) ----
  const { data: b2Rows = [], isFetching: b2Loading } = useQuery({
    queryKey: ["bpc-kpis-b2", boardId, a2Bounds.start?.toISOString() ?? "none", a2Bounds.end?.toISOString() ?? "none", phoneKeysSig, filterPending],
    queryFn: async () => {
      if (filterPending) return [];
      // Primeiro precisa do conjunto de leads do board (para filtrar history por lead_id)
      const PAGE = 1000;
      const leadRows: Array<{ id: string; lead_phone: string | null }> = [];
      for (let off = 0; ; off += PAGE) {
        const { data, error } = await supabase
          .from("leads")
          .select("id, lead_phone")
          .eq("board_id", boardId)
          .range(off, off + PAGE - 1);
        if (error) throw error;
        const batch = (data || []) as any[];
        leadRows.push(...batch);
        if (batch.length < PAGE) break;
      }
      const filtered = filterActive
        ? leadRows.filter((l) => leadMatchesFilter(l.lead_phone, bpcFilter))
        : leadRows;
      if (!filtered.length) return [];
      const ids = filtered.map((l) => l.id);
      const transitions: Array<{ from_stage: string | null; to_stage: string; changed_at: string }> = [];
      const CHUNK = 200;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        let q = supabase
          .from("lead_stage_history")
          .select("from_stage, to_stage, changed_at")
          .in("lead_id", slice);
        if (a2Bounds.start) q = q.gte("changed_at", a2Bounds.start.toISOString());
        if (a2Bounds.end) q = q.lte("changed_at", a2Bounds.end.toISOString());
        const { data, error } = await q;
        if (error) throw error;
        transitions.push(...((data || []) as any[]));
      }
      return transitions;
    },
    enabled: !!boardId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const b2 = useMemo(() => {
    const counts = new Map<string, number>();
    let total = 0;
    for (const t of b2Rows) {
      total++;
      const key = `${t.from_stage || "—"}→${t.to_stage}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const rows = Array.from(counts.entries())
      .map(([k, n]) => {
        const [fromId, toId] = k.split("→");
        return {
          from: stageById.get(fromId)?.name || fromId,
          to: stageById.get(toId)?.name || toId,
          count: n,
        };
      })
      .sort((a, b) => b.count - a.count);
    return { total, rows };
  }, [b2Rows, stageById]);

  const loading = arrivalsLoading || filterPending;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-medium">KPIs do Funil</CardTitle>
          </div>
          <Badge variant="outline" className="text-xs">somente leitura</Badge>
        </div>
        <CardDescription className="text-xs">
          Indicadores derivados da tabela <code>leads</code> e do histórico de etapas (horário de Brasília).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ---------------- A1 ---------------- */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" /> Chegadas na Recepção
          </h3>
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: "today" as const, label: "Hoje", value: a1.hoje },
                { key: "week" as const, label: "Esta semana", value: a1.semana },
                { key: "month" as const, label: "Este mês", value: a1.mes },
              ]).map((k) => {
                const active = quickPeriod === k.key;
                return (
                  <button
                    key={k.label}
                    type="button"
                    onClick={() => setQuickPeriod(active ? null : k.key)}
                    className={cn(
                      "rounded-md border p-3 text-center transition-colors cursor-pointer",
                      active
                        ? "bg-primary/15 border-primary ring-1 ring-primary/40"
                        : "bg-muted/30 hover:bg-muted/60"
                    )}
                    title={active ? "Clique para limpar o filtro" : `Filtrar pelo período: ${k.label}`}
                  >
                    <div className={cn("text-2xl font-bold", active ? "text-primary" : "text-primary/90")}>
                      {k.value}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{k.label}</div>
                  </button>
                );
              })}
            </div>
          )}
          {quickPeriod && (
            <p className="text-[11px] text-muted-foreground italic">
              Filtro rápido ativo — as seções abaixo mostram só o período selecionado.{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => setQuickPeriod(null)}
              >
                Limpar
              </button>
            </p>
          )}
        </section>

        {/* ---------------- A2 ---------------- */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" /> Chegadas por Acolhedor
            <span className="text-[10px] font-normal text-muted-foreground/80 normal-case">
              (no período do filtro — total: {a2.total})
            </span>
          </h3>
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : a2.total === 0 ? (
            <p className="text-xs text-muted-foreground italic py-2">Nenhuma chegada no período.</p>
          ) : (
            <div className="space-y-1">
              {a2.rows.map((r) => (
                <div key={r.name} className="flex items-center gap-2">
                  <span className="text-xs w-40 truncate" title={r.name}>{r.name}</span>
                  <div className="flex-1 h-5 bg-muted/40 rounded-sm overflow-hidden">
                    <div
                      className="h-full bg-primary/80"
                      style={{ width: `${(r.count / a2.max) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold w-10 text-right tabular-nums">{r.count}</span>
                </div>
              ))}
              {a2.outros > 0 && (
                <div className="flex items-center gap-2" title={`Operadores: ${a2.outrosLabels.join(", ")}`}>
                  <span className="text-xs w-40 truncate text-muted-foreground">
                    Outros ({a2.outrosLabels.length})
                  </span>
                  <div className="flex-1 h-5 bg-muted/40 rounded-sm overflow-hidden">
                    <div className="h-full bg-muted-foreground/60" style={{ width: `${(a2.outros / a2.max) * 100}%` }} />
                  </div>
                  <span className="text-xs font-semibold w-10 text-right tabular-nums">{a2.outros}</span>
                </div>
              )}
              {a2.semOp > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs w-40 truncate text-muted-foreground italic">Sem operador</span>
                  <div className="flex-1 h-5 bg-muted/40 rounded-sm overflow-hidden">
                    <div className="h-full bg-amber-500/60" style={{ width: `${(a2.semOp / a2.max) * 100}%` }} />
                  </div>
                  <span className="text-xs font-semibold w-10 text-right tabular-nums">{a2.semOp}</span>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ---------------- B1 ---------------- */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" /> Tempo na Etapa (dias)
            <span className="text-[10px] font-normal text-muted-foreground/80 normal-case">
              destaque acima de {STALE_DAYS_HIGHLIGHT}d
            </span>
          </h3>
          {b1Loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {b1Stages.map((sid) => {
                const stage = stageById.get(sid);
                const rows = b1ByStage.get(sid) || [];
                return (
                  <div key={sid} className="rounded-md border">
                    <div className="px-3 py-2 border-b flex items-center justify-between bg-muted/20">
                      <span className="text-xs font-medium" style={{ color: stage?.color }}>
                        {stage?.name}
                      </span>
                      <Badge variant="outline" className="text-[10px]">{rows.length}</Badge>
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {rows.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground italic px-3 py-3">
                          Nenhum lead nesta etapa.
                        </p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="h-7 text-[10px]">Lead</TableHead>
                              <TableHead className="h-7 text-[10px]">Acolhedor</TableHead>
                              <TableHead className="h-7 text-[10px] text-right">Dias</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {rows.map((r) => {
                              const stale = (r.days ?? 0) > STALE_DAYS_HIGHLIGHT;
                              return (
                                <TableRow key={r.id}>
                                  <TableCell className="text-xs py-1.5 truncate max-w-[160px]" title={r.name}>{r.name}</TableCell>
                                  <TableCell className="text-xs py-1.5 truncate max-w-[120px]" title={r.acolhedor}>{r.acolhedor}</TableCell>
                                  <TableCell
                                    className={cn(
                                      "text-xs py-1.5 text-right tabular-nums font-medium",
                                      stale && "text-red-600",
                                      r.days === null && "text-muted-foreground italic"
                                    )}
                                  >
                                    {r.days === null ? "s/ registro" : `${r.days}d`}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ---------------- B2 ---------------- */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <ArrowRightLeft className="h-3.5 w-3.5" /> Mudanças de Etapa
            <span className="text-[10px] font-normal text-muted-foreground/80 normal-case">
              (no período do filtro — total: {b2.total})
            </span>
          </h3>
          {b2Loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : b2.rows.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-2 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              Nenhuma transição registrada no período.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-7 text-[10px]">De</TableHead>
                  <TableHead className="h-7 text-[10px]">Para</TableHead>
                  <TableHead className="h-7 text-[10px] text-right">Casos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {b2.rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs py-1.5">{r.from}</TableCell>
                    <TableCell className="text-xs py-1.5">{r.to}</TableCell>
                    <TableCell className="text-xs py-1.5 text-right tabular-nums font-medium">{r.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
