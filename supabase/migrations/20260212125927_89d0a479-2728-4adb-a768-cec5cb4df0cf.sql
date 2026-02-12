
CREATE TABLE public.workflow_default_goals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  target_replies integer NOT NULL DEFAULT 20,
  target_dms integer NOT NULL DEFAULT 10,
  target_leads integer NOT NULL DEFAULT 5,
  target_session_minutes integer NOT NULL DEFAULT 60,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.workflow_default_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read defaults"
  ON public.workflow_default_goals FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage defaults"
  ON public.workflow_default_goals FOR ALL
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- Insert initial defaults
INSERT INTO public.workflow_default_goals (target_replies, target_dms, target_leads, target_session_minutes)
VALUES (20, 10, 5, 60);
