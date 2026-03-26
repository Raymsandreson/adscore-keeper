
CREATE TABLE public.board_group_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES public.kanban_boards(id) ON DELETE CASCADE,
  group_name_prefix TEXT DEFAULT '',
  sequence_start INTEGER DEFAULT 1,
  current_sequence INTEGER DEFAULT 0,
  lead_fields TEXT[] DEFAULT ARRAY['lead_name']::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(board_id)
);

ALTER TABLE public.board_group_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage board group settings"
ON public.board_group_settings
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
