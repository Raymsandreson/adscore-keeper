-- Create table to store workflow report history
CREATE TABLE public.workflow_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  started_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ended_at TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_seconds INTEGER NOT NULL,
  total_comments INTEGER NOT NULL DEFAULT 0,
  replies_count INTEGER NOT NULL DEFAULT 0,
  leads_created INTEGER NOT NULL DEFAULT 0,
  follows_count INTEGER NOT NULL DEFAULT 0,
  dms_sent INTEGER NOT NULL DEFAULT 0,
  skips_count INTEGER NOT NULL DEFAULT 0,
  registrations_count INTEGER NOT NULL DEFAULT 0,
  actions_detail JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.workflow_reports ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own workflow reports" 
ON public.workflow_reports 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own workflow reports" 
ON public.workflow_reports 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own workflow reports" 
ON public.workflow_reports 
FOR DELETE 
USING (auth.uid() = user_id);