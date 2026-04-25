import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, Search, AlertTriangle, CheckCircle2, Link2, Unlink, Copy } from "lucide-react";
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

const PAGE_SIZE = 100;

export default function GroupAuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [resultFilter, setResultFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

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

      let filtered = (data || []) as unknown as AuditEntry[];
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        filtered = filtered.filter(
          (e) =>
            (e.group_jid || "").toLowerCase().includes(q) ||
            (e.group_name || "").toLowerCase().includes(q) ||
            (e.lead_name || "").toLowerCase().includes(q) ||
            (e.user_name || "").toLowerCase().includes(q) ||
            (e.error_message || "").toLowerCase().includes(q)
        );
      }
      setEntries(filtered);
    } catch (e: any) {
      console.error(e);
      toast.error("Erro ao carregar auditoria: " + (e?.message || "desconhecido"));
    } finally {
      setLoading(false);
    }
  }, [actionFilter, resultFilter, search]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const stats = {
    total: entries.length,
    success: entries.filter((e) => e.result === "success").length,
    errors: entries.filter((e) => e.result === "error").length,
    duplicates: entries.filter((e) => e.result === "duplicate_skipped").length,
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
            Histórico de tentativas de vincular/desvincular grupos a leads. Últimos {PAGE_SIZE} registros.
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
          <CardDescription>Busca em JID, grupo, lead, usuário ou mensagem de erro.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="relative">
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
                  <TableHead>Lead</TableHead>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Origem / Erro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      Nenhum registro encontrado.
                    </TableCell>
                  </TableRow>
                )}
                {entries.map((e) => (
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
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
