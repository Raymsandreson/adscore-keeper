-- Avaliação de feedback (funil de feedbacks) — Alternativa 3.
-- O observador avalia o retorno do responsável com estrelas (1–5) e um desfecho:
--   satisfeito | incompleto | insatisfeito.
--   - incompleto  → o RETORNO faltou info: volta ao responsável (popup) completar.
--   - insatisfeito → o TRABALHO não ficou bom: gera nova atividade de melhoria.
--   - satisfeito   → encerra (com elogio quando nota alta).
-- Justificativa obrigatória no 5⭐ (reconhecer) e no ≤2⭐ (construtivo) — via áudio ou texto.
-- Colunas em lead_activities (Externo). Guard de existência inofensivo.
--
-- Rollback:
--   ALTER TABLE public.lead_activities
--     DROP COLUMN IF EXISTS feedback_rating,
--     DROP COLUMN IF EXISTS feedback_outcome,
--     DROP COLUMN IF EXISTS feedback_rating_justification,
--     DROP COLUMN IF EXISTS feedback_praise,
--     DROP COLUMN IF EXISTS feedback_rated_by,
--     DROP COLUMN IF EXISTS feedback_rated_by_name,
--     DROP COLUMN IF EXISTS feedback_rated_at;
--   DROP INDEX IF EXISTS idx_lead_activities_feedback_outcome;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='lead_activities'
  ) THEN RETURN; END IF;

  ALTER TABLE public.lead_activities
    ADD COLUMN IF NOT EXISTS feedback_rating               smallint,   -- 1..5
    ADD COLUMN IF NOT EXISTS feedback_outcome              text,       -- satisfeito|incompleto|insatisfeito
    ADD COLUMN IF NOT EXISTS feedback_rating_justification text,       -- obrigatória no 5 e no <=2
    ADD COLUMN IF NOT EXISTS feedback_praise               text,       -- "1 coisa que ficou boa" (sanduíche)
    ADD COLUMN IF NOT EXISTS feedback_rated_by             uuid,       -- observador (UUID do Externo)
    ADD COLUMN IF NOT EXISTS feedback_rated_by_name        text,
    ADD COLUMN IF NOT EXISTS feedback_rated_at             timestamptz;
END $$;

-- Filtro do funil (só linhas já avaliadas; as "a avaliar" vêm por feedback NOT NULL).
CREATE INDEX IF NOT EXISTS idx_lead_activities_feedback_outcome
  ON public.lead_activities (feedback_outcome)
  WHERE feedback_outcome IS NOT NULL;
