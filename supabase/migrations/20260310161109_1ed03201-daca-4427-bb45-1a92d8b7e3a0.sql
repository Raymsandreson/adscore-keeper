
CREATE TABLE public.webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'whatsapp',
  event_type text,
  instance_name text,
  phone text,
  direction text,
  status text DEFAULT 'received',
  payload jsonb,
  response jsonb,
  error_message text,
  processing_ms integer
);

CREATE INDEX idx_webhook_logs_created_at ON public.webhook_logs (created_at DESC);
CREATE INDEX idx_webhook_logs_source ON public.webhook_logs (source);
CREATE INDEX idx_webhook_logs_instance ON public.webhook_logs (instance_name);
CREATE INDEX idx_webhook_logs_event_type ON public.webhook_logs (event_type);

ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view webhook logs"
ON public.webhook_logs FOR SELECT TO authenticated
USING (true);

-- Auto-cleanup logs older than 7 days
CREATE OR REPLACE FUNCTION public.cleanup_old_webhook_logs()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DELETE FROM public.webhook_logs WHERE created_at < now() - interval '7 days';
$$;
