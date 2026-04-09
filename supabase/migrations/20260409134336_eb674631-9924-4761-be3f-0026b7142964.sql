CREATE TABLE public.lead_whatsapp_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  group_link TEXT,
  group_jid TEXT,
  group_name TEXT,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lead_whatsapp_groups_lead_id ON public.lead_whatsapp_groups(lead_id);

ALTER TABLE public.lead_whatsapp_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view lead groups"
ON public.lead_whatsapp_groups FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert lead groups"
ON public.lead_whatsapp_groups FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update lead groups"
ON public.lead_whatsapp_groups FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete lead groups"
ON public.lead_whatsapp_groups FOR DELETE TO authenticated USING (true);