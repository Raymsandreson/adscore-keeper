CREATE TABLE IF NOT EXISTS public.auth_uuid_mapping (
  cloud_uuid uuid PRIMARY KEY,
  ext_uuid uuid NOT NULL,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_uuid_mapping_ext ON public.auth_uuid_mapping(ext_uuid);
CREATE INDEX IF NOT EXISTS idx_auth_uuid_mapping_email ON public.auth_uuid_mapping(email);

ALTER TABLE public.auth_uuid_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_can_view_mapping" ON public.auth_uuid_mapping
  FOR SELECT USING (public.is_admin(auth.uid()));