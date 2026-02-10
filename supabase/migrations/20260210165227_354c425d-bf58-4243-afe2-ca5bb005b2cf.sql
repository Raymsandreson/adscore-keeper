
-- Add changed_by column to lead_stage_history
ALTER TABLE public.lead_stage_history ADD COLUMN changed_by UUID REFERENCES auth.users(id);

-- Create index for querying by user
CREATE INDEX idx_lead_stage_history_changed_by ON public.lead_stage_history(changed_by);
