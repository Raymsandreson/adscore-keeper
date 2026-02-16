
-- Add columns to whatsapp_instances for ad account linking
ALTER TABLE public.whatsapp_instances
ADD COLUMN IF NOT EXISTS receive_leads boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS ad_account_id text,
ADD COLUMN IF NOT EXISTS ad_account_name text;
