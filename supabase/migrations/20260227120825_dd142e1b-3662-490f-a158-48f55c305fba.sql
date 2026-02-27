
-- Form layout tabs (groups) - configurable tabs for lead edit form
CREATE TABLE public.form_layout_tabs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT DEFAULT 'FileText',
  display_order INT NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT false,
  system_key TEXT, -- maps to hardcoded tab like 'basic', 'contacts', etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Form layout fields - field placement within tabs
CREATE TABLE public.form_layout_fields (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tab_id UUID NOT NULL REFERENCES public.form_layout_tabs(id) ON DELETE CASCADE,
  field_key TEXT, -- for native fields like 'lead_name', 'source', etc.
  custom_field_id UUID REFERENCES public.lead_custom_fields(id) ON DELETE CASCADE,
  label_override TEXT, -- optional label override
  display_order INT NOT NULL DEFAULT 0,
  is_hidden BOOLEAN NOT NULL DEFAULT false,
  col_span INT NOT NULL DEFAULT 1, -- 1 or 2 for grid layout
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT field_key_or_custom CHECK (field_key IS NOT NULL OR custom_field_id IS NOT NULL)
);

-- Enable RLS
ALTER TABLE public.form_layout_tabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_layout_fields ENABLE ROW LEVEL SECURITY;

-- RLS policies - allow all authenticated users to read, only admins to modify
CREATE POLICY "Anyone can read form layout tabs" ON public.form_layout_tabs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage form layout tabs" ON public.form_layout_tabs FOR ALL TO authenticated USING (public.is_admin(auth.uid()));

CREATE POLICY "Anyone can read form layout fields" ON public.form_layout_fields FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage form layout fields" ON public.form_layout_fields FOR ALL TO authenticated USING (public.is_admin(auth.uid()));

-- Seed default system tabs
INSERT INTO public.form_layout_tabs (name, icon, display_order, is_system, system_key) VALUES
  ('Básico', 'User', 0, true, 'basic'),
  ('Contatos', 'Users', 1, true, 'contacts'),
  ('Checklist', 'CheckSquare', 2, true, 'checklist'),
  ('Atividades', 'Calendar', 3, true, 'activities'),
  ('Acidente', 'FileText', 4, true, 'accident'),
  ('Local', 'MapPin', 5, true, 'location'),
  ('Empresas', 'Building', 6, true, 'companies'),
  ('Jurídico', 'Briefcase', 7, true, 'legal'),
  ('Histórico', 'History', 8, true, 'history'),
  ('Config', 'Settings', 9, true, 'config'),
  ('Chat IA', 'Sparkles', 10, true, 'ai_chat');

-- Seed default fields for basic tab
INSERT INTO public.form_layout_fields (tab_id, field_key, display_order, col_span)
SELECT t.id, f.field_key, f.display_order, f.col_span
FROM public.form_layout_tabs t,
(VALUES 
  ('lead_name', 0, 2),
  ('source', 1, 1),
  ('acolhedor', 2, 1),
  ('group_link', 3, 2),
  ('instagram_username', 4, 1),
  ('client_classification', 5, 1),
  ('lead_outcome', 6, 2),
  ('notes', 7, 2),
  ('board_id', 8, 2)
) AS f(field_key, display_order, col_span)
WHERE t.system_key = 'basic';

-- Seed fields for accident tab
INSERT INTO public.form_layout_fields (tab_id, field_key, display_order, col_span)
SELECT t.id, f.field_key, f.display_order, f.col_span
FROM public.form_layout_tabs t,
(VALUES 
  ('victim_name', 0, 1),
  ('victim_age', 1, 1),
  ('accident_date', 2, 1),
  ('case_type', 3, 1),
  ('accident_address', 4, 2),
  ('damage_description', 5, 2)
) AS f(field_key, display_order, col_span)
WHERE t.system_key = 'accident';

-- Seed fields for location tab
INSERT INTO public.form_layout_fields (tab_id, field_key, display_order, col_span)
SELECT t.id, f.field_key, f.display_order, f.col_span
FROM public.form_layout_tabs t,
(VALUES 
  ('visit_state', 0, 1),
  ('visit_city', 1, 1),
  ('visit_region', 2, 1),
  ('visit_address', 3, 2)
) AS f(field_key, display_order, col_span)
WHERE t.system_key = 'location';

-- Seed fields for companies tab
INSERT INTO public.form_layout_fields (tab_id, field_key, display_order, col_span)
SELECT t.id, f.field_key, f.display_order, f.col_span
FROM public.form_layout_tabs t,
(VALUES 
  ('contractor_company', 0, 1),
  ('main_company', 1, 1),
  ('sector', 2, 1),
  ('company_size_justification', 3, 2)
) AS f(field_key, display_order, col_span)
WHERE t.system_key = 'companies';

-- Seed fields for legal tab
INSERT INTO public.form_layout_fields (tab_id, field_key, display_order, col_span)
SELECT t.id, f.field_key, f.display_order, f.col_span
FROM public.form_layout_tabs t,
(VALUES 
  ('liability_type', 0, 1),
  ('news_link', 1, 1),
  ('legal_viability', 2, 2)
) AS f(field_key, display_order, col_span)
WHERE t.system_key = 'legal';
