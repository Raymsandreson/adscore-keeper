-- Allow admins to view all profiles
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile or admins can view all"
ON public.profiles FOR SELECT
USING ((auth.uid() = user_id) OR is_admin(auth.uid()));

-- Allow admins to update all profiles
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile or admins can update all"
ON public.profiles FOR UPDATE
USING ((auth.uid() = user_id) OR is_admin(auth.uid()));