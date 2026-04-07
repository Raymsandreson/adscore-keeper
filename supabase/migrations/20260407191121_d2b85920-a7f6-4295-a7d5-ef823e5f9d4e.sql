
-- Fix broken RLS policies

-- 1. Fix team_conversations SELECT policy
DROP POLICY "Members can view their conversations" ON public.team_conversations;
CREATE POLICY "Members can view their conversations"
  ON public.team_conversations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM team_conversation_members
    WHERE team_conversation_members.conversation_id = team_conversations.id
      AND team_conversation_members.user_id = auth.uid()
  ));

-- 2. Fix team_conversation_members SELECT policy
DROP POLICY "Members can view conversation memberships" ON public.team_conversation_members;
CREATE POLICY "Members can view conversation memberships"
  ON public.team_conversation_members FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM team_conversation_members m2
    WHERE m2.conversation_id = team_conversation_members.conversation_id
      AND m2.user_id = auth.uid()
  ));
