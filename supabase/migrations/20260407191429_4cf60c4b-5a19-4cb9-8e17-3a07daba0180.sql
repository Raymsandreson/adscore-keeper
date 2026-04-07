DROP POLICY IF EXISTS "Authenticated users can add members" ON public.team_conversation_members;
CREATE POLICY "Authenticated users can add members"
ON public.team_conversation_members
FOR INSERT
WITH CHECK (user_id = auth.uid());