CREATE OR REPLACE FUNCTION public.is_team_conversation_member(_conversation_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_conversation_members
    WHERE conversation_id = _conversation_id
      AND user_id = _user_id
  )
$$;

DROP POLICY IF EXISTS "Members can view their conversations" ON public.team_conversations;
CREATE POLICY "Members can view their conversations"
ON public.team_conversations
FOR SELECT
USING (public.is_team_conversation_member(id, auth.uid()));

DROP POLICY IF EXISTS "Members can view conversation memberships" ON public.team_conversation_members;
CREATE POLICY "Members can view conversation memberships"
ON public.team_conversation_members
FOR SELECT
USING (public.is_team_conversation_member(conversation_id, auth.uid()));

DROP POLICY IF EXISTS "Members can send messages" ON public.team_messages;
CREATE POLICY "Members can send messages"
ON public.team_messages
FOR INSERT
WITH CHECK (
  sender_id = auth.uid()
  AND public.is_team_conversation_member(conversation_id, auth.uid())
);

DROP POLICY IF EXISTS "Members can view messages" ON public.team_messages;
CREATE POLICY "Members can view messages"
ON public.team_messages
FOR SELECT
USING (public.is_team_conversation_member(conversation_id, auth.uid()));