
DROP POLICY IF EXISTS "Users can view their own profile or admins view all" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated can read directory fields" ON public.profiles;
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;

CREATE POLICY "Authenticated members can view team directory"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);
