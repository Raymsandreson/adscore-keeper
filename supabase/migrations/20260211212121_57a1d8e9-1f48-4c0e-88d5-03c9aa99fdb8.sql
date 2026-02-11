
CREATE TABLE public.activity_field_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  field_key text NOT NULL UNIQUE,
  label text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  include_in_message boolean NOT NULL DEFAULT true,
  placeholder text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.activity_field_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read activity_field_settings"
  ON public.activity_field_settings FOR SELECT USING (true);

CREATE POLICY "Authenticated users can update activity_field_settings"
  ON public.activity_field_settings FOR UPDATE USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert activity_field_settings"
  ON public.activity_field_settings FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Seed default fields
INSERT INTO public.activity_field_settings (field_key, label, display_order, include_in_message, placeholder) VALUES
  ('what_was_done', 'O que foi feito?', 1, true, 'Descreva o que foi realizado...'),
  ('current_status', 'Como está?', 2, true, 'Situação atual do caso...'),
  ('next_steps', 'Próximo passo', 3, true, 'Qual será o próximo passo...'),
  ('notes', 'Observações', 4, false, 'Notas adicionais...');
