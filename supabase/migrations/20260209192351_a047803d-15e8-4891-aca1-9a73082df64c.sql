-- Add lead_id to promoted_posts to link ads directly to leads
ALTER TABLE public.promoted_posts ADD COLUMN lead_id UUID REFERENCES public.leads(id);

-- Add index for lead-based queries
CREATE INDEX idx_promoted_posts_lead_id ON public.promoted_posts(lead_id);
