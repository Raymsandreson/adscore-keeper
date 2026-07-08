import { useMemo, useState } from "react";
import { Sheet as SheetIcon, Phone, MessageCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useBpcFormLeads, type BpcFormLead } from "@/hooks/useBpcFormLeads";
import { getFunnelSheetConfig } from "@/lib/funnelSheetConfig";
import type { KanbanBoard } from "@/hooks/useKanbanBoards";

function last8(phone?: string | null) {
  return (phone || "").replace(/\D/g, "").slice(-8);
}

function fmtPhone(p?: string | null) {
  if (!p) return "—";
  const d = p.replace(/\D/g, "");
  if (d.length >= 17) return "Grupo WhatsApp";
  if (d.length === 13 && d.startsWith("55"))
    return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return p;
}

function fmtDateBR(iso?: string | null) {
  if (!iso) return "—";
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

/**
 * Retorna as leads da planilha (Meta Ads) que ainda não existem no board
 * (dedup por últimos 8 dígitos do telefone), e o id da primeira etapa do board.
 */
export function useVirtualSheetLeadsForBoard(
  board: KanbanBoard | null | undefined,
  existingLeads: Array<{ lead_phone?: string | null }>,
) {
  const sheetCfg = useMemo(
    () => getFunnelSheetConfig(board?.name),
    [board?.name],
  );
  const range = useMemo(
    () => ({ from: new Date("2020-01-01T00:00:00Z"), to: new Date() }),
    [],
  );

  const { leads, loading } = useBpcFormLeads({
    from: range.from,
    to: range.to,
    enabled: !!sheetCfg,
    source: "unificada",
    spreadsheetId: sheetCfg?.spreadsheetId,
  });

  const virtualCards = useMemo(() => {
    if (!sheetCfg) return [] as BpcFormLead[];
    const existingKeys = new Set(
      existingLeads.map((l) => last8(l.lead_phone)).filter((k) => k.length === 8),
    );
    return leads.filter((s) => {
      const k = last8(s.phone_normalized || s.phone_raw);
      return k.length === 8 && !existingKeys.has(k);
    });
  }, [sheetCfg, leads, existingLeads]);

  const firstStageId = board?.stages?.[0]?.id;

  return { virtualCards, firstStageId, loading, sheetLabel: sheetCfg?.label ?? null };
}

interface SheetLeadCardProps {
  lead: BpcFormLead;
  onOpen: (lead: BpcFormLead) => void;
}

export function SheetVirtualLeadCard({ lead, onOpen }: SheetLeadCardProps) {
  const digits = (lead.phone_normalized || lead.phone_raw || "").replace(/\D/g, "");
  return (
    <Card
      className="cursor-pointer transition-all hover:shadow-md border-dashed border-emerald-300/60 dark:border-emerald-800/60 bg-emerald-50/40 dark:bg-emerald-950/10"
      onClick={() => onOpen(lead)}
    >
      <CardContent className="p-2.5 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-medium text-sm truncate">
                {lead.name || "Sem nome"}
              </span>
              <Badge
                variant="secondary"
                className="text-[9px] gap-1 shrink-0 h-4 px-1"
              >
                <SheetIcon className="h-2.5 w-2.5" />
                planilha
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <Phone className="h-3 w-3" />
              {fmtPhone(lead.phone_normalized || lead.phone_raw)}
            </div>
          </div>
          {digits && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                window.open(`https://wa.me/${digits}`, "_blank");
              }}
              title="Abrir no WhatsApp"
            >
              <MessageCircle className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
            </Button>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground flex flex-wrap gap-x-2 gap-y-0.5">
          {lead.operator && <span>👤 {lead.operator}</span>}
          {lead.ad_name && (
            <span className="truncate max-w-[160px]">📢 {lead.ad_name}</span>
          )}
          {lead.lead_status && <span>🏷️ {lead.lead_status}</span>}
        </div>
        <div className="text-[10px] text-muted-foreground">
          Cadastro: {fmtDateBR(lead.created_at)}
        </div>
      </CardContent>
    </Card>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/40 pb-1.5 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs font-medium text-right break-words">
        {value || "—"}
      </span>
    </div>
  );
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

interface DialogProps {
  lead: BpcFormLead | null;
  onClose: () => void;
}

export function SheetLeadDetailDialog({ lead, onClose }: DialogProps) {
  return (
    <Dialog open={!!lead} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SheetIcon className="h-4 w-4" />
            {lead?.name || "Sem nome"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Lead vindo da planilha do Meta Ads (ainda não importado ao CRM).
          </DialogDescription>
        </DialogHeader>
        {lead && (
          <div className="text-sm space-y-2">
            <DetailRow
              label="Telefone"
              value={fmtPhone(lead.phone_normalized || lead.phone_raw)}
            />
            <DetailRow
              label="Acolhedor / Aba"
              value={
                [lead.operator, lead.tab].filter(Boolean).join(" — ") || "—"
              }
            />
            <DetailRow label="Status na planilha" value={lead.lead_status || "—"} />
            <DetailRow label="Campanha" value={lead.campaign_name || "—"} />
            <DetailRow label="Anúncio" value={lead.ad_name || "—"} />
            <DetailRow label="Formulário" value={lead.form_name || "—"} />
            <DetailRow label="Orgânico?" value={lead.is_organic ? "Sim" : "Não"} />
            <DetailRow
              label="Tem WhatsApp?"
              value={lead.has_whatsapp ? "Sim" : "Não"}
            />
            <DetailRow label="Estado civil" value={lead.estado_civil || "—"} />
            <DetailRow label="Filho autista" value={lead.filho_autista || "—"} />
            <DetailRow label="Laudo" value={lead.laudo || "—"} />
            <DetailRow label="Renda" value={lead.renda || "—"} />
            <DetailRow
              label="Possui advogado"
              value={lead.possui_advogado || "—"}
            />
            <DetailRow
              label="1º contato"
              value={
                lead.first_contact_at
                  ? `${fmtDateBR(lead.first_contact_at)} (${
                      lead.first_contact_by || "?"
                    })`
                  : "—"
              }
            />
            <DetailRow
              label="Último contato"
              value={fmtDateBR(lead.last_contact_at)}
            />
            <DetailRow label="Cadastro" value={fmtDateBR(lead.created_at)} />
            <DetailRow label="Inviável" value={lead.is_unviable ? "Sim" : "Não"} />
          </div>
        )}
        <DialogFooter className="gap-2">
          {lead?.phone_normalized && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                window.open(
                  `https://wa.me/${lead.phone_normalized.replace(/\D/g, "")}`,
                  "_blank",
                )
              }
            >
              <MessageCircle className="h-3.5 w-3.5 mr-2" /> Abrir no WhatsApp
            </Button>
          )}
          <Button size="sm" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Renderiza a lista de cards virtuais (planilha) para uma etapa específica.
 * Deve ser usado dentro da coluna do kanban, antes do map dos leads reais.
 */
export function SheetVirtualLeadsSection({
  cards,
  sheetLabel,
}: {
  cards: BpcFormLead[];
  sheetLabel: string | null;
}) {
  const [detail, setDetail] = useState<BpcFormLead | null>(null);
  if (!cards.length) return null;
  return (
    <>
      <div className="flex items-center gap-1.5 px-1 pb-1 pt-1">
        <SheetIcon className="h-3 w-3 text-emerald-600" />
        <span className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400 font-medium">
          Da planilha{sheetLabel ? ` (${sheetLabel})` : ""}
        </span>
        <Badge variant="outline" className="ml-auto text-[10px] h-4 px-1">
          {cards.length}
        </Badge>
      </div>
      <div className="space-y-2 pb-2 mb-1 border-b border-dashed border-border/50">
        {cards.map((c) => (
          <SheetVirtualLeadCard
            key={c.form_lead_id || `${c.phone_normalized}-${c.created_at}`}
            lead={c}
            onOpen={setDetail}
          />
        ))}
      </div>
      <SheetLeadDetailDialog lead={detail} onClose={() => setDetail(null)} />
    </>
  );
}
