
CREATE TABLE public.campaign_status_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT,
  instance_id UUID REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  last_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  last_error TEXT,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id)
);

ALTER TABLE public.campaign_status_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view campaign status logs"
  ON public.campaign_status_log FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role can manage campaign status logs"
  ON public.campaign_status_log FOR ALL USING (true) WITH CHECK (true);
