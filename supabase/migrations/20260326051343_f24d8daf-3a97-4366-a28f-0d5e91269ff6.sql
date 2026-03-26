ALTER TABLE public.whatsapp_notification_config 
ADD COLUMN IF NOT EXISTS notify_zapsign_documents boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS notify_callface_calls boolean DEFAULT false;