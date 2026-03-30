ALTER TABLE public.lead_status_history ADD COLUMN changed_by_type text NOT NULL DEFAULT 'manual';

COMMENT ON COLUMN public.lead_status_history.changed_by_type IS 'Who changed: manual, ai, automation, system';