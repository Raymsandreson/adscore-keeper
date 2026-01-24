-- Create table for n8n automation logs
CREATE TABLE public.n8n_automation_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  action_type TEXT NOT NULL,
  comment_id TEXT,
  message_sent TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.n8n_automation_logs ENABLE ROW LEVEL SECURITY;

-- Policies for authenticated users
CREATE POLICY "Users can view their own automation logs"
ON public.n8n_automation_logs
FOR SELECT
USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Service role can insert logs"
ON public.n8n_automation_logs
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Users can delete their own logs"
ON public.n8n_automation_logs
FOR DELETE
USING (auth.uid() = user_id);

-- Index for faster queries
CREATE INDEX idx_n8n_logs_created_at ON public.n8n_automation_logs(created_at DESC);
CREATE INDEX idx_n8n_logs_action_type ON public.n8n_automation_logs(action_type);