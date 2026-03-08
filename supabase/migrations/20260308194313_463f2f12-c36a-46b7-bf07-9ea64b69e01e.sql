
ALTER TABLE public.whatsapp_ai_agents 
ADD COLUMN IF NOT EXISTS human_pause_minutes integer NOT NULL DEFAULT 30;

COMMENT ON COLUMN public.whatsapp_ai_agents.human_pause_minutes IS 'Minutes to pause AI agent after a human sends a message in the conversation';

ALTER TABLE public.whatsapp_conversation_agents 
ADD COLUMN IF NOT EXISTS human_paused_until timestamptz DEFAULT NULL;

COMMENT ON COLUMN public.whatsapp_conversation_agents.human_paused_until IS 'Timestamp until which the AI agent is paused due to human intervention';
