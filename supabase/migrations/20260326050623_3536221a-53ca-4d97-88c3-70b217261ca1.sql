ALTER TABLE public.whatsapp_notification_config 
ADD COLUMN IF NOT EXISTS notify_checklist_steps boolean DEFAULT false;