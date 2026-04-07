CREATE OR REPLACE FUNCTION public.start_team_direct_conversation(_other_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _conversation_id uuid;
BEGIN
  SELECT tc.id
    INTO _conversation_id
  FROM public.team_conversations tc
  JOIN public.team_conversation_members me
    ON me.conversation_id = tc.id AND me.user_id = auth.uid()
  JOIN public.team_conversation_members other_member
    ON other_member.conversation_id = tc.id AND other_member.user_id = _other_user_id
  WHERE tc.type = 'direct'
  LIMIT 1;

  IF _conversation_id IS NOT NULL THEN
    RETURN _conversation_id;
  END IF;

  INSERT INTO public.team_conversations (type, created_by)
  VALUES ('direct', auth.uid())
  RETURNING id INTO _conversation_id;

  INSERT INTO public.team_conversation_members (conversation_id, user_id)
  VALUES (_conversation_id, auth.uid()), (_conversation_id, _other_user_id)
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN _conversation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_team_general_conversation()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _conversation_id uuid;
BEGIN
  SELECT id
    INTO _conversation_id
  FROM public.team_conversations
  WHERE type = 'group'
    AND name = '💬 Chat Geral da Equipe'
  ORDER BY created_at ASC
  LIMIT 1;

  IF _conversation_id IS NULL THEN
    INSERT INTO public.team_conversations (type, name, created_by)
    VALUES ('group', '💬 Chat Geral da Equipe', auth.uid())
    RETURNING id INTO _conversation_id;
  END IF;

  INSERT INTO public.team_conversation_members (conversation_id, user_id)
  VALUES (_conversation_id, auth.uid())
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN _conversation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_team_direct_conversation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_team_general_conversation() TO authenticated;