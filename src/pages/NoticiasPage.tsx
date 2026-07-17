import { useEffect, useMemo, useRef, useState } from "react";
import { externalSupabase, ensureExternalSession } from "@/integrations/supabase/external-client";
import { useLeads } from "@/hooks/useLeads";
import { useKanbanBoards } from "@/hooks/useKanbanBoards";
import { LeadEditDialog } from "@/components/kanban/LeadEditDialog";
import { CadastrarCasoViavelDialog } from "@/components/noticias/CadastrarCasoViavelDialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Newspaper, Search, RefreshCw, Loader2, Star, CalendarIcon,
  X, Sparkles, Trash2, ChevronDown, ChevronRight, Layers,
} from "lucide-react";
import { format, formatDistanceToNow, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { cloudFunctions } from "@/lib/functionRouter";
import type { Lead } from "@/hooks/useLeads";
import type { DateRange } from "react-day-picker";

const TRABALHISTA_BOARD_ID = "2dcd54b5-502b-413b-b795-5e24a20797d2";
const NOTICIA_STATUS = "noticias";
const VIAVEL_STATUS = "viavel";
const PAGE_SIZE = 1000; // teto por request do PostgREST; paginamos até carregar tudo

type FilterTab = "all" | typeof NOTICIA_STATUS | typeof VIAVEL_STATUS;

// ============================================================
// Agrupamento de duplicatas (mesma notícia em fontes diferentes)
// ============================================================
const STOPWORDS = new Set([
  "de", "da", "do", "das", "dos", "em", "na", "no", "nas", "nos", "a", "o", "as", "os",
  "e", "um", "uma", "apos", "com", "por", "para", "que", "ser", "ao", "aos", "sobre",
  "entre", "sua", "seu", "the", "and", "for", "after",
]);

function titleTokens(name: string): Set<string> {
  const norm = (name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Remove sufixo de fonte ("... - G1", "... - Banda B") quando curto
  const parts = norm.split(" - ");
  const base = parts.length > 1 && parts[parts.length - 1].length <= 30
    ? parts.slice(0, -1).join(" - ")
    : norm;
  const toks = base
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return new Set(toks);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  small.forEach((t) => { if (large.has(t)) inter++; });
  return inter / (a.size + b.size - inter);
}

const GROUP_WINDOW_MS = 5 * 24 * 3600 * 1000;
const SIMILARITY_THRESHOLD = 0.5;

/** Agrupa leads (já ordenados por created_at desc) por similaridade de título ou mesma vítima. */
function buildGroups(leads: Lead[]): Lead[][] {
  const toks = leads.map((l) => titleTokens(l.lead_name || ""));
  const victims = leads.map((l) =>
    String((l as any).victim_name || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  );
  const times = leads.map((l) => (l.created_at ? new Date(l.created_at).getTime() : 0));
  const parent = leads.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };

  for (let i = 0; i < leads.length; i++) {
    for (let j = i + 1; j < leads.length; j++) {
      if (times[i] - times[j] > GROUP_WINDOW_MS) break; // lista ordenada desc
      const sameVictim =
        victims[i].length >= 5 && victims[j].length >= 5 &&
        (victims[i].includes(victims[j]) || victims[j].includes(victims[i]));
      if (sameVictim || jaccard(toks[i], toks[j]) >= SIMILARITY_THRESHOLD) union(i, j);
    }
  }

  const map = new Map<number, Lead[]>();
  leads.forEach((l, i) => {
    const root = find(i);
    if (!map.has(root)) map.set(root, []);
    map.get(root)!.push(l);
  });
  return [...map.values()];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const NoticiasPage = () => {
  const [leads, setLeadsState] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<FilterTab>("all");
  const [openLead, setOpenLead] = useState<Lead | null>(null);
  const [casoLead, setCasoLead] = useState<Lead | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [movingId, setMovingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [enriching, setEnriching] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const autoEnrichRan = useRef(false);

  const { boards } = useKanbanBoards();
  const { updateLead } = useLeads(undefined, { mode: "full", detailLevel: "index" });

  const fetchLeads = async () => {
    setLoading(true);
    try {
      await ensureExternalSession();
      let all: Lead[] = [];
      for (let from = 0; from < 20000; from += PAGE_SIZE) {
        const { data, error } = await externalSupabase
          .from("leads")
          .select("*")
          .eq("board_id", TRABALHISTA_BOARD_ID)
          .in("status", [NOTICIA_STATUS, VIAVEL_STATUS])
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        all = all.concat((data as any as Lead[]) || []);
        if (!data || data.length < PAGE_SIZE) break;
      }
      setLeadsState(all);
      setSelectedIds(new Set());
    } catch (e: any) {
      console.error("[NoticiasPage] fetch error", e);
      toast.error("Falha ao carregar", { description: e?.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLeads(); }, []);

  // ============================================================
  // Enriquecimento com IA (vítima/cidade/UF + arquivo de estrangeiras)
  // ============================================================
  const pendingCount = useMemo(
    () => leads.filter((l) => !(l as any).news_enriched_at).length,
    [leads]
  );

  const runEnrichment = async () => {
    if (enriching) return;
    setEnriching(true);
    const toastId = toast.loading("Analisando manchetes com IA...");
    let total = 0;
    let foreign = 0;
    try {
      // Cada chamada processa até ~240 manchetes; repete até zerar a fila
      for (let round = 0; round < 30; round++) {
        const { data, error } = await cloudFunctions.invoke<{
          success: boolean; processed: number; foreign_archived: number; remaining: number; error?: string;
        }>("enrich-news-leads", { body: {} });
        if (error || !data?.success) throw new Error(data?.error || error?.message || "erro desconhecido");
        total += data.processed;
        foreign += data.foreign_archived;
        toast.loading(`IA: ${total} manchetes analisadas, ${foreign} estrangeiras arquivadas...`, { id: toastId });
        if (data.processed === 0 || data.remaining === 0) break;
      }
      toast.success(`Análise concluída: ${total} manchetes, ${foreign} estrangeiras arquivadas`, { id: toastId });
      await fetchLeads();
    } catch (e: any) {
      console.error("[NoticiasPage] enrichment error", e);
      toast.error("Falha na análise com IA", { id: toastId, description: e?.message });
    } finally {
      setEnriching(false);
    }
  };

  // Dispara automaticamente 1x por visita quando há manchetes pendentes
  useEffect(() => {
    if (!loading && !autoEnrichRan.current && pendingCount > 0) {
      autoEnrichRan.current = true;
      runEnrichment();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, pendingCount]);

  // ============================================================
  // Filtro + agrupamento
  // ============================================================
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const from = dateRange?.from ? startOfDay(dateRange.from).getTime() : null;
    const to = dateRange?.to ? endOfDay(dateRange.to).getTime() : (dateRange?.from ? endOfDay(dateRange.from).getTime() : null);
    return leads.filter((l) => {
      if (tab !== "all" && String(l.status) !== tab) return false;
      if (from && to && l.created_at) {
        const t = new Date(l.created_at).getTime();
        if (t < from || t > to) return false;
      }
      if (!term) return true;
      return (
        (l.lead_name || "").toLowerCase().includes(term) ||
        (l.lead_phone || "").toLowerCase().includes(term) ||
        ((l as any).victim_name || "").toLowerCase().includes(term) ||
        (l.city || "").toLowerCase().includes(term) ||
        (l.state || "").toLowerCase().includes(term)
      );
    });
  }, [leads, search, tab, dateRange]);

  const groups = useMemo(() => buildGroups(filtered), [filtered]);

  const countNoticias = leads.filter((l) => String(l.status) === NOTICIA_STATUS).length;
  const countViavel = leads.filter((l) => String(l.status) === VIAVEL_STATUS).length;

  // ============================================================
  // Seleção múltipla + descarte em massa
  // ============================================================
  const toggleIds = (ids: string[], on: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((l) => selectedIds.has(l.id));

  const discardMany = async (ids: string[]) => {
    if (ids.length === 0) return;
    setBulkDeleting(true);
    const nowIso = new Date().toISOString();
    try {
      await ensureExternalSession();
      for (const part of chunk(ids, 200)) {
        const { error } = await externalSupabase
          .from("leads")
          .update({ deleted_at: nowIso } as any)
          .in("id", part);
        if (error) throw error;
      }
      const idSet = new Set(ids);
      const removed = leads.filter((l) => idSet.has(l.id));
      setLeadsState((prev) => prev.filter((l) => !idSet.has(l.id)));
      setSelectedIds(new Set());
      toast.success(`${ids.length} lead(s) descartado(s)`, {
        description: "Foram para Arquivados e podem ser restaurados.",
        action: {
          label: "Desfazer",
          onClick: async () => {
            try {
              for (const part of chunk(ids, 200)) {
                const { error } = await externalSupabase
                  .from("leads")
                  .update({ deleted_at: null } as any)
                  .in("id", part);
                if (error) throw error;
              }
              setLeadsState((prev) => [...removed, ...prev]);
              toast.success("Leads restaurados");
            } catch (e: any) {
              toast.error("Falha ao desfazer", { description: e?.message });
            }
          },
        },
      });
    } catch (e: any) {
      toast.error("Falha ao descartar", { description: e?.message });
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleSave = async (leadId: string, updates: Partial<Lead>) => {
    await updateLead(leadId, updates);
    setLeadsState((prev) =>
      prev
        .map((l) => (l.id === leadId ? { ...l, ...updates } : l))
        .filter((l) => [NOTICIA_STATUS, VIAVEL_STATUS].includes(String(l.status)))
    );
  };

  const moveLead = async (lead: Lead, newStatus: string, successMsg: string) => {
    setMovingId(lead.id);
    try {
      await updateLead(lead.id, { status: newStatus } as any);
      setLeadsState((prev) =>
        prev
          .map((l) => (l.id === lead.id ? { ...l, status: newStatus as any } : l))
          .filter((l) => [NOTICIA_STATUS, VIAVEL_STATUS].includes(String(l.status)))
      );
      toast.success(successMsg);
    } catch (e: any) {
      toast.error("Falha ao mover lead", { description: e?.message });
    } finally {
      setMovingId(null);
    }
  };

  const clearFilters = () => {
    setSearch("");
    setDateRange(undefined);
    setTab("all");
  };

  const hasFilters = !!search || !!dateRange?.from || tab !== "all";

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const renderRow = (l: Lead, opts: { group?: Lead[]; isMember?: boolean } = {}) => {
    const isNoticia = String(l.status) === NOTICIA_STATUS;
    const group = opts.group;
    const groupSize = group?.length || 1;
    const isExpanded = group ? expandedGroups.has(l.id) : false;
    const memberIds = group ? group.map((g) => g.id) : [l.id];
    const checked = memberIds.every((id) => selectedIds.has(id));
    const someChecked = !checked && memberIds.some((id) => selectedIds.has(id));
    // Célula Vítima/Local: mostra o 1º valor preenchido do grupo
    const victim = group
      ? group.map((g) => (g as any).victim_name).find(Boolean) || ""
      : (l as any).victim_name || "";
    const locSource = group ? group.find((g) => g.city || g.state) || l : l;
    const loc = [locSource.city, locSource.state].filter(Boolean).join(" / ");
    const newsUrl = (l as any).news_link || (l as any).news_links?.[0];

    return (
      <tr
        key={l.id}
        className={cn(
          "border-t hover:bg-muted/40 transition-colors group",
          opts.isMember && "bg-muted/20"
        )}
      >
        <td className="px-3 py-2.5 align-top">
          <Checkbox
            checked={someChecked ? "indeterminate" : checked}
            onCheckedChange={(v) => toggleIds(memberIds, v === true)}
            aria-label="Selecionar"
          />
        </td>
        <td className={cn("px-4 py-2.5 cursor-pointer", opts.isMember && "pl-10")} onClick={() => setOpenLead(l)}>
          <div className="flex items-center gap-2">
            {groupSize > 1 && !opts.isMember && (
              <button
                onClick={(e) => { e.stopPropagation(); toggleGroup(l.id); }}
                className="shrink-0 flex items-center gap-1 text-xs rounded-full border border-amber-500/50 bg-amber-50 dark:bg-amber-900/30 text-amber-700 px-2 py-0.5 hover:bg-amber-100"
                title={`${groupSize} fontes da mesma notícia — clique para ${isExpanded ? "recolher" : "expandir"}`}
              >
                {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <Layers className="h-3 w-3" />
                {groupSize}
              </button>
            )}
            <div className="font-medium">
              {l.lead_name || <span className="text-muted-foreground">—</span>}
            </div>
          </div>
          {newsUrl ? (
            <a
              href={newsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline block max-w-[360px] truncate"
              onClick={(e) => e.stopPropagation()}
              title={newsUrl}
            >
              {newsUrl}
            </a>
          ) : null}
        </td>
        <td className="px-4 py-2.5 cursor-pointer" onClick={() => setOpenLead(l)}>
          {victim || <span className="text-muted-foreground">—</span>}
        </td>
        <td className="px-4 py-2.5 cursor-pointer" onClick={() => setOpenLead(l)}>
          {l.lead_phone || <span className="text-muted-foreground">—</span>}
        </td>
        <td className="px-4 py-2.5 cursor-pointer" onClick={() => setOpenLead(l)}>
          {loc || <span className="text-muted-foreground">—</span>}
        </td>
        <td className="px-4 py-2.5">
          {isNoticia ? (
            <Badge variant="outline" className="border-slate-400 text-slate-600 bg-slate-50 dark:bg-slate-900/40">
              <Newspaper className="h-3 w-3 mr-1" />Notícia
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-500 text-amber-700 bg-amber-50 dark:bg-amber-900/30">
              <Star className="h-3 w-3 mr-1" />Viável
            </Badge>
          )}
        </td>
        <td className="px-4 py-2.5 text-muted-foreground text-xs">
          {l.created_at ? formatDistanceToNow(new Date(l.created_at), { locale: ptBR, addSuffix: true }) : "—"}
        </td>
        <td className="px-2 py-2.5">
          <div className="flex items-center justify-end gap-1">
            {isNoticia && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-amber-500/60 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:hover:bg-amber-900/30"
                disabled={movingId === l.id}
                onClick={() => moveLead(l, VIAVEL_STATUS, "Movido para Viável")}
              >
                {movingId === l.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Star className="h-3.5 w-3.5 mr-1" />
                )}
                Viável
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-8 border-emerald-500/60 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:hover:bg-emerald-900/30"
              onClick={() => setCasoLead(l)}
              title="Cadastrar caso (análise com IA + grupo WhatsApp)"
            >
              <Sparkles className="h-3.5 w-3.5 mr-1" />
              Cadastrar
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              disabled={bulkDeleting}
              onClick={() => discardMany(groupSize > 1 && !opts.isMember ? memberIds : [l.id])}
              title={groupSize > 1 && !opts.isMember
                ? `Descartar as ${groupSize} fontes desta notícia (vai para Arquivados, restaurável)`
                : "Descartar lead (vai para Arquivados, restaurável)"}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-5">
        {/* Header */}
        <header className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-amber-500/15 text-amber-600 flex items-center justify-center shadow-sm">
              <Newspaper className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Notícias</h1>
              <p className="text-sm text-muted-foreground">
                Triagem de casos de notícias e leads marcados como viáveis
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={runEnrichment}
              disabled={enriching || loading || pendingCount === 0}
              title="Extrai vítima/cidade dos títulos e arquiva notícias estrangeiras"
            >
              {enriching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              <span className="ml-2">
                {enriching ? "Analisando..." : pendingCount > 0 ? `Analisar títulos (${pendingCount})` : "Títulos analisados"}
              </span>
            </Button>
            <Button variant="outline" size="sm" onClick={fetchLeads} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-2">Atualizar</span>
            </Button>
          </div>
        </header>

        {/* Stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard
            label="Total na triagem"
            value={leads.length}
            icon={<Newspaper className="h-4 w-4" />}
            tone="neutral"
            onClick={() => setTab("all")}
            active={tab === "all"}
          />
          <StatCard
            label="📰 Notícias"
            value={countNoticias}
            icon={<Newspaper className="h-4 w-4" />}
            tone="slate"
            onClick={() => setTab(NOTICIA_STATUS)}
            active={tab === NOTICIA_STATUS}
          />
          <StatCard
            label="⭐ Viáveis"
            value={countViavel}
            icon={<Star className="h-4 w-4" />}
            tone="amber"
            onClick={() => setTab(VIAVEL_STATUS)}
            active={tab === VIAVEL_STATUS}
          />
        </div>

        {/* Filters + Table */}
        <Card className="overflow-hidden">
          <div className="p-3 sm:p-4 border-b bg-card flex items-center gap-2 flex-wrap">
            <Tabs value={tab} onValueChange={(v) => setTab(v as FilterTab)}>
              <TabsList>
                <TabsTrigger value="all">Todos</TabsTrigger>
                <TabsTrigger value={NOTICIA_STATUS}>Notícias</TabsTrigger>
                <TabsTrigger value={VIAVEL_STATUS}>Viáveis</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar nome, telefone, vítima, cidade..."
                className="pl-8 h-9"
              />
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn("h-9 justify-start font-normal", !dateRange?.from && "text-muted-foreground")}
                >
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  {dateRange?.from ? (
                    dateRange.to ? (
                      <>
                        {format(dateRange.from, "dd MMM", { locale: ptBR })} –{" "}
                        {format(dateRange.to, "dd MMM yy", { locale: ptBR })}
                      </>
                    ) : (
                      format(dateRange.from, "dd MMM yyyy", { locale: ptBR })
                    )
                  ) : (
                    <span>Período</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="range"
                  selected={dateRange}
                  onSelect={setDateRange}
                  numberOfMonths={2}
                  locale={ptBR}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
                <div className="p-2 border-t flex justify-between">
                  <Button variant="ghost" size="sm" onClick={() => setDateRange(undefined)}>Limpar</Button>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => {
                      const d = new Date();
                      setDateRange({ from: d, to: d });
                    }}>Hoje</Button>
                    <Button variant="ghost" size="sm" onClick={() => {
                      const to = new Date();
                      const from = new Date(); from.setDate(from.getDate() - 6);
                      setDateRange({ from, to });
                    }}>7 dias</Button>
                    <Button variant="ghost" size="sm" onClick={() => {
                      const to = new Date();
                      const from = new Date(); from.setDate(from.getDate() - 29);
                      setDateRange({ from, to });
                    }}>30 dias</Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 text-muted-foreground">
                <X className="h-4 w-4 mr-1" /> Limpar
              </Button>
            )}

            <div className="ml-auto text-xs text-muted-foreground">
              {filtered.length} de {leads.length}
              {groups.length < filtered.length && ` · ${groups.length} notícias únicas`}
            </div>
          </div>

          {/* Barra de ação em massa */}
          {selectedIds.size > 0 && (
            <div className="px-4 py-2 border-b bg-destructive/5 flex items-center gap-3">
              <span className="text-sm font-medium">{selectedIds.size} selecionado(s)</span>
              <Button
                size="sm"
                variant="destructive"
                className="h-8"
                disabled={bulkDeleting}
                onClick={() => discardMany([...selectedIds])}
              >
                {bulkDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Trash2 className="h-3.5 w-3.5 mr-1" />}
                Descartar selecionados
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-muted-foreground"
                onClick={() => setSelectedIds(new Set())}
              >
                <X className="h-3.5 w-3.5 mr-1" /> Limpar seleção
              </Button>
            </div>
          )}

          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wide">
                <tr>
                  <th className="w-8 px-3 py-2.5">
                    <Checkbox
                      checked={allFilteredSelected}
                      onCheckedChange={(v) => toggleIds(filtered.map((l) => l.id), v === true)}
                      aria-label="Selecionar todos"
                    />
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium">Nome</th>
                  <th className="text-left px-4 py-2.5 font-medium">Vítima</th>
                  <th className="text-left px-4 py-2.5 font-medium">Telefone</th>
                  <th className="text-left px-4 py-2.5 font-medium">Local</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium">Criado</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Carregando...
                  </td></tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">
                    Nenhum lead encontrado
                  </td></tr>
                )}
                {!loading && groups.map((group) => {
                  const primary = group[0];
                  const rows = [renderRow(primary, { group })];
                  if (group.length > 1 && expandedGroups.has(primary.id)) {
                    group.slice(1).forEach((member) => rows.push(renderRow(member, { isMember: true })));
                  }
                  return rows;
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <LeadEditDialog
        open={!!openLead}
        onOpenChange={(v) => !v && setOpenLead(null)}
        lead={openLead}
        onSave={handleSave}
        boards={boards}
        mode="sheet"
      />

      <CadastrarCasoViavelDialog
        lead={casoLead}
        open={!!casoLead}
        onOpenChange={(v) => !v && setCasoLead(null)}
        saveLead={handleSave}
        onRegistered={fetchLeads}
      />
    </div>
  );
};

const toneMap = {
  neutral: "bg-card text-foreground",
  slate: "bg-slate-50 dark:bg-slate-900/40 text-slate-700 dark:text-slate-300",
  amber: "bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
} as const;

function StatCard({
  label, value, icon, tone, onClick, active,
}: {
  label: string; value: number; icon: React.ReactNode;
  tone: keyof typeof toneMap; onClick?: () => void; active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-left rounded-xl border p-4 transition-all hover:shadow-sm hover:border-foreground/20",
        active && "ring-2 ring-primary/40 border-primary/40",
        toneMap[tone]
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide opacity-70">{label}</span>
        <span className="opacity-60">{icon}</span>
      </div>
      <div className="text-3xl font-semibold mt-2 tabular-nums">{value}</div>
    </button>
  );
}

export default NoticiasPage;
