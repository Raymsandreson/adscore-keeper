/**
 * Compat: o card do funil virou o card único de quadro (`BoardCard`), usado
 * tanto pelo funil de vendas (time comercial) quanto pelo POP (time
 * processual). Este arquivo só mantém o nome antigo funcionando para quem
 * ainda importa dele. Em código novo, importe `BoardCard` direto.
 */
import { BoardCard } from "@/components/board/BoardCard";
import type { KanbanBoard } from "@/hooks/useKanbanBoards";

interface FunnelBoardCardProps {
  board: KanbanBoard;
  expanded: boolean;
  onToggleExpand: () => void;
  onOpenKanban: () => void;
  onOpenTeam: () => void;
  onEdit: () => void;
  onOpenBpcSheet?: () => void;
}

export function FunnelBoardCard(props: FunnelBoardCardProps) {
  return <BoardCard {...props} boardType="funnel" />;
}
