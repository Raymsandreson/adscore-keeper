-- Status de acesso por usuário (Supabase Externo).
-- active=false → UserStatusGuard desloga o usuário ao abrir o app.
CREATE TABLE IF NOT EXISTS public.org_user_status (
  user_id uuid PRIMARY KEY,
  name text,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.org_user_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_user_status_authenticated_all ON public.org_user_status;
CREATE POLICY org_user_status_authenticated_all ON public.org_user_status
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
