
-- 1. Add campaign_id to whatsapp_messages for full traceability
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS campaign_id text;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS campaign_name text;

-- 2. Add action_source tracking to leads
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS action_source text DEFAULT 'manual';
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS action_source_detail text;

-- 3. Add action_source tracking to contacts
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS action_source text DEFAULT 'manual';
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS action_source_detail text;

-- 4. Add action_source tracking to legal_cases
ALTER TABLE public.legal_cases ADD COLUMN IF NOT EXISTS action_source text DEFAULT 'manual';
ALTER TABLE public.legal_cases ADD COLUMN IF NOT EXISTS action_source_detail text;

-- 5. Add action_source tracking to lead_activities
ALTER TABLE public.lead_activities ADD COLUMN IF NOT EXISTS action_source text DEFAULT 'manual';
ALTER TABLE public.lead_activities ADD COLUMN IF NOT EXISTS action_source_detail text;

-- 6. Add action_source tracking to whatsapp_messages (for system-sent messages)
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS action_source text DEFAULT 'manual';
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS action_source_detail text;

-- Comments for documentation
COMMENT ON COLUMN public.leads.action_source IS 'manual = user created, system = automation, agent = AI agent';
COMMENT ON COLUMN public.leads.action_source_detail IS 'Detail like agent name, automation rule name, campaign name';
COMMENT ON COLUMN public.whatsapp_messages.campaign_id IS 'Meta campaign ID from CTWA ads';
COMMENT ON COLUMN public.whatsapp_messages.campaign_name IS 'Meta campaign name for display';
