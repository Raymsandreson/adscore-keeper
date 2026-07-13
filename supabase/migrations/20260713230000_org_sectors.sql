-- Setores (Supabase Externo) — agrupam times; gerente de área opcional.
-- Hierarquia: Diretoria → Setor → Time (gestor) → Membros.
CREATE TABLE IF NOT EXISTS public.org_sectors (
  name text PRIMARY KEY,
  manager_user_id uuid,
  manager_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.org_sectors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_sectors_authenticated_all ON public.org_sectors;
CREATE POLICY org_sectors_authenticated_all ON public.org_sectors
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Time ganha setor; e team_managers passa a aceitar linha só com setor
-- (time setorizado mas ainda sem gestor definido)
ALTER TABLE public.team_managers ADD COLUMN IF NOT EXISTS sector_name text;
ALTER TABLE public.team_managers ALTER COLUMN manager_user_id DROP NOT NULL;
