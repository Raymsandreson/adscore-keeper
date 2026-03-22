
CREATE TABLE public.agent_automation_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES public.whatsapp_ai_agents(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL, -- 'on_activation', 'on_document_signed'
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, trigger_type)
);

ALTER TABLE public.agent_automation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage automation rules"
  ON public.agent_automation_rules
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.agent_automation_rules IS 'Automation rules triggered by agent events (activation, document signing)';
COMMENT ON COLUMN public.agent_automation_rules.actions IS 'JSON array of actions: [{type: "create_lead", config: {board_id, stage_id}}, {type: "create_contact"}, {type: "create_activity", config: {title, type}}, {type: "create_case", config: {nucleus_id}}]';
