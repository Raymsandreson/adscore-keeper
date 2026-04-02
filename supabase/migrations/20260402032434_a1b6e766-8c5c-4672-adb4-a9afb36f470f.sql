-- Access profile templates
CREATE TABLE public.access_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  module_permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  whatsapp_instance_ids UUID[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.access_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view active profiles"
  ON public.access_profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage access profiles"
  ON public.access_profiles FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE TRIGGER update_access_profiles_updated_at
  BEFORE UPDATE ON public.access_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Link invitation to a profile template
ALTER TABLE public.team_invitations
  ADD COLUMN IF NOT EXISTS access_profile_id UUID REFERENCES public.access_profiles(id);