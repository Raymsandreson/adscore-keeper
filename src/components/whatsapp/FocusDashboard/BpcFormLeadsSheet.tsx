import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Phone, MessageCircle, Search, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { BpcFormLead, BpcMetrics } from "@/hooks/useBpcFormLeads";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  metrics: BpcMetrics;
  leads: BpcFormLead[];
  loading: boolean;
  defaultTab?: "all" | "to_call" | "on_wa" | "unviable";
  onOpenChat?: (phone: string) => void;
  onRefresh?: () => void;
}

function fmtPhone(p: string): string {
  if (!p) return "—";
  if (p.length === 13 && p.startsWith("55")) {
    return `(${p.slice(2, 4)}) ${p.slice(4, 9)}-${p.slice(9)}`;
  }
  return p;
}

// Força exibição em horário de Brasília (planilha grava em -05:00 / México).
function fmtBR(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function BpcFormLeadsSheet({
  open,
  onOpenChange,
  metrics,
  leads,
  loading,
  defaultTab = "all",
  onOpenChat,
  onRefresh,
}: Props) {
  const [tab, setTab] = useState<"all" | "to_call" | "on_wa" | "unviable">(defaultTab);
  const [q, setQ] = useState("");
  const [operatorFilter, setOperatorFilter] = useState<string>("all");

  const operators = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of leads) {
      const key = (l.operator || "—").trim() || "—";
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([operator, count]) => ({ operator, count }));
  }, [leads]);

  const filtered = useMemo(() => {
    let list = leads;
    if (operatorFilter !== "all") {
      list = list.filter((l) => ((l.operator || "—").trim() || "—") === operatorFilter);
    }
    if (tab === "to_call") list = list.filter((l) => !l.has_whatsapp && !l.is_unviable);
    else if (tab === "on_wa") list = list.filter((l) => l.has_whatsapp);
    else if (tab === "unviable") list = list.filter((l) => l.is_unviable);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter(
        (l) =>
          l.name.toLowerCase().includes(s) ||
          l.phone_normalized.includes(s) ||
          l.operator.toLowerCase().includes(s),
      );
    }
    return list;
  }, [leads, tab, q, operatorFilter]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col">
        <SheetHeader className="px-4 pt-4 pb-2 border-b">
          <SheetTitle className="flex items-center justify-between gap-2">
            <span>Leads do formulário Meta · BPC-LOAS</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onRefresh}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </SheetTitle>
        </SheetHeader>

        <div className="px-4 pt-3 pb-2 border-b">
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
            <TabsList className="grid grid-cols-4 w-full h-9">
              <TabsTrigger value="all" className="text-[11px]">
                Todos · {metrics.total}
              </TabsTrigger>
              <TabsTrigger value="to_call" className="text-[11px] data-[state=active]:text-red-600">
                📞 Ligar · {metrics.toCallNow}
              </TabsTrigger>
              <TabsTrigger value="on_wa" className="text-[11px]">
                💬 No WA · {metrics.alreadyOnWhatsApp}
              </TabsTrigger>
              <TabsTrigger value="unviable" className="text-[11px]">
                ⚠️ Inviável · {metrics.unviable}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex gap-2 mt-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="h-8 pl-7 text-xs"
                placeholder="Buscar por nome, telefone ou operador…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <Select value={operatorFilter} onValueChange={setOperatorFilter}>
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue placeholder="Operador" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos operadores · {leads.length}</SelectItem>
                {operators.map((o) => (
                  <SelectItem key={o.operator} value={o.operator} className="text-xs">
                    {o.operator} · {o.count}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1.5">
          {filtered.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-8">
              {loading ? "Carregando planilha…" : "Nenhum lead nesse filtro."}
            </div>
          )}
          {filtered.map((l) => (
            <div
              key={l.form_lead_id}
              className="border rounded-md p-2.5 text-xs hover:bg-muted/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate flex items-center gap-1.5">
                    {l.name || "Sem nome"}
                    {!l.has_whatsapp && !l.is_unviable && (
                      <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4">
                        LIGAR
                      </Badge>
                    )}
                    {l.has_whatsapp && (
                      <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 bg-emerald-100 text-emerald-700">
                        WA
                      </Badge>
                    )}
                    {l.is_unviable && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 text-amber-600 border-amber-300">
                        INVIÁVEL
                      </Badge>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {fmtPhone(l.phone_normalized)} · {l.operator}
                  </div>
                  {/* Quem iniciou a conversa */}
                  {l.has_whatsapp && (
                    <div className="text-[10px] mt-1">
                      {l.first_contact_by === "client" && (
                        <span className="text-emerald-700">🟢 Cliente iniciou{l.first_contact_at ? ` · ${fmtBR(l.first_contact_at)}` : ""}</span>
                      )}
                      {l.first_contact_by === "operator" && (
                        <span className="text-blue-700">🔵 Operador iniciou{l.first_contact_at ? ` · ${fmtBR(l.first_contact_at)}` : ""}</span>
                      )}
                    </div>
                  )}
                  {!l.has_whatsapp && !l.is_unviable && (
                    <div className="text-[10px] mt-1 text-red-600">
                      🔴 Ninguém respondeu ainda
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
                    {l.renda && <span>💰 {l.renda}</span>}
                    {l.possui_advogado && <span>⚖️ Adv: {l.possui_advogado}</span>}
                    {l.laudo && <span>📄 Laudo: {l.laudo}</span>}
                    {l.filho_autista && <span>👶 {l.filho_autista}</span>}
                    {l.estado_civil && <span>💍 {l.estado_civil}</span>}
                    {l.campaign_name && <span className="truncate" title={l.campaign_name}>📣 {l.campaign_name}</span>}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {l.created_at && `Form: ${fmtBR(l.created_at)} (BR)`}
                  </div>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 w-7 p-0"
                    title="Ligar"
                    onClick={() => {
                      window.location.href = `tel:+${l.phone_normalized}`;
                    }}
                  >
                    <Phone className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 w-7 p-0"
                    title={l.has_whatsapp ? "Abrir conversa" : "Abrir WhatsApp (novo)"}
                    onClick={() => {
                      if (l.has_whatsapp && onOpenChat) {
                        onOpenChat(l.phone_normalized);
                      } else {
                        // Lead que só preencheu o form — ainda não existe conversa.
                        // Abre o wa.me direto pra iniciar.
                        window.open(`https://wa.me/${l.phone_normalized}`, "_blank");
                      }
                    }}
                  >
                    <MessageCircle className="h-3 w-3" />
                  </Button>

                </div>
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
