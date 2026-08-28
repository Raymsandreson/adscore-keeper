import { useMemo, useState, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  Pagination, PaginationContent, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious, PaginationEllipsis,
} from "@/components/ui/pagination";
import { Search, Plus, RefreshCw, Scale, List, Grid3x3, Filter as FilterIcon, Archive } from "lucide-react";
import { db } from "@/integrations/supabase";
import { useKanbanBoards, isBoardArchived } from "@/hooks/useKanbanBoards";
import { useConfirmDelete } from "@/hooks/useConfirmDelete";
import { WorkflowBuilder } from "@/components/workflow/WorkflowBuilder";
import { PopCarteiraSheet } from "@/components/workflow/PopCarteiraSheet";
import { Wallet } from "lucide-react";
import { FunnelTeamDialog } from "@/components/funnel/FunnelTeamDialog";
import { BoardCard, type BoardType } from "@/components/board/BoardCard";
import type { BoardViewMode } from "@/components/kanban/StageFunnelChart";
import type { LeadProcess } from "@/hooks/useLeadProcesses";
import { toast } from "sonner";

// Ficha completa do processo — lazy para não pesar o bundle da listagem
const ProcessDetailSheet = lazy(() => import("@/components/cases/ProcessDetailSheet"));

const BOARDS_PER_PAGE = 6;

/**
 * Como a PÁGINA lista os quadros. Um controle só, no topo — não é por card.
 * lista = uma linha por quadro · grade = cards resumidos · funil = card
 * completo com gráfico e filtro de data.
 */
const VIEW_MODE_KEY = "boards-list-view-mode";

function readStoredViewMode(): BoardViewMode {
  try {
    const v = localStorage.getItem(VIEW_MODE_KEY);
    if (v === "lista" || v === "grade" || v === "funil") return v;
  } catch { /* localStorage indisponível */ }
  return "lista";
}

/** Quantos quadros cabem por página em cada densidade. */
const PER_PAGE: Record<BoardViewMode, number> = { lista: 20, grade: 12, funil: BOARDS_PER_PAGE };

const LAYOUT: Record<BoardViewMode, string> = {
  lista: "space-y-2",
  grade: "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3",
  funil: "grid grid-cols-1 lg:grid-cols-2 gap-4",
};

const COPY: Record<BoardType, {
  singular: string; plural: string; createLabel: string;
  searchPlaceholder: string; emptySearch: string; emptyNone: string; firstCta: string;
  summaryActive: string;
}> = {
  funnel: {
    singular: "funil", plural: "Funis de Vendas", createLabel: "Criar Funil",
    searchPlaceholder: "Buscar funis...", emptySearch: "Nenhum funil encontrado.",
    emptyNone: "Nenhum funil de vendas configurado.", firstCta: "Criar Primeiro Funil",
    summaryActive: "Funis Ativos",
  },
  workflow: {
    singular: "POP", plural: "POPs", createLabel: "Criar POP",
    searchPlaceholder: "Buscar POPs...", emptySearch: "Nenhum POP encontrado.",
    emptyNone: "Nenhum POP configurado.", firstCta: "Criar Primeiro POP",
    summaryActive: "POPs Ativos",
  },
};

interface BoardsListProps {
  boardType: BoardType;
  /** Renderizado entre a busca e os cards (ex.: atalho de planilha do funil). */
  headerExtra?: React.ReactNode;
}

/**
 * Listagem única de quadros. Funil de vendas (time comercial) e POP (time
 * processual) usam exatamente este componente — o `boardType` só troca rótulo
 * e o filtro de `board_type`. Toda funcionalidade nova entra aqui uma vez e
 * vale para os dois times.
 */
export function BoardsList({ boardType, headerExtra }: BoardsListProps) {
  const navigate = useNavigate();
  const { boards, fetchBoards, deleteBoard, setBoardArchived } = useKanbanBoards();
  const { confirmDelete, ConfirmDeleteDialog } = useConfirmDelete();
  const copy = COPY[boardType];

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [viewMode, setViewModeState] = useState<BoardViewMode>(readStoredViewMode);
  const setViewMode = (v: BoardViewMode) => {
    setViewModeState(v);
    setPage(1);
    try { localStorage.setItem(VIEW_MODE_KEY, v); } catch { /* ignora */ }
  };
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editBoardId, setEditBoardId] = useState<string | null>(null);
  const [teamBoard, setTeamBoard] = useState<{ id: string; name: string } | null>(null);

  // Aba lateral com a relação de processos vinculados ao quadro
  const [processesBoard, setProcessesBoard] = useState<{ id: string; name: string } | null>(null);
  // Carteira do POP: visão geral (marcos × dinheiro × tempo) em Sheet. A
  // conferência mora dentro dela como subseção — `conferencia: true` abre a
  // carteira já com a subseção expandida (atalho "Conferência" do card).
  const [carteiraBoard, setCarteiraBoard] =
    useState<{ id: string; name: string; conferencia?: boolean } | null>(null);
  const [boardProcesses, setBoardProcesses] = useState<LeadProcess[]>([]);
  const [loadingProcesses, setLoadingProcesses] = useState(false);
  const [selectedProcess, setSelectedProcess] = useState<LeadProcess | null>(null);
  // Nome do cliente por lead_id dos processos abertos na aba (query única).
  const [processLeadNames, setProcessLeadNames] = useState<Record<string, string>>({});

  const typedBoards = useMemo(
    () => boards.filter(b => b.board_type === boardType),
    [boards, boardType]
  );

  // Arquivados ficam ocultos por padrão; o botão "Arquivados (N)" revela.
  const [showArchived, setShowArchived] = useState(false);
  const activeBoards = useMemo(() => typedBoards.filter(b => !isBoardArchived(b)), [typedBoards]);
  const archivedBoards = useMemo(() => typedBoards.filter(b => isBoardArchived(b)), [typedBoards]);

  // Com "Mostrar arquivados" ligado, os arquivados entram no fim da lista.
  const filtered = useMemo(
    () => (showArchived ? [...activeBoards, ...archivedBoards] : activeBoards)
      .filter(b => b.name.toLowerCase().includes(search.toLowerCase())),
    [showArchived, activeBoards, archivedBoards, search]
  );

  const perPage = PER_PAGE[viewMode];
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * perPage, currentPage * perPage),
    [filtered, currentPage, perPage]
  );

  // Contagem de leads por quadro, sem filtro de data (os filtros são por card).
  const { data: totalsByBoard } = useQuery({
    queryKey: ["boards-lead-totals", boardType, typedBoards.map(b => b.id)],
    queryFn: async () => {
      if (!typedBoards.length) return {} as Record<string, number>;
      // Conta exata via head+count (evita o cap de 1000 linhas do PostgREST).
      const entries = await Promise.all(
        typedBoards.map(async (b) => {
          const { count, error } = await db
            .from("leads")
            .select("board_id", { count: "exact", head: true })
            .eq("board_id", b.id);
          if (error) throw error;
          return [b.id, count || 0] as const;
        })
      );
      return Object.fromEntries(entries) as Record<string, number>;
    },
    enabled: typedBoards.length > 0,
  });

  // Processos vinculados por quadro — query única (evita N+1), paginada porque
  // o PostgREST corta em 1000 linhas e já passamos disso (1.6k processos): sem
  // paginar, a contagem vinha truncada (612 virava 270).
  const { data: processCounts } = useQuery({
    queryKey: ["boards-process-counts", boardType],
    queryFn: async () => {
      const PAGE = 1000;
      const counts: Record<string, number> = {};
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await db
          .from("lead_processes")
          .select("workflow_id")
          .is("deleted_at", null)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data || []) as Array<{ workflow_id: string | null }>;
        for (const row of rows) {
          if (row.workflow_id) counts[row.workflow_id] = (counts[row.workflow_id] || 0) + 1;
        }
        if (rows.length < PAGE) break;
      }
      return counts;
    },
  });

  // Sumário conta só os ativos — arquivado não é "POP Ativo".
  const totalLeads = useMemo(
    () => activeBoards.reduce((s, b) => s + (totalsByBoard?.[b.id] || 0), 0),
    [activeBoards, totalsByBoard]
  );
  const boardsWithLeads = useMemo(
    () => activeBoards.filter(b => (totalsByBoard?.[b.id] || 0) > 0).length,
    [activeBoards, totalsByBoard]
  );

  const openProcessesSheet = async (board: { id: string; name: string }) => {
    setProcessesBoard(board);
    setLoadingProcesses(true);
    setBoardProcesses([]);
    setProcessLeadNames({});
    try {
      const { data, error } = await db
        .from("lead_processes")
        .select("*")
        .eq("workflow_id", board.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data || []) as unknown as LeadProcess[];
      setBoardProcesses(rows);

      // Nomes dos clientes numa query só (evita N+1).
      const leadIds = [...new Set(rows.map(p => p.lead_id).filter(Boolean))] as string[];
      if (leadIds.length) {
        const { data: leadRows } = await db
          .from("leads")
          .select("id, lead_name")
          .in("id", leadIds);
        const names: Record<string, string> = {};
        for (const l of (leadRows || []) as Array<{ id: string; lead_name: string | null }>) {
          if (l.lead_name) names[l.id] = l.lead_name;
        }
        setProcessLeadNames(names);
      }
    } catch (error) {
      console.error("Erro ao carregar processos do quadro:", error);
      toast.error("Erro ao carregar processos");
    } finally {
      setLoadingProcesses(false);
    }
  };

  // Arquivar não apaga nada: o quadro só some das listagens e seleções.
  const handleToggleArchive = async (board: { id: string; name: string }, archived: boolean) => {
    try {
      await setBoardArchived(board.id, archived);
      toast.success(archived
        ? `"${board.name}" arquivado — não aparece mais nas listas e seleções.`
        : `"${board.name}" desarquivado.`);
    } catch {
      /* updateBoard já mostra o toast de erro */
    }
  };

  const handleDelete = (board: { id: string; name: string }) => {
    confirmDelete(
      `Excluir ${copy.singular}`,
      `Tem certeza que deseja excluir "${board.name}"? Os leads vinculados ficam sem quadro, mas não são apagados.`,
      () => { void deleteBoard(board.id); },
    );
  };

  return (
    <div className="space-y-6">
      {/* Busca + criar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={copy.searchPlaceholder}
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        {/* Como a página lista os quadros — um controle só, vale pra todos. */}
        <div className="flex items-center gap-0.5 rounded-md border bg-background p-0.5">
          {([
            { v: "lista", l: "Lista", Icon: List },
            { v: "grade", l: "Grade", Icon: Grid3x3 },
            { v: "funil", l: "Funil", Icon: FilterIcon },
          ] as { v: BoardViewMode; l: string; Icon: typeof List }[]).map(opt => (
            <Button
              key={opt.v}
              size="sm"
              variant={viewMode === opt.v ? "default" : "ghost"}
              className="h-8 px-2.5 text-xs gap-1.5"
              onClick={() => setViewMode(opt.v)}
              title={`Ver os quadros em ${opt.l.toLowerCase()}`}
              aria-pressed={viewMode === opt.v}
            >
              <opt.Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{opt.l}</span>
            </Button>
          ))}
        </div>
        {archivedBoards.length > 0 && (
          <Button
            variant={showArchived ? "secondary" : "outline"}
            onClick={() => { setShowArchived(v => !v); setPage(1); }}
            title={showArchived
              ? "Ocultar os quadros arquivados"
              : `Mostrar ${archivedBoards.length} arquivado${archivedBoards.length > 1 ? "s" : ""}`}
            aria-pressed={showArchived}
          >
            <Archive className="h-4 w-4 mr-2" />
            Arquivados ({archivedBoards.length})
          </Button>
        )}
        <Button onClick={() => { setEditBoardId(null); setShowBuilder(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          {copy.createLabel}
        </Button>
      </div>

      {headerExtra}

      {/* Sumário */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold text-primary">{activeBoards.length}</div>
            <div className="text-xs text-muted-foreground">{copy.summaryActive}</div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold text-foreground">{totalLeads}</div>
            <div className="text-xs text-muted-foreground">Total de Leads</div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold text-foreground">
              {activeBoards.reduce((sum, b) => sum + (b.stages?.length || 0), 0)}
            </div>
            <div className="text-xs text-muted-foreground">Etapas Total</div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold text-primary">{boardsWithLeads}</div>
            <div className="text-xs text-muted-foreground">Com Leads</div>
          </CardContent>
        </Card>
      </div>

      {/* Lista */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground space-y-3">
          <p>{search ? copy.emptySearch : copy.emptyNone}</p>
          {!search && (
            <Button onClick={() => { setEditBoardId(null); setShowBuilder(true); }}>
              <Plus className="h-4 w-4 mr-2" />
              {copy.firstCta}
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className={LAYOUT[viewMode]}>
            {paged.map(board => (
              <BoardCard
                key={board.id}
                board={board}
                boardType={boardType}
                variant={viewMode}
                totalOverride={boardType === "workflow"
                  ? (processCounts?.[board.id] || 0)
                  : (totalsByBoard?.[board.id] || 0)}
                expanded={expandedId === board.id}
                onToggleExpand={() => setExpandedId(expandedId === board.id ? null : board.id)}
                onOpenKanban={() => navigate(`/leads?board=${board.id}`)}
                onOpenTeam={() => setTeamBoard({ id: board.id, name: board.name })}
                onEdit={() => { setEditBoardId(board.id); setShowBuilder(true); }}
                onOpenProcesses={() => openProcessesSheet({ id: board.id, name: board.name })}
                onOpenCarteira={boardType === "workflow"
                  ? () => setCarteiraBoard({ id: board.id, name: board.name })
                  : undefined}
                onOpenConferencia={boardType === "workflow"
                  ? () => setCarteiraBoard({ id: board.id, name: board.name, conferencia: true })
                  : undefined}
                processCount={processCounts?.[board.id] || 0}
                onDelete={() => handleDelete({ id: board.id, name: board.name })}
                archived={isBoardArchived(board)}
                onToggleArchive={() =>
                  handleToggleArchive({ id: board.id, name: board.name }, !isBoardArchived(board))}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    className={currentPage <= 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let p: number;
                  if (totalPages <= 5) p = i + 1;
                  else if (currentPage <= 3) p = i + 1;
                  else if (currentPage >= totalPages - 2) p = totalPages - 4 + i;
                  else p = currentPage - 2 + i;
                  return (
                    <PaginationItem key={p}>
                      <PaginationLink
                        isActive={p === currentPage}
                        onClick={() => setPage(p)}
                        className="cursor-pointer"
                      >
                        {p}
                      </PaginationLink>
                    </PaginationItem>
                  );
                })}
                {totalPages > 5 && currentPage < totalPages - 2 && (
                  <>
                    <PaginationItem><PaginationEllipsis /></PaginationItem>
                    <PaginationItem>
                      <PaginationLink onClick={() => setPage(totalPages)} className="cursor-pointer">
                        {totalPages}
                      </PaginationLink>
                    </PaginationItem>
                  </>
                )}
                <PaginationItem>
                  <PaginationNext
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    className={currentPage >= totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
              </PaginationContent>
              <div className="flex justify-center mt-2">
                <span className="text-xs text-muted-foreground">{perPage} / página</span>
              </div>
            </Pagination>
          )}
        </>
      )}

      <WorkflowBuilder
        open={showBuilder}
        onOpenChange={setShowBuilder}
        onWorkflowSaved={() => fetchBoards()}
        initialEditBoardId={editBoardId}
        initialCreateNew={!editBoardId}
        boardType={boardType}
      />

      {teamBoard && (
        <FunnelTeamDialog
          open={!!teamBoard}
          onOpenChange={(o) => !o && setTeamBoard(null)}
          boardId={teamBoard.id}
          boardName={teamBoard.name}
          boardType={boardType}
        />
      )}

      <PopCarteiraSheet
        boardId={carteiraBoard?.id || null}
        boardName={carteiraBoard?.name || ''}
        open={!!carteiraBoard}
        onOpenChange={(o) => { if (!o) setCarteiraBoard(null); }}
        conferenciaInicial={!!carteiraBoard?.conferencia}
      />


      {/* Aba lateral: processos vinculados ao quadro */}
      <Sheet
        open={!!processesBoard}
        onOpenChange={(open) => { if (!open) { setProcessesBoard(null); setBoardProcesses([]); } }}
      >
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Scale className="h-4 w-4" />
              Processos do {copy.singular}
            </SheetTitle>
            <SheetDescription className="truncate">{processesBoard?.name}</SheetDescription>
          </SheetHeader>

          {/* Atalho para a visão geral da carteira — a lista abaixo é o detalhe
              processo a processo; a carteira é o agregado (marcos × dinheiro ×
              tempo). Abre por cima, sem perder esta aba. */}
          {boardType === "workflow" && processesBoard && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full"
              onClick={() => setCarteiraBoard(processesBoard)}
            >
              <Wallet className="h-3.5 w-3.5 mr-1.5" />
              Visão geral da carteira
            </Button>
          )}

          <div className="flex-1 overflow-y-auto mt-4">
            {loadingProcesses ? (
              <div className="flex items-center justify-center py-16">
                <RefreshCw className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : boardProcesses.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-16">
                Nenhum processo vinculado a este {copy.singular}.
              </p>
            ) : (
              <div className="space-y-2">
                {boardProcesses.map(p => {
                  const clientName = p.lead_id ? processLeadNames[p.lead_id] : null;
                  const statusLabel =
                    p.status === "concluido" ? "Concluído" :
                    p.status === "arquivado" ? "Arquivado" : "Em andamento";
                  const statusVariant =
                    p.status === "concluido" ? "default" :
                    p.status === "arquivado" ? "secondary" : "outline";
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedProcess(p)}
                      className="w-full text-left border rounded-lg p-3 bg-card hover:bg-accent hover:shadow-sm transition-colors"
                      title="Abrir ficha completa do processo"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium leading-snug">{p.title || "Processo sem título"}</p>
                        <Badge variant={statusVariant as "default" | "secondary" | "outline"} className="shrink-0 text-[10px]">
                          {statusLabel}
                        </Badge>
                      </div>
                      {p.process_number && (
                        <p className="text-xs text-muted-foreground mt-1 font-mono">{p.process_number}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <Badge variant="secondary" className="text-[10px] capitalize">{p.process_type}</Badge>
                        {clientName && (
                          <span className="text-[11px] text-muted-foreground">Cliente: {clientName}</span>
                        )}
                      </div>
                      {p.started_at && (
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Início: {new Date(p.started_at).toLocaleDateString("pt-BR")}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Ficha completa do processo */}
      <Suspense fallback={null}>
        {selectedProcess && (
          <ProcessDetailSheet
            open={!!selectedProcess}
            onOpenChange={(open) => { if (!open) setSelectedProcess(null); }}
            process={selectedProcess}
            onUpdated={(updated) => {
              if (updated) {
                setBoardProcesses(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } as LeadProcess : p));
                setSelectedProcess(prev => prev && prev.id === updated.id ? { ...prev, ...updated } as LeadProcess : prev);
              }
            }}
            mode="sheet"
          />
        )}
      </Suspense>

      <ConfirmDeleteDialog />
    </div>
  );
}
