
-- Company areas table
CREATE TABLE public.company_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  icon TEXT,
  color TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.company_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view areas"
ON public.company_areas FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Admins can manage areas"
ON public.company_areas FOR ALL TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

-- Seed default areas
INSERT INTO public.company_areas (name, icon, display_order) VALUES
  ('Comercial', '💼', 1),
  ('Marketing', '📢', 2),
  ('Processual', '⚖️', 3),
  ('Administrativa', '🏢', 4),
  ('Financeira', '💰', 5),
  ('Operação', '⚙️', 6),
  ('Tecnologia', '💻', 7),
  ('Atendimento', '🎧', 8);

-- Metric definitions table
CREATE TABLE public.metric_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  area_id UUID REFERENCES public.company_areas(id) ON DELETE CASCADE NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('action', 'progress', 'result')),
  periodicity TEXT NOT NULL CHECK (periodicity IN ('daily', 'weekly', 'monthly')),
  unit TEXT DEFAULT '',
  calculation_formula TEXT,
  scope_type TEXT CHECK (scope_type IN ('funnel', 'workflow', 'global')),
  scope_id UUID,
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.metric_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view metrics"
ON public.metric_definitions FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Admins can manage metrics"
ON public.metric_definitions FOR ALL TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

-- Member area assignments
CREATE TABLE public.member_area_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  area_id UUID REFERENCES public.company_areas(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, area_id)
);

ALTER TABLE public.member_area_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view assignments"
ON public.member_area_assignments FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Admins can manage assignments"
ON public.member_area_assignments FOR ALL TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

-- Member metric goals
CREATE TABLE public.member_metric_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  metric_id UUID REFERENCES public.metric_definitions(id) ON DELETE CASCADE NOT NULL,
  target_value NUMERIC NOT NULL DEFAULT 0,
  period_type TEXT NOT NULL CHECK (period_type IN ('daily', 'weekly', 'monthly')),
  period_start DATE,
  period_end DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, metric_id, period_type, period_start)
);

ALTER TABLE public.member_metric_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own goals"
ON public.member_metric_goals FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

CREATE POLICY "Admins can manage goals"
ON public.member_metric_goals FOR ALL TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));
