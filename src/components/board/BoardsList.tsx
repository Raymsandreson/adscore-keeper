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
import { parseCnj } from "@/lib/cnj";
import { filtrarProcessos } from "@/lib/buscaProcesso";
import {
  ramoDoProcesso, ramoPrometidoPeloNome, ufDoProcesso,
  RAMO_BADGE, type RamoDoProcesso,
} from "@/lib/ramoDoProcesso";
import { resumirProcessos, type ResumoDeProcessos } from "@/lib/resumoDeProcessos";
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
  // Carteira do POP: visão geral (marcos × dinheiro × tempo) em Sheet.
  const [carteiraBoard, setCarteiraBoard] = useState<{ id: string; name: string } | null>(null);
  const [boardProcesses, setBoardProcesses] = useState<LeadProcess[]>([]);
  const [loadingProcesses, setLoadingProcesses] = useState(false);
  const [selectedProcess, setSelectedProcess] = useState<LeadProcess | null>(null);
  // Nome do cliente por lead_id dos processos abertos na aba (query única).
  const [processLeadNames, setProcessLeadNames] = useState<Record<string, string>>({});
  // Busca da aba: número, nome da parte ou qualquer texto da ficha.
  const [processSearch, setProcessSearch] = useState("");
  // null = todos os ramos; do contrário, só o ramo escolhido.
  const [ramoFiltro, setRamoFiltro] = useState<RamoDoProcesso | null>(null);

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
  //
  // Traz o NÚMERO junto porque contar linha é contar ficha, e ficha não é
  // processo: o mesmo CNJ tem ficha repetida (48 CNJs na base) e ficha sem
  // número não identifica processo nenhum. `resumirProcessos` devolve os dois
  // números e a abertura por ramo — é o que faz o card parar de anunciar 1289
  // num POP que tem 786 trabalhistas.
  const { data: resumoPorQuadro } = useQuery({
    queryKey: ["boards-process-summary", boardType],
    queryFn: async () => {
      const PAGE = 1000;
      const fichasPorQuadro: Record<string, Array<{ process_number: string | null }>> = {};
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await db
          .from("lead_processes")
          .select("workflow_id, process_number")
          .is("deleted_at", null)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data || []) as Array<{ workflow_id: string | null; process_number: string | null }>;
        for (const row of rows) {
          if (!row.workflow_id) continue;
          (fichasPorQuadro[row.workflow_id] ||= []).push({ process_number: row.process_number });
        }
        if (rows.length < PAGE) break;
      }
      return Object.fromEntries(
        Object.entries(fichasPorQuadro).map(([id, fichas]) => [id, resumirProcessos(fichas)]),
      ) as Record<string, ResumoDeProcessos>;
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

  // A abertura por ramo do que está NA ABA — recalculada do que foi carregado,
  // não da contagem global, para os dois números não poderem divergir.
  const resumoDaAba = useMemo(() => resumirProcessos(boardProcesses), [boardProcesses]);

  // O ramo que o nome do quadro promete. Serve para a aba apontar o que entrou
  // fora do lugar sem chamar de erro o que não dá para afirmar.
  const ramoPrometido = useMemo(
    () => ramoPrometidoPeloNome(processesBoard?.name),
    [processesBoard?.name],
  );

  // Ramo primeiro, busca depois. A busca varre a ficha inteira e também o nome
  // do lead, que na prática carrega a cidade ("Caso 88 - Mauro- Ererê/CE").
  const processosVisiveis = useMemo(() => {
    const doRamo = ramoFiltro
      ? boardProcesses.filter(p => ramoDoProcesso(p.process_number) === ramoFiltro)
      : boardProcesses;
    return filtrarProcessos(doRamo, processSearch, p =>
      [p.lead_id ? processLeadNames[p.lead_id] : null]);
  }, [boardProcesses, ramoFiltro, processSearch, processLeadNames]);

  const openProcessesSheet = async (board: { id: string; name: string }) => {
    setProcessesBoard(board);
    setProcessSearch("");
    setRamoFiltro(null);
    setLoadingProcesses(true);
    setBoardProcesses([]);
    setProcessLeadNames({});
    try {
      // Paginado pelo mesmo motivo da contagem: o PostgREST corta em 1000, e o
      // POP trabalhista tem 1289 fichas — a aba mostrava 1000 e calava as 289.
      const PAGE = 1000;
      const rows: LeadProcess[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await db
          .from("lead_processes")
          .select("*")
          .eq("workflow_id", board.id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const lote = (data || []) as unknown as LeadProcess[];
        rows.push(...lote);
        if (lote.length < PAGE) break;
      }
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
                  ? (resumoPorQuadro?.[board.id]?.processos || 0)
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
                processCount={resumoPorQuadro?.[board.id]?.processos || 0}
                processSummary={resumoPorQuadro?.[board.id]}
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
            {/* O número honesto: processos distintos, não linhas de cadastro.
                Só aparece a diferença quando ela existe — POP sem ficha
                repetida não precisa ver a palavra "ficha". */}
            {!loadingProcesses && resumoDaAba.fichas > 0 && (
              <p className="text-xs text-muted-foreground">
                {resumoDaAba.processos.toLocaleString("pt-BR")} processos
                {resumoDaAba.excedentes > 0 && (
                  <span title="Fichas a mais do que processos: o mesmo CNJ cadastrado mais de uma vez.">
                    {" "}· {resumoDaAba.fichas.toLocaleString("pt-BR")} fichas
                    {" "}({resumoDaAba.excedentes} repetida{resumoDaAba.excedentes > 1 ? "s" : ""})
                  </span>
                )}
              </p>
            )}
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

          {/* Busca: número (com ou sem pontuação), nome da parte, advogado,
              cliente, ou qualquer texto da ficha. Termos somam. */}
          {boardProcesses.length > 0 && (
            <div className="relative mt-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={processSearch}
                onChange={(e) => setProcessSearch(e.target.value)}
                placeholder="Número, parte, advogado ou qualquer texto"
                className="pl-9 h-9"
              />
            </div>
          )}

          {/* Filtro por ramo, lido do próprio CNJ. Só aparece quando há mais de
              um ramo no quadro — se o POP é homogêneo, não há o que separar. */}
          {resumoDaAba.porRamo.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              <button
                type="button"
                onClick={() => setRamoFiltro(null)}
                className={`text-[11px] rounded-full border px-2 py-0.5 transition-colors ${
                  ramoFiltro === null ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"
                }`}
              >
                Todos {resumoDaAba.processos}
              </button>
              {resumoDaAba.porRamo.map(r => {
                const foraDoLugar = ramoPrometido !== null && r.ramo !== ramoPrometido;
                return (
                  <button
                    key={r.ramo}
                    type="button"
                    onClick={() => setRamoFiltro(ramoFiltro === r.ramo ? null : r.ramo)}
                    title={foraDoLugar
                      ? `${r.processos} processos que não são do ramo que este ${copy.singular} promete`
                      : `${r.processos} processos${r.excedentes > 0 ? ` em ${r.fichas} fichas` : ""}`}
                    className={`text-[11px] rounded-full border px-2 py-0.5 transition-colors ${
                      ramoFiltro === r.ramo
                        ? "bg-primary text-primary-foreground border-primary"
                        : foraDoLugar
                          ? "border-amber-500/50 text-amber-600 dark:text-amber-400 hover:bg-accent"
                          : "hover:bg-accent"
                    }`}
                  >
                    {RAMO_BADGE[r.ramo]} {r.processos}
                  </button>
                );
              })}
            </div>
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
            ) : processosVisiveis.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-16">
                Nada encontrado entre as {resumoDaAba.fichas.toLocaleString("pt-BR")} fichas deste {copy.singular}.
              </p>
            ) : (
              <div className="space-y-2">
                {(processSearch.trim() || ramoFiltro) && (
                  <p className="text-[11px] text-muted-foreground px-0.5">
                    {processosVisiveis.length.toLocaleString("pt-BR")} de{" "}
                    {resumoDaAba.fichas.toLocaleString("pt-BR")} fichas
                  </p>
                )}
                {processosVisiveis.map(p => {
                  const clientName = p.lead_id ? processLeadNames[p.lead_id] : null;
                  const ramo = ramoDoProcesso(p.process_number);
                  const uf = ufDoProcesso(p);
                  const tribunal = parseCnj(p.process_number)?.courtCode ?? null;
                  // Só destaca o que o nome do quadro permite afirmar que está
                  // fora do lugar; POP de nome ambíguo não acusa ninguém.
                  const foraDoLugar = ramoPrometido !== null && ramo !== ramoPrometido;
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
                        {/* O ramo vem do dígito J do CNJ, não de `area` — que
                            está vazia em 94% das fichas. */}
                        <Badge
                          variant={foraDoLugar ? "destructive" : "secondary"}
                          className="text-[10px]"
                          title={foraDoLugar
                            ? `Este processo não é do ramo que "${processesBoard?.name}" promete`
                            : tribunal ?? undefined}
                        >
                          {RAMO_BADGE[ramo]}
                        </Badge>
                        {tribunal && (
                          <span className="text-[11px] text-muted-foreground">
                            {tribunal}{uf ? ` · ${uf}` : ""}
                          </span>
                        )}
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
