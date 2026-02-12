
-- Add board_id to allow per-funnel default goals (null = global fallback)
ALTER TABLE public.workflow_default_goals
ADD COLUMN IF NOT EXISTS board_id uuid REFERENCES public.kanban_boards(id) ON DELETE CASCADE;

-- Remove the single-row constraint, allow multiple rows (one per board + one global)
-- Add unique constraint on board_id (null for global)
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_default_goals_board_id 
ON public.workflow_default_goals (COALESCE(board_id, '00000000-0000-0000-0000-000000000000'));
