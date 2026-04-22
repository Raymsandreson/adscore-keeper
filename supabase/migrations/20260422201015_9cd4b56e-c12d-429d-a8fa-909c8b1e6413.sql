ALTER TABLE public.board_group_instances
  ADD COLUMN IF NOT EXISTS applies_to TEXT NOT NULL DEFAULT 'both';

ALTER TABLE public.board_group_instances
  DROP CONSTRAINT IF EXISTS board_group_instances_applies_to_check;

ALTER TABLE public.board_group_instances
  ADD CONSTRAINT board_group_instances_applies_to_check
  CHECK (applies_to IN ('both', 'open', 'closed'));

CREATE INDEX IF NOT EXISTS idx_board_group_instances_board_applies
  ON public.board_group_instances(board_id, applies_to);