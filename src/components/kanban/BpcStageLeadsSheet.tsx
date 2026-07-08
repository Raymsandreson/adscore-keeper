import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, Phone, MessageCircle, ExternalLink, Sheet as SheetIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { db as supabase } from "@/integrations/supabase";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { leadMatchesFilter, type BpcFilterResult } from "@/lib/bpcPhoneMatch";
import type { BpcFormLead } from "@/hooks/useBpcFormLeads";

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
  /** Leads da planilha (Meta Lead Ads). Usados para a primeira etapa (Recepção). */
  sheetLeads?: BpcFormLead[];
  /** True quando a etapa selecionada é a primeira do board (inbox). */
  isInboxStage?: boolean;
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

function uniqueAcolhedorValue(operator?: string | null, tab?: string | null): string | null {
  const values = [operator, tab].filter((v): v is string => !!v?.trim());
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(v.trim());
  }
  return unique.join(" — ") || null;
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
  sheetLeads,
  isInboxStage,
}: Props) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [detailLead, setDetailLead] = useState<BpcFormLead | null>(null);

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

  type UnifiedRow = {
    key: string;
    source: "kanban" | "sheet";
    id: string | null;
    lead_name: string | null;
    lead_phone: string | null;
    acolhedor: string | null;
    created_at: string | null;
    updated_at: string | null;
    city: string | null;
    state: string | null;
    sheet_status?: string | null;
    sheet_ad?: string | null;
    raw?: BpcFormLead;
  };

  const filtered = useMemo<UnifiedRow[]>(() => {
    const base = rows || [];
    const skipAcolhFilter = filterPending || !bpcFilter.phoneKeys;
    const term = q.trim().toLowerCase();

    const kanbanRows: UnifiedRow[] = base
      .filter((l) => (skipAcolhFilter ? true : leadMatchesFilter(l.lead_phone, bpcFilter)))
      .map((l) => ({
        key: `k:${l.id}`,
        source: "kanban" as const,
        id: l.id,
        lead_name: l.lead_name,
        lead_phone: l.lead_phone,
        acolhedor: l.acolhedor,
        created_at: l.created_at,
        updated_at: l.updated_at,
        city: l.city,
        state: l.state,
      }));

    // Última-8 dígitos das leads já no kanban → usadas para deduplicar contra a planilha.
    const kanbanPhoneKeys = new Set(
      kanbanRows
        .map((l) => (l.lead_phone || "").replace(/\D/g, "").slice(-8))
        .filter((p) => p.length === 8),
    );

    const sheetRows: UnifiedRow[] = (isInboxStage && sheetLeads?.length)
      ? sheetLeads
        .filter((s) => {
          const last8 = (s.phone_normalized || "").slice(-8);
          return last8.length === 8;
        })
        .map((s) => ({
          key: `s:${s.form_lead_id || s.phone_normalized}`,
          source: "sheet" as const,
          id: null,
          lead_name: s.name || null,
          lead_phone: s.phone_normalized || s.phone_raw || null,
          acolhedor: s.operator || null,
          created_at: s.created_at || null,
          updated_at: null,
          city: null,
          state: null,
          sheet_status: s.lead_status || null,
          sheet_ad: s.ad_name || s.campaign_name || null,
          raw: s,
        }))
      : [];

    // Na etapa Recepção exibimos APENAS os leads vindos da planilha.
    const merged = isInboxStage ? sheetRows : kanbanRows;

    const afterSearch = merged.filter((l) => {
      if (!term) return true;
      return (
        (l.lead_name || "").toLowerCase().includes(term) ||
        (l.lead_phone || "").toLowerCase().includes(term) ||
        (l.acolhedor || "").toLowerCase().includes(term)
      );
    });

    // Dedup por telefone: kanban sempre vence porque aparece antes.
    const seen = new Set<string>();
    const deduped: UnifiedRow[] = [];
    for (const l of afterSearch) {
      const digits = (l.lead_phone || "").replace(/\D/g, "");
      const key = digits.slice(-8) || `id:${l.id ?? l.key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(l);
    }
    return deduped;
  }, [rows, q, bpcFilter, filterPending, sheetLeads, isInboxStage]);

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
                const isSheet = l.source === "sheet";
                return (
                  <div
                    key={l.key}
                    className={`border rounded-lg p-3 hover:bg-muted/40 transition-colors ${isSheet ? "cursor-pointer" : ""}`}
                    onClick={() => {
                      if (isSheet && l.raw) setDetailLead(l.raw);
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="font-medium text-sm truncate">
                            {l.lead_name || "Sem nome"}
                          </div>
                          {isSheet && (
                            <Badge variant="secondary" className="text-[10px] gap-1 shrink-0">
                              <SheetIcon className="h-2.5 w-2.5" />
                              da planilha
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                          <Phone className="h-3 w-3" />
                          {fmtPhone(l.lead_phone)}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                          {l.acolhedor && <span>👤 {l.acolhedor}</span>}
                          {(l.city || l.state) && <span>📍 {[l.city, l.state].filter(Boolean).join("/")}</span>}
                          {isSheet && l.sheet_ad && <span>📢 {l.sheet_ad}</span>}
                          {isSheet && l.sheet_status && <span>🏷️ {l.sheet_status}</span>}
                          <span>
                            {dateField === "created_at" ? "Cadastro" : "Atualizado"}:{" "}
                            {fmtDateBR(isSheet ? l.created_at : l[dateField])}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {!isSheet && l.id && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => navigate(`/leads?board=${boardId}&lead=${l.id}`)}
                          >
                            <ExternalLink className="h-3 w-3 mr-1" />
                            Abrir
                          </Button>
                        )}
                        {isSheet && l.raw && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => setDetailLead(l.raw!)}
                          >
                            Detalhes
                          </Button>
                        )}
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

      <Dialog open={!!detailLead} onOpenChange={(o) => !o && setDetailLead(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SheetIcon className="h-4 w-4" />
              {detailLead?.name || "Sem nome"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Lead vindo da planilha do Meta Ads (ainda não importado ao CRM).
            </DialogDescription>
          </DialogHeader>
          {detailLead && (
            <div className="text-sm space-y-2">
              <DetailRow label="Telefone" value={fmtPhone(detailLead.phone_normalized || detailLead.phone_raw)} />
              <DetailRow label="Acolhedor / Aba" value={[detailLead.operator, detailLead.tab].filter(Boolean).join(" — ") || "—"} />
              <DetailRow label="Status na planilha" value={detailLead.lead_status || "—"} />
              <DetailRow label="Campanha" value={detailLead.campaign_name || "—"} />
              <DetailRow label="Anúncio" value={detailLead.ad_name || "—"} />
              <DetailRow label="Formulário" value={detailLead.form_name || "—"} />
              <DetailRow label="Orgânico?" value={detailLead.is_organic ? "Sim" : "Não"} />
              <DetailRow label="Tem WhatsApp?" value={detailLead.has_whatsapp ? "Sim" : "Não"} />
              <DetailRow label="Estado civil" value={detailLead.estado_civil || "—"} />
              <DetailRow label="Filho autista" value={detailLead.filho_autista || "—"} />
              <DetailRow label="Laudo" value={detailLead.laudo || "—"} />
              <DetailRow label="Renda" value={detailLead.renda || "—"} />
              <DetailRow label="Possui advogado" value={detailLead.possui_advogado || "—"} />
              <DetailRow label="1º contato" value={detailLead.first_contact_at ? `${fmtDateBR(detailLead.first_contact_at)} (${detailLead.first_contact_by || "?"})` : "—"} />
              <DetailRow label="Último contato" value={fmtDateBR(detailLead.last_contact_at)} />
              <DetailRow label="Cadastro" value={fmtDateBR(detailLead.created_at)} />
              <DetailRow label="Inviável" value={detailLead.is_unviable ? "Sim" : "Não"} />
            </div>
          )}
          <DialogFooter className="gap-2">
            {detailLead?.phone_normalized && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`https://wa.me/${detailLead.phone_normalized.replace(/\D/g, "")}`, "_blank")}
              >
                <MessageCircle className="h-3.5 w-3.5 mr-2" /> Abrir no WhatsApp
              </Button>
            )}
            <Button size="sm" onClick={() => setDetailLead(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/40 pb-1.5 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs font-medium text-right break-words">{value || "—"}</span>
    </div>
  );
}
