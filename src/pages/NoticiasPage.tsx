import { useEffect, useMemo, useState } from "react";
import { externalSupabase, ensureExternalSession } from "@/integrations/supabase/external-client";
import { useLeads } from "@/hooks/useLeads";
import { useKanbanBoards } from "@/hooks/useKanbanBoards";
import { LeadEditDialog } from "@/components/kanban/LeadEditDialog";
import { CadastrarCasoViavelDialog } from "@/components/noticias/CadastrarCasoViavelDialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Newspaper, Search, RefreshCw, Loader2, Star, CalendarIcon, MoreHorizontal,
  ArrowRight, CheckCircle2, X, Sparkles, Trash2,
} from "lucide-react";
import { format, formatDistanceToNow, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Lead } from "@/hooks/useLeads";
import type { DateRange } from "react-day-picker";

const TRABALHISTA_BOARD_ID = "2dcd54b5-502b-413b-b795-5e24a20797d2";
const NOTICIA_STATUS = "noticias";
const VIAVEL_STATUS = "viavel";
const FIRST_KANBAN_STAGE = "recepcao"; // "Cadastrados viáveis"

type FilterTab = "all" | typeof NOTICIA_STATUS | typeof VIAVEL_STATUS;

const NoticiasPage = () => {
  const [leads, setLeadsState] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<FilterTab>("all");
  const [openLead, setOpenLead] = useState<Lead | null>(null);
  const [casoLead, setCasoLead] = useState<Lead | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [movingId, setMovingId] = useState<string | null>(null);

  const { boards } = useKanbanBoards();
  const { updateLead } = useLeads(undefined, { mode: "full", detailLevel: "index" });

  const fetchLeads = async () => {
    setLoading(true);
    try {
      await ensureExternalSession();
      const { data, error } = await externalSupabase
        .from("leads")
        .select("*")
        .eq("board_id", TRABALHISTA_BOARD_ID)
        .in("status", [NOTICIA_STATUS, VIAVEL_STATUS])
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      setLeadsState((data as any as Lead[]) || []);
    } catch (e: any) {
      console.error("[NoticiasPage] fetch error", e);
      toast.error("Falha ao carregar", { description: e?.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLeads(); }, []);

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

  const countNoticias = leads.filter((l) => String(l.status) === NOTICIA_STATUS).length;
  const countViavel = leads.filter((l) => String(l.status) === VIAVEL_STATUS).length;

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

  // Soft-delete (mesmo padrão do resto do app): lead vai para Arquivados e é restaurável.
  const discardLead = async (lead: Lead) => {
    setMovingId(lead.id);
    try {
      await ensureExternalSession();
      const { error } = await externalSupabase
        .from("leads")
        .update({ deleted_at: new Date().toISOString() } as any)
        .eq("id", lead.id);
      if (error) throw error;
      setLeadsState((prev) => prev.filter((l) => l.id !== lead.id));
      toast.success("Lead descartado", {
        description: "Foi para Arquivados e pode ser restaurado.",
        action: {
          label: "Desfazer",
          onClick: async () => {
            const { error: undoErr } = await externalSupabase
              .from("leads")
              .update({ deleted_at: null } as any)
              .eq("id", lead.id);
            if (undoErr) {
              toast.error("Falha ao desfazer", { description: undoErr.message });
            } else {
              setLeadsState((prev) => [lead, ...prev]);
              toast.success("Lead restaurado");
            }
          },
        },
      });
    } catch (e: any) {
      toast.error("Falha ao descartar lead", { description: e?.message });
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
          <Button variant="outline" size="sm" onClick={fetchLeads} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Atualizar</span>
          </Button>
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
            </div>
          </div>

          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wide">
                <tr>
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
                  <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Carregando...
                  </td></tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">
                    Nenhum lead encontrado
                  </td></tr>
                )}
                {!loading && filtered.map((l) => {
                  const isNoticia = String(l.status) === NOTICIA_STATUS;
                  return (
                    <tr
                      key={l.id}
                      className="border-t hover:bg-muted/40 transition-colors group"
                    >
                      <td className="px-4 py-2.5 cursor-pointer" onClick={() => setOpenLead(l)}>
                        <div className="font-medium">
                          {l.lead_name || <span className="text-muted-foreground">—</span>}
                        </div>
                        {(() => {
                          const newsUrl = (l as any).news_link || (l as any).news_links?.[0];
                          return newsUrl ? (
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
                          ) : null;
                        })()}
                      </td>
                      <td className="px-4 py-2.5 cursor-pointer" onClick={() => setOpenLead(l)}>
                        {(l as any).victim_name || <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-2.5 cursor-pointer" onClick={() => setOpenLead(l)}>
                        {l.lead_phone || <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-2.5 cursor-pointer" onClick={() => setOpenLead(l)}>
                        {[l.city, l.state].filter(Boolean).join(" / ") || <span className="text-muted-foreground">—</span>}
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
                          {isNoticia ? (
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
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 border-emerald-500/60 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:hover:bg-emerald-900/30"
                              disabled={movingId === l.id}
                              onClick={() => moveLead(l, FIRST_KANBAN_STAGE, "Cadastrado no Kanban Trabalhista")}
                            >
                              {movingId === l.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                              )}
                              Cadastrar
                              <ArrowRight className="h-3 w-3 ml-1" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 border-violet-500/60 text-violet-700 hover:bg-violet-50 hover:text-violet-800 dark:hover:bg-violet-900/30"
                            onClick={() => setCasoLead(l)}
                            title="Cadastrar Caso Viável (análise com IA + grupo WhatsApp)"
                          >
                            <Sparkles className="h-3.5 w-3.5 mr-1" />
                            Caso Viável
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            disabled={movingId === l.id}
                            onClick={() => discardLead(l)}
                            title="Descartar lead (vai para Arquivados, restaurável)"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
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
