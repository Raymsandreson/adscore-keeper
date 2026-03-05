-- Drop the restrictive SELECT policy
DROP POLICY IF EXISTS "Users can view their own profile or admins can view all" ON public.profiles;

-- Create a new policy that allows all authenticated users to see all profiles
-- This is needed for team chat @mentions and member lists
CREATE POLICY "Authenticated users can view all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);