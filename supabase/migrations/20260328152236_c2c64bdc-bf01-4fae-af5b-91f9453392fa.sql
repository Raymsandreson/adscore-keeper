CREATE TABLE IF NOT EXISTS public.lead_enrichment_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  instance_name TEXT NOT NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  fields_updated JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_enrichment_log_phone ON public.lead_enrichment_log(phone, instance_name, created_at DESC);

ALTER TABLE public.lead_enrichment_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view enrichment logs"
  ON public.lead_enrichment_log FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role can insert enrichment logs"
  ON public.lead_enrichment_log FOR INSERT TO authenticated WITH CHECK (true);