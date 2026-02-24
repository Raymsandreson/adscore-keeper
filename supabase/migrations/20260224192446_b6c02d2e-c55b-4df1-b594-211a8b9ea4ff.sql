
-- Table to store processual (daily) goals linked to activity types in the user's routine
CREATE TABLE public.routine_process_goals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  activity_type TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  target_value INTEGER NOT NULL DEFAULT 0,
  board_id UUID REFERENCES public.kanban_boards(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX idx_routine_process_goals_user ON public.routine_process_goals(user_id);
CREATE UNIQUE INDEX idx_routine_process_goals_unique ON public.routine_process_goals(user_id, activity_type, metric_key, COALESCE(board_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- RLS
ALTER TABLE public.routine_process_goals ENABLE ROW LEVEL SECURITY;

-- Users can read their own + admins can read all
CREATE POLICY "Users can read own routine goals"
  ON public.routine_process_goals FOR SELECT
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

-- Users can insert their own + admins can insert for anyone
CREATE POLICY "Users can insert own routine goals"
  ON public.routine_process_goals FOR INSERT
  WITH CHECK (auth.uid() = user_id OR public.is_admin(auth.uid()));

-- Users can update their own + admins can update for anyone
CREATE POLICY "Users can update own routine goals"
  ON public.routine_process_goals FOR UPDATE
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

-- Users can delete their own + admins can delete for anyone
CREATE POLICY "Users can delete own routine goals"
  ON public.routine_process_goals FOR DELETE
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

-- Updated_at trigger
CREATE TRIGGER update_routine_process_goals_updated_at
  BEFORE UPDATE ON public.routine_process_goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
