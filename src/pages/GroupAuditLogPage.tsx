import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { externalSupabase } from "@/integrations/supabase/external-client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, Search, AlertTriangle, CheckCircle2, Link2, Unlink, Copy, CalendarDays, UserCircle2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface AuditEntry {
  id: string;
  action: "link" | "unlink";
  group_jid: string | null;
  group_name: string | null;
  lead_id: string | null;
  lead_name: string | null;
  user_id: string | null;
  user_name: string | null;
  result: "success" | "error" | "duplicate_skipped";
  error_message: string | null;
  source: string | null;
  created_at: string;
}

interface GroupMeta {
  group_created_at: string | null;
  owner_jid: string | null;
  owner_label: string | null; // nome ou telefone do criador
}

const PAGE_SIZE = 100;

function jidToPhone(jid: string | null): string | null {
  if (!jid) return null;
  const raw = jid.split("@")[0] || "";
  const digits = raw.replace(/\D/g, "");
  return digits || null;
}

function formatPhoneBR(digits: string): string {
  // Heurística simples para BR (+55)
  if (digits.startsWith("55") && digits.length >= 12) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    if (rest.length === 9) return `+55 (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    if (rest.length === 8) return `+55 (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  }
  return `+${digits}`;
}

export default function GroupAuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [resultFilter, setResultFilter] = useState<string>("all");
  const [creatorFilter, setCreatorFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [groupMeta, setGroupMeta] = useState<Record<string, GroupMeta>>({});

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("lead_group_audit_log" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);

      if (actionFilter !== "all") query = query.eq("action", actionFilter);
      if (resultFilter !== "all") query = query.eq("result", resultFilter);

      const { data, error } = await query;
      if (error) throw error;

      const list = (data || []) as unknown as AuditEntry[];
      setEntries(list);

      // Enriquecer com dados de criação do grupo (Externo)
      const jids = Array.from(
        new Set(list.map((e) => e.group_jid).filter((j): j is string => !!j))
      );
      if (jids.length > 0) {
        const { data: snaps } = await externalSupabase
          .from("whatsapp_groups_uazapi_snapshot" as any)
          .select("jid, group_created_at, owner_jid")
          .in("jid", jids);

        const meta: Record<string, GroupMeta> = {};
        const ownerPhones = new Set<string>();
        (snaps || []).forEach((s: any) => {
          const phone = jidToPhone(s.owner_jid);
          if (phone) ownerPhones.add(phone);
          meta[s.jid] = {
            group_created_at: s.group_created_at,
            owner_jid: s.owner_jid,
            owner_label: phone ? formatPhoneBR(phone) : null,
          };
        });

        // Tentar resolver nome do criador via contacts (match por sufixo do telefone)
        if (ownerPhones.size > 0) {
          const suffixes = Array.from(ownerPhones)
            .map((p) => p.slice(-8))
            .filter((s) => s.length === 8);
          if (suffixes.length > 0) {
            const orQuery = suffixes.map((s) => `phone.ilike.%${s}%`).join(",");
            const { data: contacts } = await supabase
              .from("contacts")
              .select("phone, full_name")
              .or(orQuery)
              .is("deleted_at", null)
              .limit(500);

            const nameBySuffix = new Map<string, string>();
            (contacts || []).forEach((c: any) => {
              const cleaned = (c.phone || "").replace(/\D/g, "");
              if (cleaned.length >= 8 && c.full_name) {
                nameBySuffix.set(cleaned.slice(-8), c.full_name);
              }
            });

            Object.values(meta).forEach((m) => {
              const phone = jidToPhone(m.owner_jid);
              if (phone) {
                const name = nameBySuffix.get(phone.slice(-8));
                if (name) m.owner_label = `${name} (${formatPhoneBR(phone)})`;
              }
            });
          }
        }
        setGroupMeta(meta);
      } else {
        setGroupMeta({});
      }
    } catch (e: any) {
      console.error(e);
      toast.error("Erro ao carregar auditoria: " + (e?.message || "desconhecido"));
    } finally {
      setLoading(false);
    }
  }, [actionFilter, resultFilter]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Lista única de criadores para o filtro
  const creatorOptions = useMemo(() => {
    const seen = new Map<string, string>();
    entries.forEach((e) => {
      if (!e.group_jid) return;
      const m = groupMeta[e.group_jid];
      if (m?.owner_jid && m.owner_label) {
        seen.set(m.owner_jid, m.owner_label);
      }
    });
    return Array.from(seen.entries())
      .map(([jid, label]) => ({ jid, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [entries, groupMeta]);

  // Aplicar filtros locais (busca + criador)
  const visibleEntries = useMemo(() => {
    let out = entries;
    if (creatorFilter !== "all") {
      out = out.filter((e) => e.group_jid && groupMeta[e.group_jid]?.owner_jid === creatorFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((e) => {
        const m = e.group_jid ? groupMeta[e.group_jid] : undefined;
        return (
          (e.group_jid || "").toLowerCase().includes(q) ||
          (e.group_name || "").toLowerCase().includes(q) ||
          (e.lead_name || "").toLowerCase().includes(q) ||
          (e.user_name || "").toLowerCase().includes(q) ||
          (e.error_message || "").toLowerCase().includes(q) ||
          (m?.owner_label || "").toLowerCase().includes(q) ||
          (m?.owner_jid || "").toLowerCase().includes(q)
        );
      });
    }
    return out;
  }, [entries, groupMeta, creatorFilter, search]);

  const stats = {
    total: visibleEntries.length,
    success: visibleEntries.filter((e) => e.result === "success").length,
    errors: visibleEntries.filter((e) => e.result === "error").length,
    duplicates: visibleEntries.filter((e) => e.result === "duplicate_skipped").length,
  };

  const copyJid = (jid: string | null) => {
    if (!jid) return;
    navigator.clipboard.writeText(jid);
    toast.success("JID copiado");
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4 max-w-7xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Auditoria — Vínculos de Grupos WhatsApp</h1>
          <p className="text-sm text-muted-foreground">
            Histórico de tentativas de vincular/desvincular grupos a leads, com data de criação do grupo e quem criou. Últimos {PAGE_SIZE} registros.
          </p>
        </div>
        <Button onClick={fetchEntries} disabled={loading} variant="outline" size="sm">
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Sucesso</div>
            <div className="text-2xl font-bold text-emerald-600">{stats.success}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Erros</div>
            <div className="text-2xl font-bold text-destructive">{stats.errors}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Duplicações ignoradas</div>
            <div className="text-2xl font-bold text-amber-600">{stats.duplicates}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtros</CardTitle>
          <CardDescription>Busca em JID, grupo, lead, usuário, criador ou mensagem de erro.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div className="relative md:col-span-2">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Ação" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as ações</SelectItem>
              <SelectItem value="link">Apenas vínculos</SelectItem>
              <SelectItem value="unlink">Apenas desvínculos</SelectItem>
            </SelectContent>
          </Select>
          <Select value={resultFilter} onValueChange={setResultFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Resultado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os resultados</SelectItem>
              <SelectItem value="success">Sucesso</SelectItem>
              <SelectItem value="error">Erro</SelectItem>
              <SelectItem value="duplicate_skipped">Duplicação ignorada</SelectItem>
            </SelectContent>
          </Select>
          <Select value={creatorFilter} onValueChange={setCreatorFilter}>
            <SelectTrigger className="md:col-span-2">
              <SelectValue placeholder="Filtrar por quem criou o grupo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os criadores</SelectItem>
              {creatorOptions.map((c) => (
                <SelectItem key={c.jid} value={c.jid}>
                  {c.label}
                </SelectItem>
              ))}
              {creatorOptions.length === 0 && (
                <SelectItem value="__none__" disabled>
                  Sem dados de criador
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[60vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Quando</TableHead>
                  <TableHead className="w-[100px]">Ação</TableHead>
                  <TableHead className="w-[120px]">Resultado</TableHead>
                  <TableHead>Grupo / JID</TableHead>
                  <TableHead className="w-[170px]">Criação do grupo</TableHead>
                  <TableHead className="w-[200px]">Quem criou o grupo</TableHead>
                  <TableHead>Lead</TableHead>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Origem / Erro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleEntries.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                      Nenhum registro encontrado.
                    </TableCell>
                  </TableRow>
                )}
                {visibleEntries.map((e) => {
                  const meta = e.group_jid ? groupMeta[e.group_jid] : undefined;
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {format(new Date(e.created_at), "dd/MM HH:mm:ss", { locale: ptBR })}
                      </TableCell>
                      <TableCell>
                        {e.action === "link" ? (
                          <Badge variant="outline" className="gap-1">
                            <Link2 className="h-3 w-3" /> Vincular
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1">
                            <Unlink className="h-3 w-3" /> Desvincular
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {e.result === "success" && (
                          <Badge className="bg-emerald-600 hover:bg-emerald-700 gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Sucesso
                          </Badge>
                        )}
                        {e.result === "error" && (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="h-3 w-3" /> Erro
                          </Badge>
                        )}
                        {e.result === "duplicate_skipped" && (
                          <Badge className="bg-amber-500 hover:bg-amber-600 gap-1">Duplicado</Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[260px]">
                        <div className="text-sm font-medium truncate">{e.group_name || "—"}</div>
                        {e.group_jid && (
                          <button
                            onClick={() => copyJid(e.group_jid)}
                            className="text-xs text-muted-foreground font-mono truncate flex items-center gap-1 hover:text-foreground"
                            title="Copiar JID"
                          >
                            <Copy className="h-3 w-3 shrink-0" />
                            <span className="truncate">{e.group_jid}</span>
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {meta?.group_created_at ? (
                          <div className="flex items-center gap-1">
                            <CalendarDays className="h-3 w-3 text-muted-foreground" />
                            {format(new Date(meta.group_created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        {meta?.owner_label ? (
                          <div className="flex items-center gap-1 text-sm truncate" title={meta.owner_jid || ""}>
                            <UserCircle2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="truncate">{meta.owner_label}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[180px]">
                        <div className="text-sm truncate">{e.lead_name || "—"}</div>
                        {e.lead_id && (
                          <div className="text-xs text-muted-foreground font-mono truncate">{e.lead_id.slice(0, 8)}…</div>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[160px]">
                        <div className="text-sm truncate">{e.user_name || "—"}</div>
                      </TableCell>
                      <TableCell className="max-w-[300px]">
                        <div className="text-xs text-muted-foreground truncate">{e.source || "—"}</div>
                        {e.error_message && (
                          <div className="text-xs text-destructive truncate" title={e.error_message}>
                            {e.error_message}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
