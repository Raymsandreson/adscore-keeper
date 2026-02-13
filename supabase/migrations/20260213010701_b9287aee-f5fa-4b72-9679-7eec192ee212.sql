
-- Create table for activity chat messages (WhatsApp-style)
CREATE TABLE public.activity_chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  activity_id UUID REFERENCES public.lead_activities(id) ON DELETE CASCADE,
  lead_id UUID,
  message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'audio', 'image', 'pdf', 'ai_suggestion')),
  content TEXT,
  file_url TEXT,
  file_name TEXT,
  file_size INTEGER,
  audio_duration INTEGER, -- duration in seconds
  ai_suggestion JSONB, -- stores suggested field values from AI
  sender_id UUID,
  sender_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.activity_chat_messages ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Authenticated users can view chat messages"
ON public.activity_chat_messages FOR SELECT
TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert chat messages"
ON public.activity_chat_messages FOR INSERT
TO authenticated WITH CHECK (true);

CREATE POLICY "Users can delete own messages"
ON public.activity_chat_messages FOR DELETE
TO authenticated USING (sender_id = auth.uid());

-- Indexes
CREATE INDEX idx_activity_chat_activity ON public.activity_chat_messages(activity_id);
CREATE INDEX idx_activity_chat_lead ON public.activity_chat_messages(lead_id);
CREATE INDEX idx_activity_chat_created ON public.activity_chat_messages(created_at);

-- Storage bucket for chat attachments
INSERT INTO storage.buckets (id, name, public) VALUES ('activity-chat', 'activity-chat', true);

-- Storage policies
CREATE POLICY "Authenticated users can upload chat files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'activity-chat');

CREATE POLICY "Anyone can view chat files"
ON storage.objects FOR SELECT
USING (bucket_id = 'activity-chat');

CREATE POLICY "Users can delete own chat files"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'activity-chat');
