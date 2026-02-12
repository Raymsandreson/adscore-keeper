
-- Commission goal configurations (admin defines goals per member or team)
CREATE TABLE public.commission_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  metric_key text NOT NULL, -- 'leads_created', 'leads_progressed', 'deals_closed', 'steps', 'stages', 'velocity'
  target_value numeric NOT NULL DEFAULT 0,
  period text NOT NULL DEFAULT 'monthly', -- 'weekly', 'monthly'
  period_start date NOT NULL DEFAULT date_trunc('month', CURRENT_DATE)::date,
  period_end date NOT NULL DEFAULT (date_trunc('month', CURRENT_DATE) + interval '1 month' - interval '1 day')::date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT goal_scope CHECK (
    (user_id IS NOT NULL AND team_id IS NULL) OR
    (user_id IS NULL AND team_id IS NOT NULL)
  )
);

-- Commission tiers (escalated bands)
CREATE TABLE public.commission_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid REFERENCES public.commission_goals(id) ON DELETE CASCADE NOT NULL,
  min_percent numeric NOT NULL DEFAULT 0,
  max_percent numeric NOT NULL DEFAULT 100,
  commission_value numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.commission_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_tiers ENABLE ROW LEVEL SECURITY;

-- Only admins can manage goals and tiers
CREATE POLICY "Admins can manage commission_goals" ON public.commission_goals
  FOR ALL USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Authenticated can view commission_goals" ON public.commission_goals
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage commission_tiers" ON public.commission_tiers
  FOR ALL USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Authenticated can view commission_tiers" ON public.commission_tiers
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE TRIGGER update_commission_goals_updated_at
  BEFORE UPDATE ON public.commission_goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
