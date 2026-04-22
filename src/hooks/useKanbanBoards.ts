import { useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface KanbanStage {
  id: string;
  name: string;
  color: string;
  stagnationDays?: number; // Days before marking as stagnant (null = disabled)
}

export interface KanbanBoard {
  id: string;
  name: string;
  description: string | null;
  stages: KanbanStage[];
  color: string;
  icon: string;
  is_default: boolean;
  display_order: number;
  ad_account_id: string | null;
  board_type: 'funnel' | 'workflow';
  product_service_id: string | null;
  created_at: string;
  updated_at: string;
}

const fetchBoardsFromDB = async (adAccountId?: string): Promise<KanbanBoard[]> => {
  let query = supabase
    .from('kanban_boards')
    .select('*')
    .order('display_order', { ascending: true });

  if (adAccountId) {
    query = query.or(`ad_account_id.eq.${adAccountId},ad_account_id.is.null`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const parsedBoards: KanbanBoard[] = (data || []).map(board => ({
    ...board,
    board_type: (board as any).board_type as KanbanBoard['board_type'] || 'funnel',
    stages: (board.stages as unknown as KanbanStage[]) || [],
  } as KanbanBoard));

  console.log(`📋 Kanban boards loaded: ${parsedBoards.length}`, parsedBoards.map(b => b.name));
  return parsedBoards;
};

export const useKanbanBoards = (adAccountId?: string) => {
  const queryClient = useQueryClient();
  const queryKey = ['kanban-boards', adAccountId ?? null];
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);

  const { data: boards = [], isLoading: loading } = useQuery({
    queryKey,
    queryFn: () => fetchBoardsFromDB(adAccountId),
    staleTime: 5 * 60 * 1000, // 5 minutes — prevents the 4x refetch loop
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const fetchBoards = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  // Auto-select default board or first board on initial load
  useEffect(() => {
    if (!selectedBoardId && boards.length > 0) {
      const defaultBoard = boards.find(b => b.is_default) || boards[0];
      setSelectedBoardId(defaultBoard.id);
    }
  }, [boards, selectedBoardId]);

  const createBoard = async (board: Partial<KanbanBoard>) => {
    try {
      const { data, error } = await supabase
        .from('kanban_boards')
        .insert([{
          name: board.name || 'Novo Quadro',
          description: board.description,
          stages: JSON.parse(JSON.stringify(board.stages || [])),
          color: board.color || '#3b82f6',
          icon: board.icon || 'layout-grid',
          is_default: board.is_default || false,
          display_order: boards.length,
          ad_account_id: adAccountId || null,
          board_type: board.board_type || 'funnel',
          product_service_id: board.product_service_id || null,
        } as any])
        .select()
        .single();

      if (error) throw error;

      toast.success('Quadro criado com sucesso');
      await fetchBoards();

      const createdBoard: KanbanBoard = {
        ...data,
        board_type: (data as any).board_type || 'funnel',
        stages: (data.stages as unknown as KanbanStage[]) || [],
      } as KanbanBoard;
      return createdBoard;
    } catch (error) {
      console.error('Error creating board:', error);
      toast.error('Erro ao criar quadro');
      throw error;
    }
  };

  const updateBoard = async (id: string, updates: Partial<KanbanBoard>) => {
    try {
      const updatePayload: Record<string, unknown> = {};
      if (updates.name !== undefined) updatePayload.name = updates.name;
      if (updates.description !== undefined) updatePayload.description = updates.description;
      if (updates.color !== undefined) updatePayload.color = updates.color;
      if (updates.icon !== undefined) updatePayload.icon = updates.icon;
      if (updates.is_default !== undefined) updatePayload.is_default = updates.is_default;
      if (updates.display_order !== undefined) updatePayload.display_order = updates.display_order;
      if (updates.board_type !== undefined) updatePayload.board_type = updates.board_type;
      if (updates.stages !== undefined) updatePayload.stages = JSON.parse(JSON.stringify(updates.stages));
      if (updates.product_service_id !== undefined) updatePayload.product_service_id = updates.product_service_id;

      const { data, error } = await supabase
        .from('kanban_boards')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      toast.success('Quadro atualizado');
      await fetchBoards();

      const updatedBoard: KanbanBoard = {
        ...data,
        board_type: (data as any).board_type || 'funnel',
        stages: (data.stages as unknown as KanbanStage[]) || [],
      } as KanbanBoard;
      return updatedBoard;
    } catch (error) {
      console.error('Error updating board:', error);
      toast.error('Erro ao atualizar quadro');
      throw error;
    }
  };

  const deleteBoard = async (id: string) => {
    try {
      await supabase
        .from('leads')
        .update({ board_id: null })
        .eq('board_id', id);

      const { error } = await supabase
        .from('kanban_boards')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast.success('Quadro removido');

      if (selectedBoardId === id) {
        const remaining = boards.filter(b => b.id !== id);
        setSelectedBoardId(remaining.length > 0 ? remaining[0].id : null);
      }

      await fetchBoards();
    } catch (error) {
      console.error('Error deleting board:', error);
      toast.error('Erro ao remover quadro');
      throw error;
    }
  };

  const addStage = async (boardId: string, stage: KanbanStage) => {
    const board = boards.find(b => b.id === boardId);
    if (!board) return;
    const newStages = [...board.stages, stage];
    await updateBoard(boardId, { stages: newStages });
  };

  const updateStage = async (boardId: string, stageId: string, updates: Partial<KanbanStage>) => {
    const board = boards.find(b => b.id === boardId);
    if (!board) return;
    const newStages = board.stages.map(s =>
      s.id === stageId ? { ...s, ...updates } : s
    );
    await updateBoard(boardId, { stages: newStages });
  };

  const deleteStage = async (boardId: string, stageId: string) => {
    const board = boards.find(b => b.id === boardId);
    if (!board) return;
    const newStages = board.stages.filter(s => s.id !== stageId);
    await updateBoard(boardId, { stages: newStages });
  };

  const reorderStages = async (boardId: string, newStages: KanbanStage[]) => {
    await updateBoard(boardId, { stages: newStages });
  };

  const selectedBoard = boards.find(b => b.id === selectedBoardId) || null;

  return {
    boards,
    loading,
    selectedBoard,
    selectedBoardId,
    setSelectedBoardId,
    fetchBoards,
    createBoard,
    updateBoard,
    deleteBoard,
    addStage,
    updateStage,
    deleteStage,
    reorderStages,
  };
};
