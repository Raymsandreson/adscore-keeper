
CREATE TABLE public.board_group_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES public.kanban_boards(id) ON DELETE CASCADE,
  instance_id UUID NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(board_id, instance_id)
);

ALTER TABLE public.board_group_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage board_group_instances"
ON public.board_group_instances FOR ALL TO authenticated USING (true) WITH CHECK (true);
