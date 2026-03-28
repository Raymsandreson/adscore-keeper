ALTER TABLE public.whatsapp_agent_campaign_links 
  ADD COLUMN IF NOT EXISTS auto_create_lead BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS board_id UUID REFERENCES public.kanban_boards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stage_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS auto_create_contact BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS lead_source_label TEXT DEFAULT 'Click-to-WhatsApp';