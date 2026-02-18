
-- Table to store Google OAuth tokens per user
CREATE TABLE IF NOT EXISTS public.google_oauth_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  scope TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.google_oauth_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own google tokens"
  ON public.google_oauth_tokens FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own google tokens"
  ON public.google_oauth_tokens FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own google tokens"
  ON public.google_oauth_tokens FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own google tokens"
  ON public.google_oauth_tokens FOR DELETE
  USING (auth.uid() = user_id);

-- Table to store scheduled actions (messages and calls)
CREATE TABLE IF NOT EXISTS public.google_scheduled_actions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('whatsapp_message', 'call')),
  contact_name TEXT,
  contact_phone TEXT,
  contact_instagram TEXT,
  message_text TEXT,
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  google_event_id TEXT,
  calendar_event_link TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.google_scheduled_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own scheduled actions"
  ON public.google_scheduled_actions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_google_oauth_tokens_updated_at
  BEFORE UPDATE ON public.google_oauth_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_google_scheduled_actions_updated_at
  BEFORE UPDATE ON public.google_scheduled_actions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
