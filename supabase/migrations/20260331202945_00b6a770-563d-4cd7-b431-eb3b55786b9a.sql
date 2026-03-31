
ALTER TABLE public.board_group_settings
  ADD COLUMN IF NOT EXISTS auto_create_process boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS process_nucleus_id uuid REFERENCES public.specialized_nuclei(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS process_workflow_board_id uuid REFERENCES public.kanban_boards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS process_auto_activities jsonb DEFAULT '[]'::jsonb;
