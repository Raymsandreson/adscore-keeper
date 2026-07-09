import { useEffect, useMemo, useState } from "react";
import { List, MessageCircle, Search, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { db } from "@/integrations/supabase";
import type { KanbanBoard } from "@/hooks/useKanbanBoards";
import { useBpcFormLeads } from "@/hooks/useBpcFormLeads";
import { getFunnelSheetConfig } from "@/lib/funnelSheetConfig";

type DateKey = "hoje" | "ontem" | "semana" | "mes" | "tudo";

const DATE_OPTIONS: { value: DateKey; label: string }[] = [
  { value: "hoje", label: "Hoje" },
  { value: "ontem", label: "Ontem" },
  { value: "semana", label: "Esta semana" },
  { value: "mes", label: "Este mês" },
  { value: "tudo", label: "Tudo" },
];

interface UnifiedLead {
  id: string;
  name: string | null;
  phone: string | null;
  acolhedor: string | null;
  created_at: string;
  status?: string | null;
}

export interface FunnelStageFilter {
  id: string;
  name: string;
  color?: string;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function computeRange(key: DateKey): { from: Date | null; to: Date | null } {
  const now = new Date();
  const today = startOfDay(now);
  if (key === "hoje") {
    return { from: today, to: now };
  }
  if (key === "ontem") {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    const end = new Date(today.getTime() - 1);
    return { from: y, to: end };
  }
  if (key === "semana") {
    // Semana atual começando na segunda-feira
    const from = new Date(today);
    const day = from.getDay(); // 0=Dom
    const diff = (day + 6) % 7; // segunda=0
    from.setDate(from.getDate() - diff);
    return { from, to: now };
  }
  if (key === "mes") {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from, to: now };
  }
  return { from: null, to: null };
}

function fmtPhone(p?: string | null) {
  if (!p) return "—";
  const d = p.replace(/\D/g, "");
  if (d.length >= 17) return "Grupo WhatsApp";
  if (d.length === 13 && d.startsWith("55"))
    return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return p;
}

function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

interface Props {
  board: KanbanBoard | null;
  triggerLabel?: string;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  stageFilter?: FunnelStageFilter | null;
  hideTrigger?: boolean;
}

export function FunnelLeadsSidePanel({
  board,
  triggerLabel = "Ver leads",
  open: openProp,
  onOpenChange,
  stageFilter,
  hideTrigger,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp !== undefined ? openProp : internalOpen;
  const setOpen = (v: boolean) => {
    if (onOpenChange) onOpenChange(v);
    else setInternalOpen(v);
  };
  const [dateKey, setDateKey] = useState<DateKey>("tudo");
  const [acolhedor, setAcolhedor] = useState<string>("todos");
  const [search, setSearch] = useState("");

  const sheetCfg = useMemo(() => getFunnelSheetConfig(board?.name), [board?.name]);

  // Leads da planilha (para funis BPC / Aux Acidente)
  const sheetRange = useMemo(
    () => ({ from: new Date("2020-01-01T00:00:00Z"), to: new Date() }),
    [],
  );
  const { leads: sheetLeads, loading: sheetLoading } = useBpcFormLeads({
    from: sheetRange.from,
    to: sheetRange.to,
    enabled: open && !!sheetCfg,
    source: "unificada",
    spreadsheetId: sheetCfg?.spreadsheetId,
  });

  // Leads do banco (fallback para funis sem planilha)
  const [dbLeads, setDbLeads] = useState<UnifiedLead[]>([]);
  const [dbLoading, setDbLoading] = useState(false);

  useEffect(() => {
    if (!open || sheetCfg || !board?.id) return;
    let cancelled = false;
    (async () => {
      setDbLoading(true);
      try {
        const collected: UnifiedLead[] = [];
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await db
            .from("leads")
            .select("id, lead_name, lead_phone, acolhedor, created_at")
            .eq("board_id", board.id)
            .order("created_at", { ascending: true })
            .range(from, from + PAGE - 1);
          if (error) throw error;
          const rows = (data || []) as Array<{
            id: string;
            lead_name: string | null;
            lead_phone: string | null;
            acolhedor: string | null;
            created_at: string;
          }>;
          for (const r of rows) {
            collected.push({
              id: r.id,
              name: r.lead_name,
              phone: r.lead_phone,
              acolhedor: r.acolhedor,
              created_at: r.created_at,
            });
          }
          if (rows.length < PAGE) break;
        }
        if (!cancelled) setDbLeads(collected);
      } catch (e) {
        console.error("[FunnelLeadsSidePanel] db leads", e);
        if (!cancelled) setDbLeads([]);
      } finally {
        if (!cancelled) setDbLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sheetCfg, board?.id]);

  const allLeads: UnifiedLead[] = useMemo(() => {
    if (sheetCfg) {
      return sheetLeads.map((l) => ({
        id: l.form_lead_id || `${l.phone_normalized}-${l.created_at}`,
        name: l.name || null,
        phone: l.phone_normalized || l.phone_raw || null,
        acolhedor: l.operator || null,
        created_at: l.created_at,
      }));
    }
    return dbLeads;
  }, [sheetCfg, sheetLeads, dbLeads]);

  const acolhedores = useMemo(() => {
    const set = new Set<string>();
    for (const l of allLeads) {
      const a = (l.acolhedor || "").trim();
      if (a) set.add(a);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [allLeads]);

  const filtered = useMemo(() => {
    const range = computeRange(dateKey);
    const term = search.trim().toLowerCase();
    const list = allLeads.filter((l) => {
      if (range.from || range.to) {
        const t = new Date(l.created_at).getTime();
        if (Number.isNaN(t)) return false;
        if (range.from && t < range.from.getTime()) return false;
        if (range.to && t > range.to.getTime()) return false;
      }
      if (acolhedor !== "todos") {
        if ((l.acolhedor || "").trim() !== acolhedor) return false;
      }
      if (term) {
        const hay = `${l.name || ""} ${l.phone || ""} ${l.acolhedor || ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
    // Ordem de chegada: primeiro → último (ascendente por created_at)
    list.sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    return list;
  }, [allLeads, dateKey, acolhedor, search]);

  const loading = sheetCfg ? sheetLoading : dbLoading;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline">
          <List className="h-3.5 w-3.5 mr-2" />
          {triggerLabel}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md p-0 flex flex-col"
      >
        <SheetHeader className="px-4 py-3 border-b space-y-1">
          <SheetTitle className="text-base">Leads — {board?.name || "Funil"}</SheetTitle>
          <SheetDescription className="text-xs">
            Ordem de chegada (do primeiro ao último).
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 py-3 border-b space-y-2 bg-muted/30">
          <div className="grid grid-cols-2 gap-2">
            <Select value={dateKey} onValueChange={(v) => setDateKey(v as DateKey)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Período" />
              </SelectTrigger>
              <SelectContent>
                {DATE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={acolhedor} onValueChange={setAcolhedor}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Acolhedor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos" className="text-xs">
                  Todos os acolhedores
                </SelectItem>
                {acolhedores.map((a) => (
                  <SelectItem key={a} value={a} className="text-xs">
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, telefone ou acolhedor..."
              className="h-8 text-xs pl-7 pr-7"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Limpar busca"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {loading
                ? "Carregando..."
                : `${filtered.length} lead${filtered.length === 1 ? "" : "s"}`}
            </span>
            {acolhedor !== "todos" && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                {acolhedor}
              </Badge>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && filtered.length === 0 ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-14 rounded-md bg-muted/40 animate-pulse"
                />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Nenhum lead encontrado com os filtros aplicados.
            </div>
          ) : (
            <ol className="divide-y">
              {filtered.map((l, idx) => {
                const digits = (l.phone || "").replace(/\D/g, "");
                return (
                  <li
                    key={l.id}
                    className="px-4 py-2.5 flex items-start gap-3 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex flex-col items-center pt-0.5 shrink-0">
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        #{idx + 1}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">
                        {l.name || "Sem nome"}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {fmtPhone(l.phone)}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 flex flex-wrap gap-x-2">
                        {l.acolhedor && <span>👤 {l.acolhedor}</span>}
                        <span>🕒 {fmtDateTime(l.created_at)}</span>
                      </div>
                    </div>
                    {digits && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() =>
                          window.open(`https://wa.me/${digits}`, "_blank")
                        }
                        title="Abrir no WhatsApp"
                      >
                        <MessageCircle className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
