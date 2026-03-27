
CREATE TABLE public.profile_oab_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  oab_number TEXT NOT NULL,
  oab_uf TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, oab_number, oab_uf)
);

ALTER TABLE public.profile_oab_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view all OAB entries"
  ON public.profile_oab_entries FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can manage their own OAB entries"
  ON public.profile_oab_entries FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
