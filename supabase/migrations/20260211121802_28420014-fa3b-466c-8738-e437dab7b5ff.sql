
-- Weekly evaluations table
CREATE TABLE public.weekly_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluator_id uuid NOT NULL,
  evaluated_id uuid NOT NULL,
  is_self_evaluation boolean NOT NULL DEFAULT false,
  week_start date NOT NULL,
  week_end date NOT NULL,
  -- Scores 1-5
  punctuality_score integer CHECK (punctuality_score BETWEEN 1 AND 5),
  communication_score integer CHECK (communication_score BETWEEN 1 AND 5),
  proactivity_score integer CHECK (proactivity_score BETWEEN 1 AND 5),
  quality_score integer CHECK (quality_score BETWEEN 1 AND 5),
  teamwork_score integer CHECK (teamwork_score BETWEEN 1 AND 5),
  overall_score numeric GENERATED ALWAYS AS (
    (COALESCE(punctuality_score,0) + COALESCE(communication_score,0) + COALESCE(proactivity_score,0) + COALESCE(quality_score,0) + COALESCE(teamwork_score,0))::numeric / 5.0
  ) STORED,
  strengths text,
  improvements text,
  comments text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(evaluator_id, evaluated_id, week_start)
);

ALTER TABLE public.weekly_evaluations ENABLE ROW LEVEL SECURITY;

-- Users can insert their own evaluations
CREATE POLICY "Users can insert evaluations they author"
ON public.weekly_evaluations FOR INSERT
WITH CHECK (evaluator_id = auth.uid());

-- Users can update their own evaluations
CREATE POLICY "Users can update their own evaluations"
ON public.weekly_evaluations FOR UPDATE
USING (evaluator_id = auth.uid());

-- Users can see evaluations they gave or received, admins see all
CREATE POLICY "Users can view relevant evaluations"
ON public.weekly_evaluations FOR SELECT
USING (
  evaluator_id = auth.uid() 
  OR evaluated_id = auth.uid() 
  OR is_admin(auth.uid())
);

-- Users can delete their own evaluations
CREATE POLICY "Users can delete their own evaluations"
ON public.weekly_evaluations FOR DELETE
USING (evaluator_id = auth.uid());

-- Trigger for updated_at
CREATE TRIGGER update_weekly_evaluations_updated_at
BEFORE UPDATE ON public.weekly_evaluations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
