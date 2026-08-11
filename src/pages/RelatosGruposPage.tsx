/**
 * Fila de relatos de caso ouvidos em GRUPO de WhatsApp.
 *
 * O caso novo raramente chega dizendo "quero contratar advogado" — ele aparece
 * como desabafo no grupo do bairro, do sindicato, da obra. A IA
 * (`detect-group-case-reports`, no Railway) lê os grupos MARCADOS e joga aqui
 * o que parece caso. Quem decide é gente: aproveitar vira lead viável no board
 * Trabalhista; descartar tira da fila e ensina a IA a não trazer de volta.
 *
 * Irmã da aba /noticias: mesma triagem, fonte diferente (lá manchete de
 * veículo, aqui gente falando de gente).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { db, ensureExternalSession } from "@/integrations/supabase";
import { useAuth } from "@/hooks/useAuth";
import { cloudFunctions } from "@/lib/functionRouter";
import { openWhatsAppChatSheet } from "@/lib/whatsappChatSheet";
import {
  buildLeadFromReport, groupPhoneFromJid, kindLabel,
  type GroupCaseReport, type GroupWatch, type ReportStatus,
} from "@/lib/groupCaseReports";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Ear, Search, RefreshCw, Loader2, MessageSquare, Check, X,
  MapPin, Building2, CalendarDays, User, Radar,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

const TRABALHISTA_BOARD_ID = "2dcd54b5-502b-413b-b795-5e24a20797d2";

// As tabelas de relato são novas e ainda não estão nos types gerados — acesso
// destipado, mesma saída do ActivityTimerContext.
const dbAny = db as unknown as SupabaseClient;

type Tab = ReportStatus;

interface CachedGroup {
  instance_name: string;
  group_jid: string;
  group_name: string | null;
  participants_count: number | null;
}

const RelatosGruposPage = () => {
  const { profile } = useAuth();
  const [reports, setReports] = useState<GroupCaseReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("novo");
  const [search, setSearch] = useState("");
  const [acting, setActing] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [gruposOpen, setGruposOpen] = useState(false);

  // ============================================================
  // Fila
  // ============================================================
  const fetchReports = useCallback(async () => {
    try {
      await ensureExternalSession();
      const { data, error } = await dbAny
        .from("whatsapp_group_case_reports")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      setReports((data || []) as GroupCaseReport[]);
    } catch (e) {
      console.error("[RelatosGrupos] fetch error", e);
      toast.error("Falha ao carregar os relatos", { description: (e as Error)?.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  // Relato novo entra na tela sem precisar recarregar — o cron roda a cada 10
  // min e quem está de olho na fila não fica olhando uma lista velha.
  useEffect(() => {
    const channel = dbAny
      .channel("group-case-reports")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_group_case_reports" },
        () => { fetchReports(); })
      .subscribe();
    return () => { dbAny.removeChannel(channel); };
  }, [fetchReports]);

  const counts = useMemo(() => ({
    novo: reports.filter((r) => r.status === "novo").length,
    aproveitado: reports.filter((r) => r.status === "aproveitado").length,
    descartado: reports.filter((r) => r.status === "descartado").length,
  }), [reports]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return reports.filter((r) => {
      if (r.status !== tab) return false;
      if (!term) return true;
      return [r.headline, r.victim_name, r.city, r.group_name, r.reporter_name, r.company]
        .some((v) => (v || "").toLowerCase().includes(term));
    });
  }, [reports, tab, search]);

  // ============================================================
  // Ações da triagem
  // ============================================================
  const marcarRevisado = async (report: GroupCaseReport, status: ReportStatus, leadId?: string) => {
    const { error } = await dbAny
      .from("whatsapp_group_case_reports")
      .update({
        status,
        lead_id: leadId || null,
        reviewed_by: profile?.user_id || null,
        reviewed_by_name: profile?.full_name || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", report.id);
    if (error) throw error;
  };

  const aproveitar = async (report: GroupCaseReport) => {
    setActing(report.id);
    try {
      await ensureExternalSession();
      const payload = buildLeadFromReport(report, TRABALHISTA_BOARD_ID);
      const { data, error } = await dbAny
        .from("leads").insert(payload).select("id").single();
      if (error) throw error;

      await marcarRevisado(report, "aproveitado", (data as { id: string }).id);
      toast.success("Caso criado como viável", {
        description: "Está na aba Notícias → Viáveis, pronto para o cadastro completo.",
      });
      await fetchReports();
    } catch (e) {
      console.error("[RelatosGrupos] aproveitar error", e);
      toast.error("Não deu para criar o caso", { description: (e as Error)?.message });
    } finally {
      setActing(null);
    }
  };

  const descartar = async (report: GroupCaseReport) => {
    setActing(report.id);
    try {
      await ensureExternalSession();
      await marcarRevisado(report, "descartado");
      // O detector lê os descartados no dedup: o mesmo relato não volta na
      // próxima varredura só porque outra pessoa recontou no grupo.
      toast.success("Descartado", { description: "A IA não traz este relato de novo." });
      await fetchReports();
    } catch (e) {
      toast.error("Falha ao descartar", { description: (e as Error)?.message });
    } finally {
      setActing(null);
    }
  };

  const varrerAgora = async () => {
    setScanning(true);
    const id = toast.loading("Lendo os grupos marcados...");
    try {
      const { data, error } = await cloudFunctions.invoke<{
        success: boolean; groups_scanned?: number; created?: number; skipped?: string; error?: string;
      }>("detect-group-case-reports", { body: {} });
      if (error || !data?.success) throw new Error(data?.error || error?.message || "erro desconhecido");

      if (data.skipped === "nenhum grupo marcado") {
        toast.warning("Nenhum grupo marcado", {
          id, description: "Marque os grupos que a IA deve ouvir antes de varrer.",
        });
        setGruposOpen(true);
      } else {
        toast.success(
          `${data.created || 0} relato(s) em ${data.groups_scanned || 0} grupo(s)`,
          { id, description: data.created ? undefined : "Nenhuma conversa nova trouxe caso." }
        );
      }
      await fetchReports();
    } catch (e) {
      toast.error("Falha na varredura", { id, description: (e as Error)?.message });
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Ear className="h-5 w-5 text-emerald-500" />
          <h1 className="text-xl font-semibold">Relatos nos grupos</h1>
        </div>
        <p className="text-sm text-muted-foreground flex-1 min-w-[240px]">
          Gente contando acidente, morte ou afastamento nos grupos marcados.
        </p>
        <Button variant="outline" size="sm" onClick={() => setGruposOpen(true)}>
          <Radar className="h-4 w-4 mr-2" /> Grupos ouvidos
        </Button>
        <Button size="sm" onClick={varrerAgora} disabled={scanning}>
          {scanning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Varrer agora
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="novo">Na fila ({counts.novo})</TabsTrigger>
            <TabsTrigger value="aproveitado">Aproveitados ({counts.aproveitado})</TabsTrigger>
            <TabsTrigger value="descartado">Descartados ({counts.descartado})</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Vítima, cidade, grupo, empresa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          {tab === "novo"
            ? "Nada na fila. Quando alguém contar um acidente num grupo marcado, ele aparece aqui."
            : "Nada por aqui."}
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((r) => (
            <ReportCard
              key={r.id}
              report={r}
              busy={acting === r.id}
              onAproveitar={() => aproveitar(r)}
              onDescartar={() => descartar(r)}
            />
          ))}
        </div>
      )}

      <GruposOuvidosDialog
        open={gruposOpen}
        onOpenChange={setGruposOpen}
        userId={profile?.user_id || null}
        userName={profile?.full_name || null}
      />
    </div>
  );
};

// ============================================================
// Card do relato
// ============================================================
function ReportCard({
  report, busy, onAproveitar, onDescartar,
}: {
  report: GroupCaseReport;
  busy: boolean;
  onAproveitar: () => void;
  onDescartar: () => void;
}) {
  const quando = report.message_at || report.created_at;
  const chips: Array<{ icon: JSX.Element; text: string }> = [];
  if (report.victim_name) chips.push({ icon: <User className="h-3 w-3" />, text: report.victim_name });
  if (report.city || report.state) {
    chips.push({ icon: <MapPin className="h-3 w-3" />, text: [report.city, report.state].filter(Boolean).join("/") });
  }
  if (report.company) chips.push({ icon: <Building2 className="h-3 w-3" />, text: report.company });
  if (report.accident_date) {
    chips.push({
      icon: <CalendarDays className="h-3 w-3" />,
      text: format(new Date(`${report.accident_date}T12:00:00`), "dd/MM/yyyy"),
    });
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-start gap-2">
        <Badge variant="secondary">{kindLabel(report.kind)}</Badge>
        {report.damage && <Badge variant="outline">{report.damage}</Badge>}
        {report.victim_is_reporter && <Badge variant="outline">Contou o próprio caso</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(quando), { addSuffix: true, locale: ptBR })}
        </span>
      </div>

      <div>
        <p className="font-medium leading-snug">{report.headline}</p>
        {report.quote && (
          // A frase literal é o que dá confiança pra triar sem abrir o grupo.
          <p className="mt-1 text-sm text-muted-foreground italic border-l-2 pl-2">"{report.quote}"</p>
        )}
        {report.details && <p className="mt-2 text-sm text-muted-foreground">{report.details}</p>}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chips.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted rounded px-2 py-1">
              {c.icon}{c.text}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Grupo: <strong>{report.group_name || report.group_phone}</strong></span>
        {report.reporter_name && <span>· Contou: <strong>{report.reporter_name}</strong></span>}
        {report.status !== "novo" && report.reviewed_by_name && (
          <span>· {report.status === "aproveitado" ? "Aproveitado" : "Descartado"} por {report.reviewed_by_name}</span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline" size="sm"
          onClick={() => openWhatsAppChatSheet({
            phone: report.group_phone,
            instanceName: report.instance_name,
            contactName: report.group_name,
          })}
        >
          <MessageSquare className="h-4 w-4 mr-2" /> Abrir o grupo
        </Button>
        {report.status === "novo" && (
          <>
            <Button size="sm" onClick={onAproveitar} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
              Aproveitar como caso
            </Button>
            <Button variant="ghost" size="sm" onClick={onDescartar} disabled={busy}>
              <X className="h-4 w-4 mr-2" /> Não é caso
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

// ============================================================
// Quais grupos a IA ouve
// ============================================================
function GruposOuvidosDialog({
  open, onOpenChange, userId, userName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string | null;
  userName: string | null;
}) {
  const [cache, setCache] = useState<CachedGroup[]>([]);
  const [watch, setWatch] = useState<GroupWatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await ensureExternalSession();
      const [{ data: groups }, { data: watched }] = await Promise.all([
        dbAny
          .from("whatsapp_groups_cache")
          .select("instance_name, group_jid, group_name, participants_count")
          .order("group_name", { ascending: true })
          .limit(3000),
        dbAny
          .from("whatsapp_group_watch")
          .select("*"),
      ]);
      setCache((groups || []) as CachedGroup[]);
      setWatch((watched || []) as GroupWatch[]);
    } catch (e) {
      toast.error("Falha ao carregar os grupos", { description: (e as Error)?.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  const watchByKey = useMemo(() => {
    const m = new Map<string, GroupWatch>();
    watch.forEach((w) => m.set(`${w.instance_name}|${w.group_phone}`, w));
    return m;
  }, [watch]);

  const lista = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = cache.filter((g) =>
      !term || (g.group_name || "").toLowerCase().includes(term) || g.instance_name.toLowerCase().includes(term)
    );
    // Grupo já ouvido vai pro topo: é a lista que a pessoa veio conferir.
    return rows.sort((a, b) => {
      const aOn = watchByKey.get(`${a.instance_name}|${groupPhoneFromJid(a.group_jid)}`)?.enabled ? 0 : 1;
      const bOn = watchByKey.get(`${b.instance_name}|${groupPhoneFromJid(b.group_jid)}`)?.enabled ? 0 : 1;
      if (aOn !== bOn) return aOn - bOn;
      return (a.group_name || "").localeCompare(b.group_name || "");
    });
  }, [cache, search, watchByKey]);

  const toggle = async (g: CachedGroup, on: boolean) => {
    const groupPhone = groupPhoneFromJid(g.group_jid);
    const key = `${g.instance_name}|${groupPhone}`;
    setBusy(key);
    try {
      await ensureExternalSession();
      const { error } = await dbAny
        .from("whatsapp_group_watch")
        .upsert({
          instance_name: g.instance_name,
          group_jid: g.group_jid,
          group_phone: groupPhone,
          group_name: g.group_name,
          enabled: on,
          // Quem liga o grupo é quem passa a receber o push dele. Sem isso o
          // relato só apareceria pra quem abrisse a tela por acaso.
          notify_user_ids: userId ? [userId] : [],
          created_by: userId,
          created_by_name: userName,
        }, { onConflict: "instance_name,group_phone" });
      if (error) throw error;
      await load();
    } catch (e) {
      toast.error("Falha ao mudar o grupo", { description: (e as Error)?.message });
    } finally {
      setBusy(null);
    }
  };

  const ligados = watch.filter((w) => w.enabled).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Grupos que a IA ouve</DialogTitle>
          <DialogDescription>
            Só os grupos ligados aqui são lidos, a cada 10 minutos. Grupo de caso e grupo
            interno é melhor deixar desligado — enche a fila e gasta IA à toa.
            {ligados > 0 && ` ${ligados} ligado(s).`}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Buscar grupo ou instância..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="max-h-[50vh] overflow-y-auto space-y-1">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
            </div>
          ) : lista.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Nenhum grupo no cache. Sincronize os grupos na tela do WhatsApp primeiro.
            </p>
          ) : (
            lista.map((g) => {
              const groupPhone = groupPhoneFromJid(g.group_jid);
              const key = `${g.instance_name}|${groupPhone}`;
              const on = watchByKey.get(key)?.enabled === true;
              return (
                <div key={key} className="flex items-center gap-3 p-2 rounded hover:bg-muted/50">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{g.group_name || groupPhone}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {g.instance_name}
                      {g.participants_count ? ` · ${g.participants_count} participantes` : ""}
                    </p>
                  </div>
                  {busy === key
                    ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    : <Switch checked={on} onCheckedChange={(v) => toggle(g, v)} />}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default RelatosGruposPage;
