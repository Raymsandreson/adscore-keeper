-- Create table for lead stage history
CREATE TABLE public.lead_stage_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  from_board_id UUID,
  to_board_id UUID,
  changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  notes TEXT
);

-- Enable RLS
ALTER TABLE public.lead_stage_history ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Anyone can read lead_stage_history" 
ON public.lead_stage_history 
FOR SELECT 
USING (true);

CREATE POLICY "Anyone can insert lead_stage_history" 
ON public.lead_stage_history 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Anyone can delete lead_stage_history" 
ON public.lead_stage_history 
FOR DELETE 
USING (true);

-- Create index for faster queries
CREATE INDEX idx_lead_stage_history_lead_id ON public.lead_stage_history(lead_id);
CREATE INDEX idx_lead_stage_history_changed_at ON public.lead_stage_history(changed_at DESC);