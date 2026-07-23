-- Persiste a dispensa do tour de funcionalidades (FeatureGuidePopup / "Não exibir mais")
-- por usuário, no Cloud (gliigkupoebmlbwyvijp), onde mora auth.users.
-- Antes dependia só do localStorage, que não sobrevive a limpar cache, troca de
-- dispositivo, modo privado ou storage bloqueado no preview/iframe do Lovable —
-- por isso o tour reaparecia mesmo após "Não exibir mais".
-- guide_id = id do guia em src/config/featureGuides.ts (ex.: "cases", "leads").
CREATE TABLE IF NOT EXISTS public.feature_guide_dismissals (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  guide_id text NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, guide_id)
);

ALTER TABLE public.feature_guide_dismissals ENABLE ROW LEVEL SECURITY;

-- Cada usuário só enxerga e mexe nas próprias dispensas.
DROP POLICY IF EXISTS "own guide dismissals - select" ON public.feature_guide_dismissals;
CREATE POLICY "own guide dismissals - select" ON public.feature_guide_dismissals
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own guide dismissals - insert" ON public.feature_guide_dismissals;
CREATE POLICY "own guide dismissals - insert" ON public.feature_guide_dismissals
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- DELETE liberado só nas próprias linhas — permite um futuro "reexibir os tours".
DROP POLICY IF EXISTS "own guide dismissals - delete" ON public.feature_guide_dismissals;
CREATE POLICY "own guide dismissals - delete" ON public.feature_guide_dismissals
  FOR DELETE USING (auth.uid() = user_id);
