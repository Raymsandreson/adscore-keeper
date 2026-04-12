ALTER TABLE public.board_group_settings
ADD COLUMN closed_sequence_start integer DEFAULT 1,
ADD COLUMN closed_current_sequence integer DEFAULT 0;