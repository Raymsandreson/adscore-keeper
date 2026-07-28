-- Enforce ownership linkage on uploads
DROP POLICY IF EXISTS "Authenticated users can upload activity attachments" ON storage.objects;
CREATE POLICY "Authenticated users can upload activity attachments"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'activity-attachments' AND owner = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can upload chat files" ON storage.objects;
CREATE POLICY "Authenticated users can upload chat files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'activity-chat' AND owner = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can upload invoices" ON storage.objects;
CREATE POLICY "Authenticated users can upload invoices"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'invoices' AND owner = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can upload knowledge docs" ON storage.objects;
CREATE POLICY "Authenticated users can upload knowledge docs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'agent-knowledge' AND owner = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can upload team chat media" ON storage.objects;
CREATE POLICY "Authenticated users can upload team chat media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'team-chat-media' AND owner = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can upload creatives" ON storage.objects;
CREATE POLICY "Authenticated users can upload creatives"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ad-creatives' AND owner = auth.uid());

-- Was open to anon (role public, no auth condition)
DROP POLICY IF EXISTS "Service role can upload whatsapp media" ON storage.objects;
CREATE POLICY "Service role can upload whatsapp media"
  ON storage.objects FOR INSERT TO service_role
  WITH CHECK (bucket_id = 'whatsapp-media');
CREATE POLICY "Authenticated users can upload whatsapp media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'whatsapp-media' AND owner = auth.uid());
