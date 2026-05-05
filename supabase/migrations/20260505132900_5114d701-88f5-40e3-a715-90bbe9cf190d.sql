ALTER TABLE public.board_group_settings
  ADD COLUMN IF NOT EXISTS post_close_agent_id UUID;