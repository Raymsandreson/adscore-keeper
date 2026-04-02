CREATE TABLE public.instance_connection_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL,
  instance_name text NOT NULL,
  was_connected boolean NOT NULL DEFAULT true,
  is_connected boolean NOT NULL DEFAULT true,
  disconnected_at timestamptz,
  reconnected_at timestamptz,
  last_alert_sent_at timestamptz,
  last_call_made_at timestamptz,
  alert_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(instance_id)
);

ALTER TABLE public.instance_connection_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view connection logs"
  ON public.instance_connection_log FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Service role can manage connection logs"
  ON public.instance_connection_log FOR ALL
  TO service_role USING (true);

CREATE TRIGGER update_instance_connection_log_updated_at
  BEFORE UPDATE ON public.instance_connection_log
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();