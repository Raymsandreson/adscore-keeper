
-- Add AI tracking fields to lead_activities
ALTER TABLE public.lead_activities 
ADD COLUMN IF NOT EXISTS created_by_ai BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS ai_generation_context JSONB DEFAULT NULL;

-- Index for filtering AI-created activities
CREATE INDEX IF NOT EXISTS idx_lead_activities_created_by_ai 
ON public.lead_activities (created_by_ai) WHERE created_by_ai = true;
