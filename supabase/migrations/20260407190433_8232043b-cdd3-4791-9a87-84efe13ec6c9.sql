-- Team conversations table
CREATE TABLE public.team_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'direct' CHECK (type IN ('direct', 'group')),
  name TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Conversation members
CREATE TABLE public.team_conversation_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.team_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  last_read_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(conversation_id, user_id)
);

-- Messages
CREATE TABLE public.team_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.team_conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL,
  sender_name TEXT,
  content TEXT,
  message_type TEXT NOT NULL DEFAULT 'text',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_team_messages_conversation ON public.team_messages(conversation_id, created_at DESC);
CREATE INDEX idx_team_conversation_members_user ON public.team_conversation_members(user_id);
CREATE INDEX idx_team_messages_sender ON public.team_messages(sender_id);

-- Enable RLS
ALTER TABLE public.team_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_messages ENABLE ROW LEVEL SECURITY;

-- RLS: Users can see conversations they're members of
CREATE POLICY "Members can view their conversations"
ON public.team_conversations FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.team_conversation_members
    WHERE conversation_id = id AND user_id = auth.uid()
  )
);

-- RLS: Any authenticated user can create conversations
CREATE POLICY "Authenticated users can create conversations"
ON public.team_conversations FOR INSERT TO authenticated
WITH CHECK (true);

-- RLS: Members table - users can see memberships for their conversations
CREATE POLICY "Members can view conversation memberships"
ON public.team_conversation_members FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.team_conversation_members m2
    WHERE m2.conversation_id = conversation_id AND m2.user_id = auth.uid()
  )
);

-- RLS: Authenticated users can add members
CREATE POLICY "Authenticated users can add members"
ON public.team_conversation_members FOR INSERT TO authenticated
WITH CHECK (true);

-- RLS: Users can update their own membership (last_read_at)
CREATE POLICY "Users can update own membership"
ON public.team_conversation_members FOR UPDATE TO authenticated
USING (user_id = auth.uid());

-- RLS: Messages - users can see messages in their conversations
CREATE POLICY "Members can view messages"
ON public.team_messages FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.team_conversation_members
    WHERE conversation_id = team_messages.conversation_id AND user_id = auth.uid()
  )
);

-- RLS: Members can send messages in their conversations
CREATE POLICY "Members can send messages"
ON public.team_messages FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid() AND
  EXISTS (
    SELECT 1 FROM public.team_conversation_members
    WHERE conversation_id = team_messages.conversation_id AND user_id = auth.uid()
  )
);

-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.team_messages;

-- Update trigger for conversations
CREATE TRIGGER update_team_conversations_updated_at
BEFORE UPDATE ON public.team_conversations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();