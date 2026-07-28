-- 1) Legacy backup table: enable RLS, admin-only read
ALTER TABLE public.backup_templates_20260722 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_templates_20260722 FROM anon;
GRANT SELECT ON public.backup_templates_20260722 TO authenticated;
GRANT ALL ON public.backup_templates_20260722 TO service_role;
DROP POLICY IF EXISTS "Admins can read backup_templates_20260722" ON public.backup_templates_20260722;
CREATE POLICY "Admins can read backup_templates_20260722"
  ON public.backup_templates_20260722 FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

-- 2) lead_processes: was fully open to anon (role public, USING true)
DROP POLICY IF EXISTS "Authenticated users can manage lead_processes" ON public.lead_processes;
REVOKE ALL ON public.lead_processes FROM anon;
CREATE POLICY "Admins or owners can read lead_processes"
  ON public.lead_processes FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR created_by = auth.uid());
CREATE POLICY "Authenticated can insert own lead_processes"
  ON public.lead_processes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND (created_by IS NULL OR created_by = auth.uid()));
CREATE POLICY "Admins or owners can update lead_processes"
  ON public.lead_processes FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()) OR created_by = auth.uid())
  WITH CHECK (public.is_admin(auth.uid()) OR created_by = auth.uid());
CREATE POLICY "Admins or owners can delete lead_processes"
  ON public.lead_processes FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR created_by = auth.uid());

-- 3) zapsign_documents
DROP POLICY IF EXISTS "Authenticated users can view documents" ON public.zapsign_documents;
DROP POLICY IF EXISTS "Authenticated users can create documents" ON public.zapsign_documents;
DROP POLICY IF EXISTS "Authenticated users can update documents" ON public.zapsign_documents;
DROP POLICY IF EXISTS "Authenticated users can delete documents" ON public.zapsign_documents;
REVOKE ALL ON public.zapsign_documents FROM anon;
CREATE POLICY "Admins or owners can read zapsign_documents"
  ON public.zapsign_documents FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR created_by = auth.uid());
CREATE POLICY "Authenticated can insert zapsign_documents"
  ON public.zapsign_documents FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND (created_by IS NULL OR created_by = auth.uid()));
CREATE POLICY "Admins or owners can update zapsign_documents"
  ON public.zapsign_documents FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()) OR created_by = auth.uid())
  WITH CHECK (public.is_admin(auth.uid()) OR created_by = auth.uid());
CREATE POLICY "Admins or owners can delete zapsign_documents"
  ON public.zapsign_documents FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR created_by = auth.uid());

-- 4) process_documents
DROP POLICY IF EXISTS "Authenticated users can view process documents" ON public.process_documents;
DROP POLICY IF EXISTS "Authenticated users can insert process documents" ON public.process_documents;
DROP POLICY IF EXISTS "Authenticated users can update process documents" ON public.process_documents;
DROP POLICY IF EXISTS "Authenticated users can delete process documents" ON public.process_documents;
REVOKE ALL ON public.process_documents FROM anon;
CREATE POLICY "Admins or uploaders can read process_documents"
  ON public.process_documents FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR uploaded_by = auth.uid());
CREATE POLICY "Authenticated can insert process_documents"
  ON public.process_documents FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND (uploaded_by IS NULL OR uploaded_by = auth.uid()));
CREATE POLICY "Admins or uploaders can update process_documents"
  ON public.process_documents FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()) OR uploaded_by = auth.uid())
  WITH CHECK (public.is_admin(auth.uid()) OR uploaded_by = auth.uid());
CREATE POLICY "Admins or uploaders can delete process_documents"
  ON public.process_documents FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR uploaded_by = auth.uid());

-- 5) lead_financials
DROP POLICY IF EXISTS "Authenticated users can view lead financials" ON public.lead_financials;
DROP POLICY IF EXISTS "Authenticated users can insert lead financials" ON public.lead_financials;
DROP POLICY IF EXISTS "Authenticated users can update lead financials" ON public.lead_financials;
DROP POLICY IF EXISTS "Authenticated users can delete lead financials" ON public.lead_financials;
REVOKE ALL ON public.lead_financials FROM anon;
CREATE POLICY "Admins or owners can read lead_financials"
  ON public.lead_financials FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR created_by = auth.uid());
CREATE POLICY "Authenticated can insert lead_financials"
  ON public.lead_financials FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND (created_by IS NULL OR created_by = auth.uid()));
CREATE POLICY "Admins or owners can update lead_financials"
  ON public.lead_financials FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()) OR created_by = auth.uid())
  WITH CHECK (public.is_admin(auth.uid()) OR created_by = auth.uid());
CREATE POLICY "Admins or owners can delete lead_financials"
  ON public.lead_financials FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR created_by = auth.uid());

-- 6) cat_lead_contacts (admin-only, no ownership column)
DROP POLICY IF EXISTS "Authenticated read cat_lead_contacts" ON public.cat_lead_contacts;
DROP POLICY IF EXISTS "Authenticated insert cat_lead_contacts" ON public.cat_lead_contacts;
DROP POLICY IF EXISTS "Authenticated update cat_lead_contacts" ON public.cat_lead_contacts;
DROP POLICY IF EXISTS "Authenticated delete cat_lead_contacts" ON public.cat_lead_contacts;
REVOKE ALL ON public.cat_lead_contacts FROM anon;
CREATE POLICY "Admins manage cat_lead_contacts"
  ON public.cat_lead_contacts FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- 7) ambassadors (admin-only)
DROP POLICY IF EXISTS "Authenticated users can manage ambassadors" ON public.ambassadors;
DROP POLICY IF EXISTS "Authenticated users can view ambassadors" ON public.ambassadors;
REVOKE ALL ON public.ambassadors FROM anon;
CREATE POLICY "Admins manage ambassadors"
  ON public.ambassadors FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- 8) card_assignments (admin-only)
DROP POLICY IF EXISTS "Authenticated read card_assignments" ON public.card_assignments;
DROP POLICY IF EXISTS "Authenticated insert card_assignments" ON public.card_assignments;
DROP POLICY IF EXISTS "Authenticated update card_assignments" ON public.card_assignments;
DROP POLICY IF EXISTS "Authenticated delete card_assignments" ON public.card_assignments;
REVOKE ALL ON public.card_assignments FROM anon;
CREATE POLICY "Admins manage card_assignments"
  ON public.card_assignments FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- 9) lead_activities: was granted to role public with only auth.uid() IS NOT NULL
DROP POLICY IF EXISTS "Authenticated users can view activities" ON public.lead_activities;
DROP POLICY IF EXISTS "Authenticated users can create activities" ON public.lead_activities;
DROP POLICY IF EXISTS "Authenticated users can update activities" ON public.lead_activities;
DROP POLICY IF EXISTS "Authenticated users can delete activities" ON public.lead_activities;
REVOKE ALL ON public.lead_activities FROM anon;
CREATE POLICY "Admins or involved users can read lead_activities"
  ON public.lead_activities FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR created_by = auth.uid() OR assigned_to = auth.uid());
CREATE POLICY "Authenticated can insert lead_activities"
  ON public.lead_activities FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND (created_by IS NULL OR created_by = auth.uid()));
CREATE POLICY "Admins or involved users can update lead_activities"
  ON public.lead_activities FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()) OR created_by = auth.uid() OR assigned_to = auth.uid())
  WITH CHECK (public.is_admin(auth.uid()) OR created_by = auth.uid() OR assigned_to = auth.uid());
CREATE POLICY "Admins or owners can delete lead_activities"
  ON public.lead_activities FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR created_by = auth.uid());

-- 10) meta_ad_accounts: plaintext OAuth tokens -> owner/admin only
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='meta_ad_accounts' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.meta_ad_accounts', p.policyname);
  END LOOP;
END $$;
REVOKE ALL ON public.meta_ad_accounts FROM anon;
CREATE POLICY "Owners or admins manage meta_ad_accounts"
  ON public.meta_ad_accounts FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR user_id = auth.uid())
  WITH CHECK (public.is_admin(auth.uid()) OR user_id = auth.uid());
