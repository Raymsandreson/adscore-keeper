ALTER TABLE public.whatsapp_notification_config
  ADD COLUMN IF NOT EXISTS notify_whatsapp_dashboard boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS dashboard_instance_names text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS dashboard_schedule_times text[] DEFAULT ARRAY['08:00','18:00'],
  ADD COLUMN IF NOT EXISTS dashboard_schedule_days integer[] DEFAULT ARRAY[1,2,3,4,5];