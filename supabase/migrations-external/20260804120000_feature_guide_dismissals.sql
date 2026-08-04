-- Dispensa do tour de funcionalidades (FeatureGuidePopup / "Não exibir mais").
-- Mora no Externo porque a migration equivalente no Cloud
-- (supabase/migrations/20260723120000_feature_guide_dismissals.sql) nunca foi
-- aplicada pelo publish do Lovable — a tabela não existe lá (PGRST205), e o tour
-- ficou dependendo só do localStorage: limpou cache / trocou de navegador /
-- storage bloqueado no preview → o tour voltava mesmo após "Não exibir mais".
-- user_id = UUID do Cloud (sem FK: auth.users é do outro projeto).
-- guide_id = id do guia em src/config/featureGuides.ts, ou '*' = todos os tours.
CREATE TABLE IF NOT EXISTS public.feature_guide_dismissals (
  user_id uuid NOT NULL,
  guide_id text NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, guide_id)
);

ALTER TABLE public.feature_guide_dismissals ENABLE ROW LEVEL SECURITY;

-- A sessão do Externo é anônima (auth.uid() != UUID do Cloud), então a policy
-- é aberta a authenticated. Conteúdo é só id de usuário + id de tela.
DROP POLICY IF EXISTS "guide dismissals - authenticated" ON public.feature_guide_dismissals;
CREATE POLICY "guide dismissals - authenticated" ON public.feature_guide_dismissals
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
