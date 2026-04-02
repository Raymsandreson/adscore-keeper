
-- Add is_system flag to access_profiles
ALTER TABLE public.access_profiles ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

-- Add access_profile_id to user_roles to track applied profile
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS access_profile_id uuid REFERENCES public.access_profiles(id) ON DELETE SET NULL;

-- Insert system Admin profile
INSERT INTO public.access_profiles (name, description, is_system, is_active, module_permissions, whatsapp_instance_ids)
VALUES (
  'Administrador',
  'Acesso total ao sistema. Perfil fixo e não editável.',
  true,
  true,
  '[{"module_key":"activities","access_level":"edit"},{"module_key":"leads","access_level":"edit"},{"module_key":"analytics","access_level":"edit"},{"module_key":"finance","access_level":"edit"},{"module_key":"instagram","access_level":"edit"},{"module_key":"calls","access_level":"edit"},{"module_key":"whatsapp","access_level":"edit"},{"module_key":"whatsapp_private","access_level":"edit"},{"module_key":"contacts","access_level":"edit"},{"module_key":"team_management","access_level":"edit"}]'::jsonb,
  '{}'
)
ON CONFLICT DO NOTHING;

-- Link existing admin roles to the Admin profile
UPDATE public.user_roles 
SET access_profile_id = (SELECT id FROM public.access_profiles WHERE is_system = true AND name = 'Administrador' LIMIT 1)
WHERE role = 'admin' AND access_profile_id IS NULL;
