ALTER TABLE public.whatsapp_instances 
  ADD COLUMN IF NOT EXISTS voice_id text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS voice_name text DEFAULT NULL;