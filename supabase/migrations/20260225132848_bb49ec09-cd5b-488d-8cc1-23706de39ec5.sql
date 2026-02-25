
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS treatment_title TEXT DEFAULT NULL;

ALTER TABLE public.whatsapp_instances ADD COLUMN IF NOT EXISTS auto_identify_sender BOOLEAN DEFAULT false;
