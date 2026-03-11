
CREATE TABLE public.manychat_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id TEXT,
  subscriber_name TEXT,
  platform TEXT DEFAULT 'instagram',
  direction TEXT DEFAULT 'outbound',
  message_text TEXT,
  ai_generated_reply TEXT,
  flow_id TEXT,
  comment_id TEXT,
  post_url TEXT,
  status TEXT DEFAULT 'sent',
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.manychat_interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view manychat interactions"
ON public.manychat_interactions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert manychat interactions"
ON public.manychat_interactions FOR INSERT TO authenticated WITH CHECK (true);
