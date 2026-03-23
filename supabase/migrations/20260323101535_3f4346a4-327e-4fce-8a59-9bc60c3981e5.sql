
-- Table to link agents to specific board stages
CREATE TABLE public.agent_stage_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES public.whatsapp_ai_agents(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES public.kanban_boards(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (board_id, stage_id)
);

-- Enable RLS
ALTER TABLE public.agent_stage_assignments ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full access
CREATE POLICY "Authenticated users can manage agent stage assignments"
  ON public.agent_stage_assignments
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
