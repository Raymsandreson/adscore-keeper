CREATE POLICY "Admins can update team_members"
ON public.team_members
FOR UPDATE
TO authenticated
USING (is_admin(auth.uid()))
WITH CHECK (is_admin(auth.uid()));