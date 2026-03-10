-- Update cleanup function to 3 days instead of 7
CREATE OR REPLACE FUNCTION public.cleanup_old_webhook_logs()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DELETE FROM public.webhook_logs WHERE created_at < now() - interval '3 days';
$$;

-- Create function to archive old WhatsApp messages (>90 days)
CREATE OR REPLACE FUNCTION public.cleanup_old_whatsapp_messages()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DELETE FROM public.whatsapp_messages WHERE created_at < now() - interval '90 days';
$$;

-- Run cleanup now
SELECT public.cleanup_old_webhook_logs();
SELECT public.cleanup_old_whatsapp_messages();