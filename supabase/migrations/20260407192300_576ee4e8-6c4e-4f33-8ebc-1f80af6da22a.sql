
INSERT INTO storage.buckets (id, name, public)
VALUES ('team-chat-media', 'team-chat-media', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload team chat media"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'team-chat-media' AND auth.uid() IS NOT NULL);

CREATE POLICY "Anyone can view team chat media"
ON storage.objects FOR SELECT
USING (bucket_id = 'team-chat-media');
