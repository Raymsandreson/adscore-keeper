-- Create table for campaign action history
CREATE TABLE public.campaign_action_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('campaign', 'adset', 'ad')),
  entity_name TEXT,
  action TEXT NOT NULL CHECK (action IN ('pause', 'activate', 'update_budget', 'update_bid', 'duplicate')),
  old_value TEXT,
  new_value TEXT,
  ad_account_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.campaign_action_history ENABLE ROW LEVEL SECURITY;

-- Allow public read/insert for now (no auth required for this app)
CREATE POLICY "Allow public read" ON public.campaign_action_history FOR SELECT USING (true);
CREATE POLICY "Allow public insert" ON public.campaign_action_history FOR INSERT WITH CHECK (true);

-- Create index for faster queries
CREATE INDEX idx_campaign_action_history_created_at ON public.campaign_action_history(created_at DESC);
CREATE INDEX idx_campaign_action_history_entity_id ON public.campaign_action_history(entity_id);