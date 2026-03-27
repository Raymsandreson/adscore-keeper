
CREATE TABLE public.lead_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  value TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.lead_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view lead sources"
  ON public.lead_sources FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage lead sources"
  ON public.lead_sources FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Seed default sources
INSERT INTO public.lead_sources (value, label, display_order) VALUES
  ('manual', 'Manual', 0),
  ('instagram', 'Instagram', 1),
  ('whatsapp', 'WhatsApp', 2),
  ('form', 'Formulário', 3),
  ('referral', 'Indicação', 4),
  ('facebook', 'Facebook', 5),
  ('noticia', 'Notícia', 6),
  ('prospecção', 'Prospecção Ativa', 7),
  ('cat_import', 'CAT', 8);
