
-- Add phone to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;

-- Add recipient_user_ids to notification config
ALTER TABLE public.whatsapp_notification_config ADD COLUMN IF NOT EXISTS recipient_user_ids uuid[] DEFAULT '{}';
