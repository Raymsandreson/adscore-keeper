-- Núcleos (agrupam setores) + cargo por membro de time (Supabase Externo).
-- Hierarquia: Diretoria → Núcleo → Setor → Time (gestor) → Membros (cargo).
CREATE TABLE IF NOT EXISTS public.org_nucleos (
  name text PRIMARY KEY,
  manager_user_id uuid,
  manager_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.org_nucleos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_nucleos_authenticated_all ON public.org_nucleos;
CREATE POLICY org_nucleos_authenticated_all ON public.org_nucleos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.org_sectors ADD COLUMN IF NOT EXISTS nucleo_name text;

CREATE TABLE IF NOT EXISTS public.team_member_cargos (
  team_name text NOT NULL,
  user_id uuid NOT NULL,
  cargo text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_name, user_id)
);
ALTER TABLE public.team_member_cargos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_member_cargos_authenticated_all ON public.team_member_cargos;
CREATE POLICY team_member_cargos_authenticated_all ON public.team_member_cargos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
