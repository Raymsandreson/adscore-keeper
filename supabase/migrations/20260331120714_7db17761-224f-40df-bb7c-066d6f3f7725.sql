-- Grant proper permissions to profiles and user_roles for authenticated users
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.profiles TO anon;

GRANT SELECT ON public.user_roles TO authenticated;
GRANT SELECT ON public.user_roles TO anon;

-- Grant usage on sequences if any
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;

-- Also grant on the view
GRANT SELECT ON public.whatsapp_ai_agents TO authenticated;
GRANT SELECT ON public.whatsapp_ai_agents TO anon;

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';