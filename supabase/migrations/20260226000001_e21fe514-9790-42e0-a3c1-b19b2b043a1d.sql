
-- Create career_plans table
CREATE TABLE public.career_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  department TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add career_plan_id to job_positions
ALTER TABLE public.job_positions ADD COLUMN career_plan_id UUID REFERENCES public.career_plans(id) ON DELETE CASCADE;

-- Enable RLS
ALTER TABLE public.career_plans ENABLE ROW LEVEL SECURITY;

-- RLS policies for career_plans
CREATE POLICY "Anyone can view career plans" ON public.career_plans FOR SELECT USING (true);
CREATE POLICY "Admins can manage career plans" ON public.career_plans FOR ALL USING (public.is_admin(auth.uid()));

-- Update trigger
CREATE TRIGGER update_career_plans_updated_at BEFORE UPDATE ON public.career_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
