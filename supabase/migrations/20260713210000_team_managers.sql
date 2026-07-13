-- Gestor por time (Supabase Externo) — usado pelo relatório diário do Railway.
-- Chaveada por NOME do time porque a UI (TeamsManager) lê teams do Cloud e o
-- relatório lê do Externo; o nome é o identificador estável entre os dois.
CREATE TABLE IF NOT EXISTS public.team_managers (
  team_name text PRIMARY KEY,
  team_id uuid,
  manager_user_id uuid NOT NULL,
  manager_name text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.team_managers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_managers_authenticated_all ON public.team_managers;
CREATE POLICY team_managers_authenticated_all ON public.team_managers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
