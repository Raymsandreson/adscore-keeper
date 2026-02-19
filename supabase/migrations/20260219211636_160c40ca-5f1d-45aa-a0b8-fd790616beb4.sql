
-- Add per-board closing targets as JSONB (e.g. {"board_id_1": 2, "board_id_2": 3})
ALTER TABLE public.user_daily_goal_defaults
ADD COLUMN target_closed_by_board JSONB DEFAULT '{}'::jsonb;
