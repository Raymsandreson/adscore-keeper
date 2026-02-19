
-- Per-user daily goal defaults (overrides global workflow_default_goals)
CREATE TABLE public.user_daily_goal_defaults (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  target_replies INTEGER NOT NULL DEFAULT 20,
  target_dms INTEGER NOT NULL DEFAULT 10,
  target_leads INTEGER NOT NULL DEFAULT 5,
  target_session_minutes INTEGER NOT NULL DEFAULT 60,
  target_contacts INTEGER NOT NULL DEFAULT 5,
  target_calls INTEGER NOT NULL DEFAULT 10,
  target_activities INTEGER NOT NULL DEFAULT 5,
  target_stage_changes INTEGER NOT NULL DEFAULT 10,
  target_leads_closed INTEGER NOT NULL DEFAULT 2,
  target_checklist_items INTEGER NOT NULL DEFAULT 10,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Daily goal achievement snapshots
CREATE TABLE public.daily_goal_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  progress_percent INTEGER NOT NULL DEFAULT 0,
  achieved BOOLEAN NOT NULL DEFAULT false,
  metrics_detail JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, snapshot_date)
);

-- Enable RLS
ALTER TABLE public.user_daily_goal_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_goal_snapshots ENABLE ROW LEVEL SECURITY;

-- RLS policies for user_daily_goal_defaults (admin can manage all, users can read their own)
CREATE POLICY "Admins can manage all user daily goal defaults"
ON public.user_daily_goal_defaults FOR ALL
USING (public.is_admin(auth.uid()));

CREATE POLICY "Users can read their own daily goal defaults"
ON public.user_daily_goal_defaults FOR SELECT
USING (auth.uid() = user_id);

-- RLS policies for daily_goal_snapshots
CREATE POLICY "Users can manage their own snapshots"
ON public.daily_goal_snapshots FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can read all snapshots"
ON public.daily_goal_snapshots FOR SELECT
USING (public.is_admin(auth.uid()));

-- Indexes
CREATE INDEX idx_daily_goal_snapshots_user_date ON public.daily_goal_snapshots(user_id, snapshot_date);
CREATE INDEX idx_daily_goal_snapshots_achieved ON public.daily_goal_snapshots(user_id, achieved, snapshot_date);

-- Triggers for updated_at
CREATE TRIGGER update_user_daily_goal_defaults_updated_at
BEFORE UPDATE ON public.user_daily_goal_defaults
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_daily_goal_snapshots_updated_at
BEFORE UPDATE ON public.daily_goal_snapshots
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
