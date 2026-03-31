-- Fix Crisley's profile: ensure it matches auth.users exactly
-- First delete any stale profile, then recreate from auth.users
DELETE FROM public.profiles WHERE email = 'crisleyoliveira1978@outlook.com';

INSERT INTO public.profiles (user_id, full_name, email)
SELECT id, raw_user_meta_data->>'full_name', email 
FROM auth.users 
WHERE email = 'crisleyoliveira1978@outlook.com'
ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name;

-- Also ensure user_role exists
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role
FROM auth.users
WHERE email = 'crisleyoliveira1978@outlook.com'
ON CONFLICT (user_id, role) DO NOTHING;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';