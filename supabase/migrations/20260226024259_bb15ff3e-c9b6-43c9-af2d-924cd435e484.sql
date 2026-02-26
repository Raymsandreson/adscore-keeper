
CREATE TABLE public.field_stage_requirements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  field_id UUID NOT NULL REFERENCES public.lead_custom_fields(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES public.kanban_boards(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(field_id, board_id, stage_id)
);

ALTER TABLE public.field_stage_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage field stage requirements"
  ON public.field_stage_requirements
  FOR ALL
  USING (true)
  WITH CHECK (true);
