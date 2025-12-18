-- Create table for AI conversation history
CREATE TABLE public.ai_conversation_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  entity_id TEXT NOT NULL,
  entity_name TEXT,
  entity_type TEXT NOT NULL DEFAULT 'adset',
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  ad_account_id TEXT
);

-- Enable RLS
ALTER TABLE public.ai_conversation_history ENABLE ROW LEVEL SECURITY;

-- Allow public read
CREATE POLICY "Allow public read" ON public.ai_conversation_history
FOR SELECT USING (true);

-- Allow public insert
CREATE POLICY "Allow public insert" ON public.ai_conversation_history
FOR INSERT WITH CHECK (true);

-- Allow public delete
CREATE POLICY "Allow public delete" ON public.ai_conversation_history
FOR DELETE USING (true);

-- Create index for faster queries
CREATE INDEX idx_ai_conversation_entity ON public.ai_conversation_history(entity_id, entity_type);