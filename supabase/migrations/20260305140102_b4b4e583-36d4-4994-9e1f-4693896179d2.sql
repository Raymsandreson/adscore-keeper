
-- Team chat messages table (entity-agnostic)
CREATE TABLE public.team_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL, -- 'lead', 'activity', 'contact', 'workflow'
  entity_id TEXT NOT NULL,
  entity_name TEXT,
  content TEXT NOT NULL,
  sender_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  sender_name TEXT,
  reply_to_id UUID REFERENCES public.team_chat_messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Mentions tracking table
CREATE TABLE public.team_chat_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES public.team_chat_messages(id) ON DELETE CASCADE NOT NULL,
  mentioned_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_name TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_team_chat_messages_entity ON public.team_chat_messages(entity_type, entity_id);
CREATE INDEX idx_team_chat_messages_sender ON public.team_chat_messages(sender_id);
CREATE INDEX idx_team_chat_mentions_user ON public.team_chat_mentions(mentioned_user_id, is_read);
CREATE INDEX idx_team_chat_mentions_message ON public.team_chat_mentions(message_id);

-- Enable RLS
ALTER TABLE public.team_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_chat_mentions ENABLE ROW LEVEL SECURITY;

-- RLS policies for team_chat_messages (all authenticated users can read/write)
CREATE POLICY "Authenticated users can read team chat messages"
  ON public.team_chat_messages FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert team chat messages"
  ON public.team_chat_messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "Users can update own team chat messages"
  ON public.team_chat_messages FOR UPDATE TO authenticated
  USING (auth.uid() = sender_id);

-- RLS policies for team_chat_mentions
CREATE POLICY "Users can read own mentions"
  ON public.team_chat_mentions FOR SELECT TO authenticated
  USING (mentioned_user_id = auth.uid());

CREATE POLICY "Authenticated users can insert mentions"
  ON public.team_chat_mentions FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update own mentions (mark read)"
  ON public.team_chat_mentions FOR UPDATE TO authenticated
  USING (mentioned_user_id = auth.uid());

-- Enable realtime for team chat
ALTER PUBLICATION supabase_realtime ADD TABLE public.team_chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.team_chat_mentions;
