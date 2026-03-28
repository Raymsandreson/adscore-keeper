CREATE TABLE public.system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read settings"
  ON public.system_settings FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins can manage settings"
  ON public.system_settings FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.system_settings (key, value, description) VALUES
  ('enrich_message_threshold', '5', 'Quantidade mínima de mensagens inbound para acionar enriquecimento automático do lead');