-- ============================================================
-- FIX 1: Lock down `contacts` table (PII exposure to anon)
-- ============================================================
-- Currently 4 policies grant full anon access (USING/WITH CHECK = true)
-- exposing 8,681 contacts with names, phones, emails, addresses, Instagram.
-- Replace with authenticated-only policies. Edge functions use
-- SERVICE_ROLE_KEY, which bypasses RLS, so backend flows are unaffected.

DROP POLICY IF EXISTS "Anyone can read contacts" ON public.contacts;
DROP POLICY IF EXISTS "Anyone can insert contacts" ON public.contacts;
DROP POLICY IF EXISTS "Anyone can update contacts" ON public.contacts;
DROP POLICY IF EXISTS "Anyone can delete contacts" ON public.contacts;

CREATE POLICY "Authenticated users can read contacts"
  ON public.contacts
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert contacts"
  ON public.contacts
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update contacts"
  ON public.contacts
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete contacts"
  ON public.contacts
  FOR DELETE
  TO authenticated
  USING (true);

-- ============================================================
-- FIX 2: Convert `whatsapp_ai_agents` view to security_invoker
-- ============================================================
-- The view currently runs with creator's privileges (SECURITY DEFINER
-- behavior), bypassing RLS on wjia_command_shortcuts. Switch to
-- security_invoker so the querying user's RLS applies.

ALTER VIEW public.whatsapp_ai_agents SET (security_invoker = on);
