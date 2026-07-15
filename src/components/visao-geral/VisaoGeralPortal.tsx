import { lazy, Suspense, useMemo, useState } from "react";
import {
  HardHat,
  Brain,
  Baby,
  Activity,
  Stethoscope,
  ShieldCheck,
  ClipboardList,
  ChevronRight,
  ArrowLeft,
  LayoutDashboard,
  AlertCircle,
  HeartHandshake,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useKanbanBoards } from "@/hooks/useKanbanBoards";
import { useNavigate } from "react-router-dom";
import { FunnelBoardCard } from "@/components/funnel/FunnelBoardCard";
import { FunnelTeamDialog } from "@/components/funnel/FunnelTeamDialog";
import { WorkflowBuilder } from "@/components/workflow/WorkflowBuilder";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import GenericFunnelDashboard from "./GenericFunnelDashboard";

const FunnelLeadsReport = lazy(() => import("./FunnelLeadsReport"));

const AcolhimentoPage = lazy(() => import("@/pages/AcolhimentoPage"));

const AcompanhamentoProcessualPage = lazy(
  () => import("@/pages/AcompanhamentoProcessualPage"),
);

type Group = "funnel" | "process";

interface SelectorItem {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  group: Group;
  /** Matcher used to find the kanban board by name (case-insensitive). */
  boardMatcher?: RegExp;
  /** Custom renderer (used by Acompanhamento Processual). */
  customRender?: () => React.ReactNode;
  accent: string;
  /** If true, renders the same detailed panel used inside Funis de Vendas. */
  useDetailedPanel?: boolean;
  /** If true, renders the leads report (cadastros + movimentações) below the dashboard. */
  showLeadsReport?: boolean;
}

const SELECTORS: SelectorItem[] = [
  {
    id: "acidente-trabalho",
    label: "Acidente de Trabalho",
    description: "Funil de captação e conversão de acidentes laborais.",
    icon: <HardHat className="h-5 w-5" />,
    group: "funnel",
    boardMatcher: /acidente.*trabalho|trabalho.*acidente/i,
    accent: "from-orange-500/15 to-orange-500/0 text-orange-600",
    showLeadsReport: true,
  },
  {
    id: "bpc-autismo",
    label: "BPC - Autismo",
    description: "Funil BPC-LOAS / Autista, etapas e elegibilidade.",
    icon: <Brain className="h-5 w-5" />,
    group: "funnel",
    boardMatcher: /bpc|autis/i,
    accent: "from-indigo-500/15 to-indigo-500/0 text-indigo-600",
    useDetailedPanel: true,
  },
  {
    id: "auxilio-maternidade",
    label: "Auxílio Maternidade",
    description: "Funil de auxílio maternidade.",
    icon: <Baby className="h-5 w-5" />,
    group: "funnel",
    boardMatcher: /maternidade/i,
    accent: "from-pink-500/15 to-pink-500/0 text-pink-600",
  },
  {
    id: "auxilio-acidente",
    label: "Auxílio Acidente",
    description: "Funil de auxílio acidente.",
    icon: <Activity className="h-5 w-5" />,
    group: "funnel",
    boardMatcher: /aux[íi]lio.*acidente|acidente.*aux[íi]lio/i,
    accent: "from-amber-500/15 to-amber-500/0 text-amber-600",
  },
  {
    id: "auxilio-doenca",
    label: "Auxílio Doença",
    description: "Funil de auxílio doença / benefício INSS.",
    icon: <Stethoscope className="h-5 w-5" />,
    group: "funnel",
    boardMatcher: /doen[çc]a/i,
    accent: "from-sky-500/15 to-sky-500/0 text-sky-600",
  },
  {
    id: "seguro-vida",
    label: "Seguro de Vida",
    description: "Funil de seguro de vida.",
    icon: <ShieldCheck className="h-5 w-5" />,
    group: "funnel",
    boardMatcher: /seguro.*vida|vida.*seguro/i,
    accent: "from-emerald-500/15 to-emerald-500/0 text-emerald-600",
  },
  {
    id: "acompanhamento-processual",
    label: "Acompanhamento Processual",
    description: "Painel de SLA, protocolos e movimentação processual.",
    icon: <ClipboardList className="h-5 w-5" />,
    group: "process",
    customRender: () => (
      <Suspense fallback={<DashboardSkeleton />}>
        <AcompanhamentoProcessualPage />
      </Suspense>
    ),
    accent: "from-slate-500/15 to-slate-500/0 text-slate-600",
  },
];

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-lg" />
      <Skeleton className="h-48 rounded-lg" />
    </div>
  );
}

function SelectorCard({
  item,
  onClick,
}: {
  item: SelectorItem;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group relative text-left rounded-xl border bg-card hover:border-primary/40 hover:shadow-md transition-all p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div
        className={`absolute inset-0 rounded-xl bg-gradient-to-br ${item.accent} opacity-60 pointer-events-none`}
      />
      <div className="relative flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-background/80 border flex items-center justify-center shrink-0">
          {item.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="font-medium leading-tight">{item.label}</div>
            <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </div>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {item.description}
          </p>
        </div>
      </div>
    </button>
  );
}

export default function VisaoGeralPortal() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const navigate = useNavigate();
  const { boards } = useKanbanBoards();
  const active = activeId ? SELECTORS.find((s) => s.id === activeId) : null;

  const funnelItems = SELECTORS.filter((s) => s.group === "funnel");
  const processItems = SELECTORS.filter((s) => s.group === "process");

  const handleSelect = (id: string) => {
    if (id === "bpc-autismo") {
      const bpc = boards.find(
        (b) => b.board_type === "funnel" && /bpc|autis/i.test(b.name),
      );
      if (bpc) {
        navigate(`/sales-funnels/bpc/${bpc.id}`);
        return;
      }
    }
    setActiveId(id);
  };

  if (active) {
    return (
      <div className="container mx-auto max-w-7xl px-4 py-6 space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setActiveId(null)}
              className="shrink-0"
            >
              <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
            </Button>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-muted-foreground">{active.icon}</span>
              <h1 className="text-lg font-semibold truncate">{active.label}</h1>
            </div>
          </div>
        </div>

        <div>
          {active.customRender ? (
            active.customRender()
          ) : active.useDetailedPanel && active.boardMatcher ? (
            <Suspense fallback={<DashboardSkeleton />}>
              <DetailedFunnelPanel boardMatcher={active.boardMatcher} />
            </Suspense>
          ) : active.boardMatcher ? (
            <Suspense fallback={<DashboardSkeleton />}>
              <div className="space-y-5">
                <GenericFunnelDashboard
                  boardMatcher={active.boardMatcher}
                  title={active.label}
                />
                {active.showLeadsReport && (
                  <FunnelLeadsReport boardMatcher={active.boardMatcher} />
                )}
              </div>
            </Suspense>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8 space-y-8">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <LayoutDashboard className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold leading-tight">Visão Geral</h1>
            <p className="text-sm text-muted-foreground">
              Selecione um dashboard para carregar. Nada é processado até você abrir.
            </p>
          </div>
        </div>
      </header>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Funis de Vendas
          </h2>
          <div className="flex-1 h-px bg-border" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {funnelItems.map((item) => (
            <SelectorCard
              key={item.id}
              item={item}
              onClick={() => handleSelect(item.id)}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Processos
          </h2>
          <div className="flex-1 h-px bg-border" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {processItems.map((item) => (
            <SelectorCard
              key={item.id}
              item={item}
              onClick={() => handleSelect(item.id)}
            />
          ))}
        </div>
      </section>

      
    </div>
  );
}

function DetailedFunnelPanel({ boardMatcher }: { boardMatcher: RegExp }) {
  const navigate = useNavigate();
  const { boards, loading, fetchBoards } = useKanbanBoards();
  const [teamBoard, setTeamBoard] = useState<{ id: string; name: string } | null>(null);
  const [editBoardId, setEditBoardId] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);

  const board = useMemo(
    () => {
      const matches = boards.filter(
        (b) => b.board_type === "funnel" && boardMatcher.test(b.name),
      );
      return matches.find((b) => (b.stages || []).length > 0) || matches[0] || null;
    },
    [boards, boardMatcher],
  );

  if (loading) return <DashboardSkeleton />;
  if (!board) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="p-6 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
          <div className="text-sm">
            Funil não encontrado na base. Verifique o nome em Funis de Vendas.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <FunnelBoardCard
        board={board}
        expanded
        onToggleExpand={() => {}}
        onOpenKanban={() => navigate(`/leads?board=${board.id}`)}
        onOpenTeam={() => setTeamBoard({ id: board.id, name: board.name })}
        onEdit={() => {
          setEditBoardId(board.id);
          setShowBuilder(true);
        }}
      />

      <WorkflowBuilder
        open={showBuilder}
        onOpenChange={setShowBuilder}
        onWorkflowSaved={() => fetchBoards()}
        initialEditBoardId={editBoardId}
        initialCreateNew={false}
        boardType="funnel"
      />

      {teamBoard && (
        <FunnelTeamDialog
          open={!!teamBoard}
          onOpenChange={(o) => !o && setTeamBoard(null)}
          boardId={teamBoard.id}
          boardName={teamBoard.name}
        />
      )}
    </>
  );
}
