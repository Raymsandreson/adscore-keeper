ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS whatsapp_group_id text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS whatsapp_group_id text;