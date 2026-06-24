
CREATE OR REPLACE FUNCTION public.get_team_directory()
RETURNS TABLE(user_id uuid, full_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, p.full_name
  FROM public.profiles p
  WHERE p.full_name IS NOT NULL
  ORDER BY p.full_name;
$$;

REVOKE ALL ON FUNCTION public.get_team_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_team_directory() TO authenticated;
