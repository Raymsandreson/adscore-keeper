-- Create table for outbound response goal history
CREATE TABLE public.outbound_goal_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  target_rate NUMERIC NOT NULL,
  achieved_rate NUMERIC NOT NULL,
  total_sent INTEGER NOT NULL DEFAULT 0,
  total_replies INTEGER NOT NULL DEFAULT 0,
  achieved_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  notes TEXT,
  ad_account_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.outbound_goal_history ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (matching existing pattern)
CREATE POLICY "Anyone can read outbound_goal_history" 
ON public.outbound_goal_history 
FOR SELECT 
USING (true);

CREATE POLICY "Anyone can insert outbound_goal_history" 
ON public.outbound_goal_history 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Anyone can delete outbound_goal_history" 
ON public.outbound_goal_history 
FOR DELETE 
USING (true);

-- Add index for faster queries
CREATE INDEX idx_outbound_goal_history_achieved_at ON public.outbound_goal_history(achieved_at DESC);