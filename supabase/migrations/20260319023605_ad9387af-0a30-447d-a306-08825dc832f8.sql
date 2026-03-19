
-- Drop existing table and recreate for feature-level tracking
DROP TABLE IF EXISTS public.changelog_acknowledgments;

CREATE TABLE public.changelog_acknowledgments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  feature_title TEXT NOT NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, version, feature_title)
);

ALTER TABLE public.changelog_acknowledgments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own acknowledgments"
  ON public.changelog_acknowledgments FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own acknowledgments"
  ON public.changelog_acknowledgments FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());
