
-- Simplify handle_new_user: Cloud DB no longer stores profiles as source of truth
-- Just return NEW so login never fails
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Minimal: just ensure a basic profile row exists in Cloud for compatibility
  -- The REAL profile lives in external DB, synced by sync-user-to-external edge function
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- NEVER block login
  RAISE WARNING 'handle_new_user skipped: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- Also simplify auto_assign: same fail-safe approach
CREATE OR REPLACE FUNCTION public.auto_assign_first_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Role assignment is handled by sync-user-to-external
  -- Keep minimal Cloud assignment for compatibility
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'member')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'auto_assign skipped: %', SQLERRM;
  RETURN NEW;
END;
$$;
