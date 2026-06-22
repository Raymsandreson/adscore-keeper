import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, Phone, MessageCircle, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { db as supabase } from "@/integrations/supabase";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { leadMatchesFilter, type BpcFilterResult } from "@/lib/bpcPhoneMatch";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  boardId?: string;
  stageId?: string;
  stageName?: string;
  stageColor?: string;
  dateField: "created_at" | "updated_at";
  fromDate: Date | null;
  toDate: Date | null;
  /** Filtro de acolhedor já calculado pela página pai. Quando phoneKeys é null, sem filtro. */
  bpcFilter: Pick<BpcFilterResult, "phoneKeys">;
  filterPending: boolean;
}

function fmtPhone(p?: string | null) {
  if (!p) return "—";
  const d = p.replace(/\D/g, "");
  // JID de grupo WhatsApp (`120363…`, 17+ dígitos) não é telefone.
  if (d.length >= 17) return "Grupo WhatsApp";
  if (d.length === 13 && d.startsWith("55")) {
    return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  }
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return p;
}

function fmtDateBR(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function BpcStageLeadsSheet({
  open,
  onOpenChange,
  boardId,
  stageId,
  stageName,
  stageColor,
  dateField,
  fromDate,
  toDate,
  bpcFilter,
  filterPending,
}: Props) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  const queryKey = [
    "bpc-stage-leads",
    boardId,
    stageId,
    dateField,
    fromDate?.toISOString() ?? "none",
    toDate?.toISOString() ?? "none",
  ];

  const { data: rows, isFetching } = useQuery({
    queryKey,
    enabled: open && !!boardId && !!stageId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const PAGE = 1000;
      const all: Array<{
        id: string;
        lead_name: string | null;
        lead_phone: string | null;
        acolhedor: string | null;
        created_at: string | null;
        updated_at: string | null;
        city: string | null;
        state: string | null;
      }> = [];
      for (let from = 0; ; from += PAGE) {
        let req = supabase
          .from("leads")
          .select("id, lead_name, lead_phone, acolhedor, created_at, updated_at, city, state")
          .eq("board_id", boardId!)
          .eq("status", stageId!)
          .order(dateField, { ascending: false })
          .range(from, from + PAGE - 1);
        if (fromDate) req = req.gte(dateField, fromDate.toISOString());
        if (toDate) req = req.lte(dateField, toDate.toISOString());
        const { data, error } = await req;
        if (error) throw error;
        const batch = data || [];
        all.push(...(batch as typeof all));
        if (batch.length < PAGE) break;
      }
      return all;
    },
  });

  const filtered = useMemo(() => {
    const base = rows || [];
    const skipAcolhFilter = filterPending || !bpcFilter.phoneKeys;
    const term = q.trim().toLowerCase();
    return base.filter((l) => {
      if (!skipAcolhFilter && !leadMatchesFilter(l.lead_phone, bpcFilter)) return false;
      if (!term) return true;
      return (
        (l.lead_name || "").toLowerCase().includes(term) ||
        (l.lead_phone || "").toLowerCase().includes(term) ||
        (l.acolhedor || "").toLowerCase().includes(term)
      );
    });
  }, [rows, q, bpcFilter, filterPending]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {stageColor && (
              <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: stageColor }} />
            )}
            Leads em "{stageName}"
            <Badge variant="outline" className="ml-2 text-xs">{filtered.length}</Badge>
          </SheetTitle>
          <SheetDescription className="text-xs">
            Lista de leads que estão atualmente nesta etapa do funil.
          </SheetDescription>
        </SheetHeader>

        <div className="relative mt-3">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, telefone ou acolhedor..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-8 h-9"
          />
        </div>

        <ScrollArea className="flex-1 mt-3 -mx-6 px-6">
          {isFetching ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-10">
              Nenhum lead encontrado nesta etapa.
            </div>
          ) : (
            <div className="space-y-2 pb-6">
              {filtered.map((l) => {
                const phoneDigits = (l.lead_phone || "").replace(/\D/g, "");
                return (
                  <div
                    key={l.id}
                    className="border rounded-lg p-3 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">
                          {l.lead_name || "Sem nome"}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                          <Phone className="h-3 w-3" />
                          {fmtPhone(l.lead_phone)}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                          {l.acolhedor && <span>👤 {l.acolhedor}</span>}
                          {(l.city || l.state) && <span>📍 {[l.city, l.state].filter(Boolean).join("/")}</span>}
                          <span>{dateField === "created_at" ? "Cadastro" : "Atualizado"}: {fmtDateBR(l[dateField])}</span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => navigate(`/leads?board=${boardId}&lead=${l.id}`)}
                        >
                          <ExternalLink className="h-3 w-3 mr-1" />
                          Abrir
                        </Button>
                        {phoneDigits && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => window.open(`https://wa.me/${phoneDigits}`, "_blank")}
                          >
                            <MessageCircle className="h-3 w-3 mr-1" />
                            WA
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
