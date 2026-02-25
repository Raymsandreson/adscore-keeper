
-- Table for job positions (cargos)
CREATE TABLE public.job_positions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  department TEXT,
  level INTEGER NOT NULL DEFAULT 1,
  color TEXT DEFAULT '#6366f1',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table for career plan paths (progressão de carreira)
CREATE TABLE public.career_plan_steps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  from_position_id UUID REFERENCES public.job_positions(id) ON DELETE CASCADE,
  to_position_id UUID NOT NULL REFERENCES public.job_positions(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL DEFAULT 1,
  requirements TEXT,
  estimated_months INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Link members to positions
CREATE TABLE public.member_positions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  position_id UUID NOT NULL REFERENCES public.job_positions(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  notes TEXT,
  UNIQUE(user_id, position_id)
);

-- RLS
ALTER TABLE public.job_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.career_plan_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_positions ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read
CREATE POLICY "Authenticated users can read job_positions" ON public.job_positions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage job_positions" ON public.job_positions FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Authenticated users can read career_plan_steps" ON public.career_plan_steps FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage career_plan_steps" ON public.career_plan_steps FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Authenticated users can read member_positions" ON public.member_positions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage member_positions" ON public.member_positions FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- Update trigger
CREATE TRIGGER update_job_positions_updated_at BEFORE UPDATE ON public.job_positions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
