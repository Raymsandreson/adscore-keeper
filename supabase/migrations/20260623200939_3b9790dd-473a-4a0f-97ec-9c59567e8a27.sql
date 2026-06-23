
-- ============ 1) LEADS: lock down to admin-only (Cloud is legacy arquivo morto) ============
DROP POLICY IF EXISTS "Authenticated users can read leads" ON public.leads;
DROP POLICY IF EXISTS "Authenticated users can insert leads" ON public.leads;
DROP POLICY IF EXISTS "Authenticated users can update leads" ON public.leads;
CREATE POLICY "Admins can read leads" ON public.leads FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert leads" ON public.leads FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update leads" ON public.leads FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ 2) CONTACTS ============
DROP POLICY IF EXISTS "Authenticated users can read contacts" ON public.contacts;
DROP POLICY IF EXISTS "Authenticated users can insert contacts" ON public.contacts;
DROP POLICY IF EXISTS "Authenticated users can update contacts" ON public.contacts;
DROP POLICY IF EXISTS "Authenticated users can delete contacts" ON public.contacts;
CREATE POLICY "Admins can read contacts" ON public.contacts FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert contacts" ON public.contacts FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update contacts" ON public.contacts FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete contacts" ON public.contacts FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ 3) WHATSAPP_MESSAGES ============
DROP POLICY IF EXISTS "Authenticated users can view whatsapp messages" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "Authenticated users can read whatsapp messages" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "Authenticated users can insert whatsapp messages" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "Authenticated users can update whatsapp messages" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "Authenticated users can delete whatsapp messages" ON public.whatsapp_messages;
CREATE POLICY "Admins can read whatsapp_messages" ON public.whatsapp_messages FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert whatsapp_messages" ON public.whatsapp_messages FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update whatsapp_messages" ON public.whatsapp_messages FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete whatsapp_messages" ON public.whatsapp_messages FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ 4) CALL_RECORDS ============
DROP POLICY IF EXISTS "Authenticated users can view call records" ON public.call_records;
DROP POLICY IF EXISTS "Authenticated users can insert call records" ON public.call_records;
DROP POLICY IF EXISTS "Authenticated users can update call records" ON public.call_records;
DROP POLICY IF EXISTS "Authenticated users can delete call records" ON public.call_records;
CREATE POLICY "Admins can read call_records" ON public.call_records FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert call_records" ON public.call_records FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update call_records" ON public.call_records FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete call_records" ON public.call_records FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ 5) FINANCIAL_ENTRIES ============
DROP POLICY IF EXISTS "Authenticated users can view financial_entries" ON public.financial_entries;
DROP POLICY IF EXISTS "Authenticated users can insert financial_entries" ON public.financial_entries;
DROP POLICY IF EXISTS "Creators can update own financial_entries" ON public.financial_entries;
CREATE POLICY "Admins can read financial_entries" ON public.financial_entries FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can insert financial_entries" ON public.financial_entries FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can update financial_entries" ON public.financial_entries FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- ============ 6) PROFILES: own + admin only ============
DROP POLICY IF EXISTS "Authenticated users can view all profiles" ON public.profiles;
CREATE POLICY "Users view own profile or admins view all" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

-- ============ 7) CASE_PROCESS_TRACKING: drop senha_gov plaintext column ============
ALTER TABLE public.case_process_tracking DROP COLUMN IF EXISTS senha_gov;

-- ============ 8) Realtime: drop sensitive PII tables from publication ============
ALTER PUBLICATION supabase_realtime DROP TABLE public.leads;
ALTER PUBLICATION supabase_realtime DROP TABLE public.contacts;
ALTER PUBLICATION supabase_realtime DROP TABLE public.whatsapp_messages;
ALTER PUBLICATION supabase_realtime DROP TABLE public.call_records;
ALTER PUBLICATION supabase_realtime DROP TABLE public.financial_entries;
ALTER PUBLICATION supabase_realtime DROP TABLE public.case_process_tracking;
ALTER PUBLICATION supabase_realtime DROP TABLE public.zapsign_documents;

-- ============ 9) Storage objects: enforce owner-or-admin for DELETE/UPDATE ============
DROP POLICY IF EXISTS "Authenticated users can delete creatives" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete knowledge docs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete own activity attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete own invoices" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own chat files" ON storage.objects;

CREATE POLICY "Owners or admins can delete bucket files" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id IN ('ad-creatives','activity-chat','activity-attachments','whatsapp-media','invoices','agent-knowledge','team-chat-media')
    AND (owner = auth.uid() OR public.is_admin(auth.uid()))
  );

CREATE POLICY "Owners or admins can update bucket files" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id IN ('ad-creatives','activity-chat','activity-attachments','whatsapp-media','invoices','agent-knowledge','team-chat-media')
    AND (owner = auth.uid() OR public.is_admin(auth.uid()))
  )
  WITH CHECK (
    bucket_id IN ('ad-creatives','activity-chat','activity-attachments','whatsapp-media','invoices','agent-knowledge','team-chat-media')
    AND (owner = auth.uid() OR public.is_admin(auth.uid()))
  );
