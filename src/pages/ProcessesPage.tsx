import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { externalSupabase } from '@/integrations/supabase/external-client';
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Search, FileText, ExternalLink, Calendar, Building2, Briefcase, Trash2, Mail, AlertTriangle, Loader2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import ListPagination from "@/components/processes/ListPagination";
import { format } from "date-fns";
import { toast } from "sonner";

const PAGE_SIZE = 25;

/**
 * Só as colunas que a lista renderiza e a busca varre. `select("*")` traz 69
 * colunas — 5,5 MB por load contra 0,5 MB aqui. O ProcessDetailSheet monta o
 * formulário inteiro a partir do objeto recebido, então a linha completa é
 * buscada no clique (ver `openProcess`), não aqui.
 */
const LIST_COLUMNS =
  "id, title, process_number, process_type, status, situacao, tribunal_sigla, classe, " +
  "polo_ativo, polo_passivo, data_distribuicao, data_ultima_movimentacao, case_id, " +
  "lead_id, valor_causa_formatado, created_at, legal_cases(case_number, title)";
const ProcessDetailSheet = lazy(() => import("@/components/cases/ProcessDetailSheet"));
const InssAdminProcessesTab = lazy(() => import("@/components/processes/InssAdminProcessesTab"));
const ProcessualEmailsTab = lazy(() => import("@/components/processes/ProcessualEmailsTab"));
const StaleProcessesReport = lazy(() => import("@/components/processes/StaleProcessesReport"));

interface Process {
  id: string;
  title: string;
  process_number: string | null;
  process_type: string;
  status: string;
  situacao: string | null;
  tribunal_sigla: string | null;
  classe: string | null;
  polo_ativo: string | null;
  polo_passivo: string | null;
  data_distribuicao: string | null;
  data_ultima_movimentacao: string | null;
  case_id: string | null;
  lead_id: string;
  valor_causa_formatado: string | null;
  created_at: string;
  legal_cases?: { case_number: string; title: string } | null;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function ProcessesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [processes, setProcesses] = useState<Process[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedProcess, setSelectedProcess] = useState<any>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const loadProcesses = useCallback(async () => {
    setLoading(true);
    try {
      // O PostgREST corta em 1.000 linhas por request. Sem paginar, os 545
      // processos mais antigos (de 1.545 ativos) nunca chegavam na tela — e
      // como a busca desta aba é client-side sobre esta lista, eles também
      // eram inacháveis pela barra de pesquisa.
      const PAGE = 1000;
      const HARD_CAP = 20000;
      const all: Process[] = [];
      for (let from = 0; from < HARD_CAP; from += PAGE) {
        const { data, error } = await externalSupabase
          .from("lead_processes")
          .select(LIST_COLUMNS)
          .is('deleted_at', null)
          .order("created_at", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data || []) as unknown as Process[];
        all.push(...rows);
        if (rows.length < PAGE) break;
      }
      setProcesses(all);
    } catch (err) {
      // Antes o erro era descartado e a tela só ficava vazia.
      console.error('[ProcessesPage] loadProcesses failed', err);
      toast.error('Erro ao carregar processos: ' + errMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProcesses();
  }, [loadProcesses]);

  // A lista traz só as colunas de exibição; o sheet precisa da linha inteira
  // (o formulário de edição é montado a partir dela). 1,7 KB, ~150 ms.
  const openingRef = useRef(false);
  const openProcess = useCallback(async (p: Process) => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpeningId(p.id);
    try {
      const { data, error } = await externalSupabase
        .from("lead_processes")
        .select("*")
        .eq('id', p.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        toast.error('Processo não encontrado — pode ter sido excluído.');
        return;
      }
      setSelectedProcess({ ...data, legal_cases: p.legal_cases });
    } catch (err) {
      console.error('[ProcessesPage] openProcess failed', err);
      toast.error('Erro ao abrir processo: ' + errMessage(err));
    } finally {
      openingRef.current = false;
      setOpeningId(null);
    }
  }, []);

  // Auto-open process from URL param
  useEffect(() => {
    const openId = searchParams.get('openProcess');
    if (openId && processes.length > 0 && !selectedProcess) {
      const found = processes.find(p => p.id === openId);
      if (found) openProcess(found);
    }
  }, [searchParams, processes, selectedProcess, openProcess]);

  const filtered = processes.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      p.title?.toLowerCase().includes(q) ||
      p.process_number?.toLowerCase().includes(q) ||
      p.polo_ativo?.toLowerCase().includes(q) ||
      p.polo_passivo?.toLowerCase().includes(q) ||
      p.tribunal_sigla?.toLowerCase().includes(q) ||
      p.classe?.toLowerCase().includes(q)
    );
  });

  // Paginação client-side (25/página)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [search]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const statusColor = (s: string) => {
    switch (s) {
      case "active": return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
      case "archived": return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
      case "finished": return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
      default: return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
    }
  };

  const statusLabel = (s: string) => {
    switch (s) {
      case "active": return "Ativo";
      case "archived": return "Arquivado";
      case "finished": return "Finalizado";
      default: return s;
    }
  };

  const handleDelete = async (e: React.MouseEvent, p: Process) => {
    e.stopPropagation();
    const label = p.process_number || p.title || 'este processo';
    if (!window.confirm(`Excluir "${label}"?\n\nEsta ação remove o processo do caso.`)) return;
    const { error } = await externalSupabase.from('lead_processes').update({ deleted_at: new Date().toISOString() } as any).eq('id', p.id);
    if (error) {
      toast.error('Erro ao excluir: ' + error.message);
      return;
    }
    toast.success('Processo excluído');
    setProcesses(prev => prev.filter(x => x.id !== p.id));
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">Processos</h1>
        <p className="text-sm text-muted-foreground">Judiciais e administrativos (INSS via Gmail)</p>
      </div>

      <Tabs defaultValue="judiciais" className="space-y-4">
        <TabsList>
          <TabsTrigger value="judiciais" className="gap-2">
            <FileText className="h-4 w-4" /> Judiciais
          </TabsTrigger>
          <TabsTrigger value="inss" className="gap-2">
            <Mail className="h-4 w-4" /> INSS Administrativo
          </TabsTrigger>
          <TabsTrigger value="processual" className="gap-2">
            <Mail className="h-4 w-4" /> Processual
          </TabsTrigger>
          <TabsTrigger value="sem-movimento" className="gap-2">
            <AlertTriangle className="h-4 w-4" /> Sem movimento
          </TabsTrigger>
        </TabsList>


        <TabsContent value="judiciais" className="space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por número, título, parte, tribunal..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {loading ? (
            <div className="text-center py-12 text-muted-foreground">Carregando processos...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {search ? "Nenhum processo encontrado para essa busca." : "Nenhum processo cadastrado."}
            </div>
          ) : (
            <div className="grid gap-3">
              {paged.map((p) => (
                <Card
                  key={p.id}
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => openProcess(p)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <FileText className={`h-4 w-4 shrink-0 ${p.case_id ? 'text-primary' : 'text-destructive'}`} />
                          <span className={`font-medium truncate ${!p.case_id ? 'text-destructive' : ''}`}>{p.title}</span>
                          <Badge variant="outline" className={statusColor(p.status)}>
                            {statusLabel(p.status)}
                          </Badge>
                          {p.process_type && (
                            <Badge variant="secondary" className="text-xs">{p.process_type}</Badge>
                          )}
                        </div>

                        {(p as any).legal_cases ? (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Briefcase className="h-3 w-3" />
                            <span>Caso: <strong
                              className="cursor-pointer hover:underline text-primary"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/cases?search=${encodeURIComponent((p as any).legal_cases.case_number.replace(/^[^\w]*/, ''))}`);
                              }}
                            >{(p as any).legal_cases.case_number}</strong> — {(p as any).legal_cases.title}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-xs text-destructive">
                            <Briefcase className="h-3 w-3" />
                            <span>Sem caso vinculado</span>
                          </div>
                        )}

                        {p.process_number && (
                          <p className="text-sm text-muted-foreground font-mono">{p.process_number}</p>
                        )}

                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          {p.tribunal_sigla && (
                            <span className="flex items-center gap-1">
                              <Building2 className="h-3 w-3" /> {p.tribunal_sigla}
                            </span>
                          )}
                          {p.classe && <span>{p.classe}</span>}
                          {p.situacao && <span>• {p.situacao}</span>}
                          {p.valor_causa_formatado && <span>• {p.valor_causa_formatado}</span>}
                        </div>

                        {(p.polo_ativo || p.polo_passivo) && (
                          <div className="text-xs text-muted-foreground">
                            {p.polo_ativo && <span><strong>Ativo:</strong> {p.polo_ativo}</span>}
                            {p.polo_ativo && p.polo_passivo && <span> | </span>}
                            {p.polo_passivo && <span><strong>Passivo:</strong> {p.polo_passivo}</span>}
                          </div>
                        )}

                        <div className="flex gap-3 text-xs text-muted-foreground">
                          {p.data_distribuicao && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" /> Distribuição: {format(new Date(p.data_distribuicao), "dd/MM/yyyy")}
                            </span>
                          )}
                          {p.data_ultima_movimentacao && (
                            <span>Última mov.: {format(new Date(p.data_ultima_movimentacao), "dd/MM/yyyy")}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col items-center gap-1 shrink-0">
                        {openingId === p.id ? (
                          <Loader2 className="h-4 w-4 text-muted-foreground mt-1 animate-spin" />
                        ) : (
                          <ExternalLink className="h-4 w-4 text-muted-foreground mt-1" />
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={(e) => handleDelete(e, p)}
                          title="Excluir processo"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <ListPagination page={page} totalPages={totalPages} onPageChange={setPage} />
            <p className="text-xs text-muted-foreground sm:text-right">
              {filtered.length === 0
                ? "0 processos"
                : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, filtered.length)} de ${filtered.length} processo(s)`}
            </p>
          </div>
        </TabsContent>

        <TabsContent value="inss">
          <Suspense fallback={<div className="text-center py-12 text-muted-foreground">Carregando...</div>}>
            <InssAdminProcessesTab />
          </Suspense>
        </TabsContent>

        <TabsContent value="processual">
          <Suspense fallback={<div className="text-center py-12 text-muted-foreground">Carregando...</div>}>
            <ProcessualEmailsTab />
          </Suspense>
        </TabsContent>

        <TabsContent value="sem-movimento">
          <Suspense fallback={<div className="text-center py-12 text-muted-foreground">Carregando...</div>}>
            <StaleProcessesReport />
          </Suspense>
        </TabsContent>

      </Tabs>


      <Suspense fallback={null}>
        {selectedProcess && (
          <ProcessDetailSheet
            open={!!selectedProcess}
            onOpenChange={(open) => { if (!open) setSelectedProcess(null); }}
            process={selectedProcess}
            onUpdated={(updated) => {
              if (updated) {
                // Merge imediato preservando o join legal_cases
                setProcesses(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated, legal_cases: (p as any).legal_cases } : p));
                setSelectedProcess((prev: any) => prev && prev.id === updated.id ? { ...prev, ...updated } : prev);
              }
              // Re-fetch em paralelo para garantir consistência com joins
              loadProcesses();
            }}
            mode="sheet"
          />
        )}
      </Suspense>
    </div>
  );
}
