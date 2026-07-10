-- Avaliação de atendimento (0–5 estrelas + motivo) enviada ao cliente por link público.
-- Tabela vive no Supabase EXTERNO (kmedldlepwiityjsdahz). Acesso de escrita do
-- cliente é feito SÓ via edge function (service role) — sem policy pública de write.
--
-- Rollback: DROP TABLE IF EXISTS public.service_ratings;

CREATE TABLE IF NOT EXISTS public.service_ratings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token        text UNIQUE NOT NULL,
  lead_id      uuid,
  lead_name    text,
  case_id      uuid,
  process_id   uuid,
  activity_id  uuid,
  assessor_id  uuid,
  assessor_name text,
  rating       smallint CHECK (rating BETWEEN 0 AND 5),
  reason       text,
  status       text NOT NULL DEFAULT 'pending',   -- 'pending' | 'submitted'
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_service_ratings_lead ON public.service_ratings (lead_id);
CREATE INDEX IF NOT EXISTS idx_service_ratings_assessor ON public.service_ratings (assessor_id);
CREATE INDEX IF NOT EXISTS idx_service_ratings_status ON public.service_ratings (status);

ALTER TABLE public.service_ratings ENABLE ROW LEVEL SECURITY;

-- Equipe autenticada pode ler as avaliações (para relatórios). Escrita do público
-- é exclusivamente via edge function com service role (bypassa RLS).
DROP POLICY IF EXISTS service_ratings_select_authenticated ON public.service_ratings;
CREATE POLICY service_ratings_select_authenticated
  ON public.service_ratings FOR SELECT
  TO authenticated
  USING (true);
