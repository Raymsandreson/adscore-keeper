import { useEffect, useMemo, useState } from "react";
import { externalSupabase, ensureExternalSession } from "@/integrations/supabase/external-client";
import { useLeads } from "@/hooks/useLeads";
import { useKanbanBoards } from "@/hooks/useKanbanBoards";
import { LeadEditDialog } from "@/components/kanban/LeadEditDialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Newspaper, Search, RefreshCw, Loader2, Star } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Lead } from "@/hooks/useLeads";

const TRABALHISTA_BOARD_ID = "2dcd54b5-502b-413b-b795-5e24a20797d2";
const NOTICIA_STATUS = "noticias";
const VIAVEL_STATUS = "viavel";

type FilterTab = "all" | typeof NOTICIA_STATUS | typeof VIAVEL_STATUS;

const NoticiasPage = () => {
  const [leads, setLeadsState] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<FilterTab>("all");
  const [openLead, setOpenLead] = useState<Lead | null>(null);

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
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      setLeadsState((data as any as Lead[]) || []);
    } catch (e: any) {
      console.error("[NoticiasPage] fetch error", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeads();
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (tab !== "all" && l.status !== tab) return false;
      if (!term) return true;
      return (
        (l.lead_name || "").toLowerCase().includes(term) ||
        (l.lead_phone || "").toLowerCase().includes(term) ||
        (l.victim_name || "").toLowerCase().includes(term) ||
        (l.city || "").toLowerCase().includes(term) ||
        (l.state || "").toLowerCase().includes(term)
      );
    });
  }, [leads, search, tab]);

  const countNoticias = leads.filter((l) => l.status === NOTICIA_STATUS).length;
  const countViavel = leads.filter((l) => l.status === VIAVEL_STATUS).length;

  const handleSave = async (leadId: string, updates: Partial<Lead>) => {
    await updateLead(leadId, updates);
    setLeadsState((prev) =>
      prev
        .map((l) => (l.id === leadId ? { ...l, ...updates } : l))
        // se mudou para outro status, tira da lista
        .filter((l) => l.status === NOTICIA_STATUS || l.status === VIAVEL_STATUS)
    );
  };

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        <header className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-500/15 text-amber-600 flex items-center justify-center">
              <Newspaper className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">Notícias</h1>
              <p className="text-sm text-muted-foreground">
                Triagem de casos vindos de notícias e leads marcados como viáveis
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchLeads} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Atualizar</span>
          </Button>
        </header>

        <Card className="p-3 sm:p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Tabs value={tab} onValueChange={(v) => setTab(v as FilterTab)}>
              <TabsList>
                <TabsTrigger value="all">Todos <Badge variant="secondary" className="ml-2">{leads.length}</Badge></TabsTrigger>
                <TabsTrigger value={NOTICIA_STATUS}>📰 Notícias <Badge variant="secondary" className="ml-2">{countNoticias}</Badge></TabsTrigger>
                <TabsTrigger value={VIAVEL_STATUS}>⭐ Viável <Badge variant="secondary" className="ml-2">{countViavel}</Badge></TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome, telefone, vítima, cidade..."
                className="pl-8"
              />
            </div>
          </div>

          <div className="overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Nome</th>
                  <th className="text-left px-3 py-2">Vítima</th>
                  <th className="text-left px-3 py-2">Telefone</th>
                  <th className="text-left px-3 py-2">Local</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Criado</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Carregando...
                  </td></tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">
                    Nenhum lead encontrado
                  </td></tr>
                )}
                {!loading && filtered.map((l) => (
                  <tr
                    key={l.id}
                    onClick={() => setOpenLead(l)}
                    className="border-t hover:bg-muted/30 cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2 font-medium">{l.lead_name || <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-2">{(l as any).victim_name || <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-2">{l.lead_phone || <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-2">
                      {[l.city, l.state].filter(Boolean).join(" / ") || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {l.status === NOTICIA_STATUS ? (
                        <Badge variant="outline" className="border-slate-400 text-slate-600"><Newspaper className="h-3 w-3 mr-1" />Notícia</Badge>
                      ) : (
                        <Badge variant="outline" className="border-amber-500 text-amber-600"><Star className="h-3 w-3 mr-1" />Viável</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">
                      {l.created_at ? formatDistanceToNow(new Date(l.created_at), { locale: ptBR, addSuffix: true }) : "—"}
                    </td>
                  </tr>
                ))}
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
    </div>
  );
};

export default NoticiasPage;
