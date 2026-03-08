
-- Add automation settings to whatsapp_ai_agents
ALTER TABLE public.whatsapp_ai_agents
  ADD COLUMN IF NOT EXISTS response_delay_seconds INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS followup_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS followup_interval_minutes INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS followup_max_attempts INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS followup_message TEXT,
  ADD COLUMN IF NOT EXISTS auto_call_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_call_mode TEXT NOT NULL DEFAULT 'on_no_response',
  ADD COLUMN IF NOT EXISTS auto_call_delay_seconds INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_call_no_response_minutes INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS auto_call_instance_name TEXT;

-- Link campaigns to agents
CREATE TABLE IF NOT EXISTS public.whatsapp_agent_campaign_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES public.whatsapp_ai_agents(id) ON DELETE CASCADE NOT NULL,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id)
);

ALTER TABLE public.whatsapp_agent_campaign_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users can manage campaign links" ON public.whatsapp_agent_campaign_links FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Call queue for auto-dialer
CREATE TABLE IF NOT EXISTS public.whatsapp_call_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  instance_name TEXT NOT NULL,
  agent_id UUID REFERENCES public.whatsapp_ai_agents(id) ON DELETE SET NULL,
  lead_id TEXT,
  lead_name TEXT,
  contact_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 0,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_attempt_at TIMESTAMPTZ,
  last_result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_call_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users can manage call queue" ON public.whatsapp_call_queue FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Followup tracking
CREATE TABLE IF NOT EXISTS public.whatsapp_agent_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  instance_name TEXT NOT NULL,
  agent_id UUID REFERENCES public.whatsapp_ai_agents(id) ON DELETE CASCADE NOT NULL,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_agent_followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users can manage followups" ON public.whatsapp_agent_followups FOR ALL TO authenticated USING (true) WITH CHECK (true);
