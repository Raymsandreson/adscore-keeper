
-- Table to assign AI agents to broadcast lists
CREATE TABLE public.broadcast_list_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_list_id UUID NOT NULL REFERENCES public.broadcast_lists(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.whatsapp_ai_agents(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (broadcast_list_id)
);

ALTER TABLE public.broadcast_list_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage broadcast list agents"
  ON public.broadcast_list_agents FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
