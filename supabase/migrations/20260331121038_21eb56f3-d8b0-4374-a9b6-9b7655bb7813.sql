-- Make handle_new_user idempotent and fail-safe so it NEVER blocks auth login
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email, oab_number, oab_uf)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.email,
    NEW.raw_user_meta_data->>'oab_number',
    NEW.raw_user_meta_data->>'oab_uf'
  )
  ON CONFLICT (user_id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- NEVER block auth - log and continue
  RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- Make auto_assign_first_admin fail-safe too
CREATE OR REPLACE FUNCTION public.auto_assign_first_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.team_invitations 
      WHERE email = NEW.email AND accepted_at IS NULL AND expires_at > now()
    ) THEN
      INSERT INTO public.user_roles (user_id, role)
      SELECT NEW.id, ti.role
      FROM public.team_invitations ti
      WHERE ti.email = NEW.email AND ti.accepted_at IS NULL
      LIMIT 1
      ON CONFLICT (user_id, role) DO NOTHING;
      
      UPDATE public.team_invitations
      SET accepted_at = now()
      WHERE email = NEW.email AND accepted_at IS NULL;
    ELSE
      INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'member')
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'auto_assign_first_admin failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- Ensure all public tables have proper grants
DO $$
DECLARE
  tbl RECORD;
BEGIN
  FOR tbl IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', tbl.tablename);
    EXECUTE format('GRANT SELECT ON public.%I TO anon', tbl.tablename);
  END LOOP;
END;
$$;

-- Reload
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';