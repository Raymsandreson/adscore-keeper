CREATE TABLE public.agent_filter_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  lead_status_board_ids TEXT[] DEFAULT NULL,
  lead_status_filter TEXT[] DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id)
);

ALTER TABLE public.agent_filter_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to agent_filter_settings"
  ON public.agent_filter_settings
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);