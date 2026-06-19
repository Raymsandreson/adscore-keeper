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

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
  const [acolhedorId, setAcolhedorId] = useState<string>("all");
  const [sheetOpen, setSheetOpen] = useState(false);

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

  // Lista de acolhedores vinda da planilha (coluna operator)
  const allAcolhedores = useMemo(() => {
    const set = new Set<string>();
    for (const l of bpcLeads) {
      const op = (l.operator || "").trim();
      if (op) set.add(op);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [bpcLeads]);

  // Filtra leads da planilha pelo operador (acolhedor) selecionado
  const filteredBpcLeads = useMemo(() => {
    if (acolhedorId === "all") return bpcLeads;
    if (acolhedorId === "none") {
      return bpcLeads.filter(l => !(l.operator || "").trim());
    }
    const target = acolhedorId.toLowerCase();
    return bpcLeads.filter(l => (l.operator || "").trim().toLowerCase() === target);
  }, [bpcLeads, acolhedorId]);

  // Per-stage counts (tabela leads) — cruza por telefone com a planilha filtrada
  const filteredPhones = useMemo(() => {
    const set = new Set<string>();
    for (const l of filteredBpcLeads) {
      const p = String(l.phone_normalized || l.phone_raw || "").replace(/\D/g, "");
      if (!p) continue;
      set.add(p);
      set.add(p.replace(/^55/, ""));
      set.add(`55${p}`);
    }
    return Array.from(set);
  }, [filteredBpcLeads]);

  const leadsQueryKey = ["bpc-detail-leads", boardId, dateField, fromDate?.toISOString(), toDate?.toISOString(), acolhedorId, filteredPhones.length];
  const { data: leadsData, isFetching: leadsLoading, refetch: refetchLeads } = useQuery({
    queryKey: leadsQueryKey,
    queryFn: async () => {
      if (!boardId) return { byStage: {} as Record<string, number>, total: 0 };
      let q = supabase.from("leads").select("status, lead_phone").eq("board_id", boardId);
      if (fromDate) q = q.gte(dateField, fromDate.toISOString());
      if (toDate) q = q.lte(dateField, toDate.toISOString());
      const { data, error } = await q;
      if (error) throw error;
      const phoneSet = acolhedorId === "all" ? null : new Set(filteredPhones);
      const byStage: Record<string, number> = {};
      let total = 0;
      for (const l of data || []) {
        if (phoneSet) {
          const p = String(l.lead_phone || "").replace(/\D/g, "");
          if (!p || !phoneSet.has(p)) continue;
        }
        byStage[l.status] = (byStage[l.status] || 0) + 1;
        total++;
      }
      return { byStage, total };
    },
    enabled: !!boardId,
  });

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

          <Select value={acolhedorId} onValueChange={setAcolhedorId}>
            <SelectTrigger className="h-8 w-[220px] text-xs">
              <Users className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue placeholder="Acolhedor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos acolhedores</SelectItem>
              <SelectItem value="none">Sem acolhedor</SelectItem>
              {(allAcolhedores || []).map(id => (
                <SelectItem key={id} value={id}>
                  {getDisplayName(id) || id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {acolhedorId !== "all" && (
            <Badge variant="secondary" className="text-xs">
              Filtro: {acolhedorId === "none" ? "sem acolhedor" : (getDisplayName(acolhedorId) || acolhedorId)}
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* Funil */}
      <BpcFunnelBars
        board={board}
        metrics={acolhedorId === "all" ? bpcMetrics : { ...bpcMetrics, total: leadsData?.total || 0 }}
        loading={bpcLoading || leadsLoading}
        onOpenList={() => setSheetOpen(true)}
        leadsPerStage={leadsData?.byStage || {}}
      />

      <BpcFormLeadsSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        source="unificada"
        externalLeads={filteredBpcLeads}
        externalMetrics={acolhedorId === "all" ? bpcMetrics : { ...bpcMetrics, total: filteredBpcLeads.length }}
        externalLoading={bpcLoading}
        onRefresh={refetchBpc}
      />
    </div>
  );
};

export default BpcFunnelDetailPage;
