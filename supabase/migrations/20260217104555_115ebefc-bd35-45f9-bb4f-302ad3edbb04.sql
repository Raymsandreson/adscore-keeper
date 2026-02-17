-- Create storage bucket for WhatsApp media
INSERT INTO storage.buckets (id, name, public) VALUES ('whatsapp-media', 'whatsapp-media', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access
CREATE POLICY "WhatsApp media publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'whatsapp-media');

-- Allow service role to upload (edge functions use service role)
CREATE POLICY "Service role can upload whatsapp media"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'whatsapp-media');
