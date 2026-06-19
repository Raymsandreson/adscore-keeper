import { useMemo, useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarIcon, LayoutGrid, Loader2, Users, Filter, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { db as supabase } from "@/integrations/supabase";
import { useKanbanBoards } from "@/hooks/useKanbanBoards";
import { useBpcFormLeads } from "@/hooks/useBpcFormLeads";
import { useProfileNames } from "@/hooks/useProfileNames";
import { BpcFunnelBars } from "@/components/kanban/BpcFunnelBars";
import { BpcFormLeadsSheet } from "@/components/whatsapp/FocusDashboard/BpcFormLeadsSheet";
import { buildBpcAcolhedorFilter, leadMatchesFilter } from "@/lib/bpcPhoneMatch";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

type DateField = "created_at" | "updated_at";
type RangePreset = "today" | "7d" | "30d" | "all" | "custom";

function computeRange(preset: RangePreset, custom?: { from?: Date; to?: Date }) {
  const now = new Date();
  if (preset === "all") return { from: null as Date | null, to: null as Date | null };
  if (preset === "today") {
    const f = new Date(now); f.setHours(0, 0, 0, 0);
    const t = new Date(now); t.setHours(23, 59, 59, 999);
    return { from: f, to: t };
  }
  if (preset === "7d") {
    const f = new Date(now); f.setDate(f.getDate() - 6); f.setHours(0, 0, 0, 0);
    return { from: f, to: now };
  }
  if (preset === "30d") {
    const f = new Date(now); f.setDate(f.getDate() - 29); f.setHours(0, 0, 0, 0);
    return { from: f, to: now };
  }
  return { from: custom?.from ?? null, to: custom?.to ?? null };
}

const BpcFunnelDetailPage = () => {
  const { boardId } = useParams<{ boardId: string }>();
  const navigate = useNavigate();
  const { boards } = useKanbanBoards();
  const board = useMemo(() => boards.find(b => b.id === boardId), [boards, boardId]);

  const [dateField, setDateField] = useState<DateField>("created_at");
  const [rangePreset, setRangePreset] = useState<RangePreset>("30d");
  const [customRange, setCustomRange] = useState<{ from?: Date; to?: Date }>({});
  // Multi-select. Vazio = todos. "__none__" = sem acolhedor. Outros = nome (case-insensitive).
  const [selectedAcolhedores, setSelectedAcolhedores] = useState<string[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Acolhedoras que devem sempre aparecer na lista, mesmo sem dados na planilha
  const ALWAYS_SHOW = useMemo(() => ["Karolyne", "Edilan"], []);

  const { from: fromDate, to: toDate } = useMemo(
    () => computeRange(rangePreset, customRange),
    [rangePreset, customRange.from?.getTime(), customRange.to?.getTime()]
  );

  // BPC metrics da planilha (BASE_UNIFICADA) — fonte primária do acolhedor
  const bpcRange = useMemo(() => ({
    from: fromDate ?? new Date("2020-01-01T00:00:00Z"),
    to: toDate ?? new Date(),
  }), [fromDate, toDate]);

  const {
    metrics: bpcMetrics,
    leads: bpcLeads,
    loading: bpcLoading,
    refetch: refetchBpc,
  } = useBpcFormLeads({
    from: bpcRange.from,
    to: bpcRange.to,
    enabled: !!board,
    source: "unificada",
  });

  // Lista de acolhedores vinda da planilha (coluna operator) + sempre-presentes
  const allAcolhedores = useMemo(() => {
    const set = new Set<string>();
    for (const l of bpcLeads) {
      const op = (l.operator || "").trim();
      if (op) set.add(op);
    }
    for (const a of ALWAYS_SHOW) set.add(a);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [bpcLeads, ALWAYS_SHOW]);

  const noFilter = selectedAcolhedores.length === 0;

  const toggleAcolhedor = (name: string) => {
    setSelectedAcolhedores(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  };
  const clearAcolhedores = () => setSelectedAcolhedores([]);

  // Filtra leads da planilha pelos operadores (acolhedores) selecionados (multi)
  const filteredBpcLeads = useMemo(() => {
    if (noFilter) return bpcLeads;
    const targetsLower = new Set(
      selectedAcolhedores.filter(s => s !== "__none__").map(s => s.toLowerCase())
    );
    const includeNone = selectedAcolhedores.includes("__none__");
    return bpcLeads.filter(l => {
      const op = (l.operator || "").trim();
      if (!op) return includeNone;
      return targetsLower.has(op.toLowerCase());
    });
  }, [bpcLeads, selectedAcolhedores, noFilter]);

  // Métricas derivadas da planilha filtrada (sempre coerentes com a tabela detalhada)
  const filteredMetrics = useMemo(() => {
    if (noFilter) return bpcMetrics;
    let total = 0, unviable = 0, toCallNow = 0, alreadyOnWhatsApp = 0;
    for (const l of filteredBpcLeads) {
      total++;
      if (l.is_unviable) unviable++;
      else if (l.has_whatsapp === false) toCallNow++;
      else alreadyOnWhatsApp++;
    }
    return { total, unviable, toCallNow, alreadyOnWhatsApp };
  }, [noFilter, bpcMetrics, filteredBpcLeads]);

  // Per-stage counts (tabela leads) — cruza por chave canônica (últimos 8 dígitos)
  const bpcFilter = useMemo(() => {
    if (noFilter) {
      return { phoneKeys: null as Set<string> | null, matchedLeadCount: 0, validPhoneCount: 0, droppedNoPhone: 0 };
    }
    return buildBpcAcolhedorFilter({ selected: selectedAcolhedores, leads: filteredBpcLeads });
  }, [noFilter, selectedAcolhedores, filteredBpcLeads]);

  // Sinaliza estado em que o filtro tá ativo mas a planilha ainda não carregou
  const filterPending = !noFilter && (!bpcLeads || bpcLeads.length === 0);

  const leadsQueryKey = ["bpc-detail-leads", boardId, dateField, fromDate?.toISOString() ?? "none", toDate?.toISOString() ?? "none"];
  const { data: rawLeadsData, isFetching: leadsLoading, refetch: refetchLeads } = useQuery({
    queryKey: leadsQueryKey,
    queryFn: async () => {
      if (!boardId) return [] as Array<{ status: string; lead_phone: string | null }>;
      let q = supabase.from("leads").select("status, lead_phone").eq("board_id", boardId);
      if (fromDate) q = q.gte(dateField, fromDate.toISOString());
      if (toDate) q = q.lte(dateField, toDate.toISOString());
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!boardId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // Stage breakdown — refiltra client-side. Durante carregamento da planilha, mostra dados brutos
  // pra não enganar com "0" enquanto o cruzamento ainda não tá pronto.
  const leadsData = useMemo(() => {
    const byStage: Record<string, number> = {};
    const skipFilter = filterPending || !bpcFilter.phoneKeys;
    for (const l of rawLeadsData || []) {
      if (!skipFilter && !leadMatchesFilter(l.lead_phone, bpcFilter)) continue;
      const status = l.status || "—";
      byStage[status] = (byStage[status] || 0) + 1;
    }
    return { byStage };
  }, [rawLeadsData, bpcFilter, filterPending]);

  const { fetchProfileNames, getDisplayName } = useProfileNames();
  useEffect(() => {
    const uuids = allAcolhedores.filter(a => /^[0-9a-f-]{36}$/i.test(a));
    if (uuids.length) fetchProfileNames(uuids);
  }, [allAcolhedores, fetchProfileNames]);

  if (!board) {
    return (
      <div className="container mx-auto py-10 text-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
        Carregando funil...
      </div>
    );
  }

  const handleRefresh = () => { refetchLeads(); refetchBpc(); };

  return (
    <div className="container mx-auto py-6 px-4 max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => navigate("/sales-funnels")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate flex items-center gap-2">
              <LayoutGrid className="h-5 w-5 text-primary" />
              {board.name}
            </h1>
            <p className="text-xs text-muted-foreground">Painel detalhado do funil BPC</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={leadsLoading || bpcLoading}>
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", (leadsLoading || bpcLoading) && "animate-spin")} />
            Atualizar
          </Button>
          <Button size="sm" onClick={() => navigate(`/leads?board=${board.id}`)}>
            <LayoutGrid className="h-3.5 w-3.5 mr-1.5" />
            Abrir Kanban
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Filter className="h-4 w-4 text-primary" />
            Filtros
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Select value={dateField} onValueChange={(v) => setDateField(v as DateField)}>
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created_at">📥 Data de cadastro</SelectItem>
              <SelectItem value="updated_at">🔄 Última atualização</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-0.5 rounded-md border bg-background p-0.5">
            {([
              { v: "today", l: "Hoje" },
              { v: "7d", l: "7d" },
              { v: "30d", l: "30d" },
              { v: "all", l: "Tudo" },
            ] as { v: RangePreset; l: string }[]).map(opt => (
              <Button
                key={opt.v}
                size="sm"
                variant={rangePreset === opt.v ? "default" : "ghost"}
                className="h-7 px-2.5 text-xs"
                onClick={() => setRangePreset(opt.v)}
              >
                {opt.l}
              </Button>
            ))}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant={rangePreset === "custom" ? "default" : "ghost"}
                  className="h-7 px-2 text-xs gap-1"
                >
                  <CalendarIcon className="h-3 w-3" />
                  {rangePreset === "custom" && customRange.from
                    ? `${format(customRange.from, "dd/MM", { locale: ptBR })}${customRange.to ? ` - ${format(customRange.to, "dd/MM", { locale: ptBR })}` : ""}`
                    : "Período"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="range"
                  selected={{ from: customRange.from, to: customRange.to }}
                  onSelect={(r) => {
                    setCustomRange({ from: r?.from, to: r?.to });
                    setRangePreset("custom");
                  }}
                  locale={ptBR}
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 min-w-[220px] justify-start">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                {noFilter
                  ? "Todos acolhedores"
                  : `${selectedAcolhedores.length} selecionado${selectedAcolhedores.length > 1 ? "s" : ""}`}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[260px] p-2" align="start">
              <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b">
                <span className="text-xs font-medium">Acolhedores</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={clearAcolhedores}
                  disabled={noFilter}
                >
                  Limpar
                </Button>
              </div>
              <div className="max-h-[280px] overflow-y-auto space-y-0.5">
                <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/60 cursor-pointer text-xs">
                  <Checkbox
                    checked={selectedAcolhedores.includes("__none__")}
                    onCheckedChange={() => toggleAcolhedor("__none__")}
                  />
                  <span className="text-muted-foreground italic">Sem acolhedor</span>
                </label>
                {(allAcolhedores || []).map(id => {
                  const checked = selectedAcolhedores.includes(id);
                  return (
                    <label
                      key={id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/60 cursor-pointer text-xs"
                    >
                      <Checkbox checked={checked} onCheckedChange={() => toggleAcolhedor(id)} />
                      <span className="truncate">{getDisplayName(id) || id}</span>
                    </label>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>

          {!noFilter && (
            <div className="flex items-center gap-1 flex-wrap">
              {selectedAcolhedores.map(s => (
                <Badge key={s} variant="secondary" className="text-xs gap-1 pr-1">
                  {s === "__none__" ? "sem acolhedor" : (getDisplayName(s) || s)}
                  <button
                    type="button"
                    onClick={() => toggleAcolhedor(s)}
                    className="hover:bg-muted-foreground/20 rounded-sm p-0.5"
                    aria-label={`Remover ${s}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={clearAcolhedores}>
                Limpar filtro
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Funil */}
      <BpcFunnelBars
        board={board}
        metrics={filteredMetrics}
        loading={bpcLoading || leadsLoading}
        onOpenList={() => setSheetOpen(true)}
        leadsPerStage={leadsData?.byStage || {}}
      />

      <BpcFormLeadsSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        source="unificada"
        externalLeads={filteredBpcLeads}
        externalMetrics={filteredMetrics}
        externalLoading={bpcLoading}
        onRefresh={refetchBpc}
      />
    </div>
  );
};

export default BpcFunnelDetailPage;
