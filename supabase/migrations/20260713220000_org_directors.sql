-- Diretoria (Supabase Externo) — "gestores dos gestores".
-- Diretores entram em todos os grupos de relatório diário e recebem o
-- relatório consolidado "📊 Diretoria — Gestores".
CREATE TABLE IF NOT EXISTS public.org_directors (
  user_id uuid PRIMARY KEY,
  name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.org_directors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_directors_authenticated_all ON public.org_directors;
CREATE POLICY org_directors_authenticated_all ON public.org_directors
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed: Raym (diretor atual, já usado como fallback no Railway)
INSERT INTO public.org_directors (user_id, name)
VALUES ('79c5c9d1-8629-4831-83cf-c86a7178521c', 'Raymsandreson de Morais Prudêncio')
ON CONFLICT (user_id) DO NOTHING;
