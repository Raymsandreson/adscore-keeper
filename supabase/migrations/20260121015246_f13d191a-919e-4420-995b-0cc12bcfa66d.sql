-- Create table for lead follow-ups/remarketing history
CREATE TABLE public.lead_followups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  followup_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  followup_type TEXT NOT NULL DEFAULT 'whatsapp', -- whatsapp, call, email, visit, meeting
  notes TEXT,
  outcome TEXT, -- positive, neutral, negative, no_answer
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.lead_followups ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (matching leads table pattern)
CREATE POLICY "Anyone can read lead_followups" 
ON public.lead_followups 
FOR SELECT 
USING (true);

CREATE POLICY "Anyone can insert lead_followups" 
ON public.lead_followups 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Anyone can update lead_followups" 
ON public.lead_followups 
FOR UPDATE 
USING (true);

CREATE POLICY "Anyone can delete lead_followups" 
ON public.lead_followups 
FOR DELETE 
USING (true);

-- Add followup_count to leads table for quick access
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS followup_count INTEGER DEFAULT 0;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_followup_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS first_visit_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS first_meeting_at TIMESTAMP WITH TIME ZONE;

-- Create index for faster queries
CREATE INDEX idx_lead_followups_lead_id ON public.lead_followups(lead_id);
CREATE INDEX idx_lead_followups_date ON public.lead_followups(followup_date);

-- Enable realtime for followups
ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_followups;