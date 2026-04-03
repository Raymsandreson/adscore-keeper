ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS notify_start_hour integer NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS notify_end_hour integer NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS notify_weekdays_only boolean NOT NULL DEFAULT true;