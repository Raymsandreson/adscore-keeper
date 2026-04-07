DROP POLICY IF EXISTS "Members can view their conversations" ON public.team_conversations;
CREATE POLICY "Members can view their conversations"
ON public.team_conversations
FOR SELECT
USING (
  created_by = auth.uid()
  OR public.is_team_conversation_member(id, auth.uid())
);