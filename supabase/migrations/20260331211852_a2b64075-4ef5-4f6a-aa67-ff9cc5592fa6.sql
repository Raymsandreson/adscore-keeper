ALTER TABLE public.board_group_settings 
ADD COLUMN IF NOT EXISTS process_workflows JSONB DEFAULT '[]'::jsonb;