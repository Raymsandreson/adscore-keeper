ALTER TABLE public.kanban_boards ADD COLUMN IF NOT EXISTS board_type TEXT NOT NULL DEFAULT 'funnel';

COMMENT ON COLUMN public.kanban_boards.board_type IS 'Type of board: funnel (sales/commercial) or workflow (processual/sequential)';

-- Add a workflow_board_id to legal_cases so each case can be linked to a specific workflow board
ALTER TABLE public.legal_cases ADD COLUMN IF NOT EXISTS workflow_board_id UUID REFERENCES public.kanban_boards(id) ON DELETE SET NULL;

-- Add a workflow_stage_id to lead_processes to track which stage a process is in within the workflow board
ALTER TABLE public.lead_processes ADD COLUMN IF NOT EXISTS workflow_stage_id TEXT;