
-- Lock down instagram_accounts (contains OAuth tokens) to authenticated users only
DROP POLICY IF EXISTS "Allow public read instagram_accounts" ON public.instagram_accounts;
DROP POLICY IF EXISTS "Allow public insert instagram_accounts" ON public.instagram_accounts;
DROP POLICY IF EXISTS "Allow public update instagram_accounts" ON public.instagram_accounts;
DROP POLICY IF EXISTS "Allow public delete instagram_accounts" ON public.instagram_accounts;

CREATE POLICY "Authenticated can read instagram_accounts"
  ON public.instagram_accounts FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can insert instagram_accounts"
  ON public.instagram_accounts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can update instagram_accounts"
  ON public.instagram_accounts FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can delete instagram_accounts"
  ON public.instagram_accounts FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

-- instagram_metrics: keep public read (aggregate stats may be needed) but restrict writes
DROP POLICY IF EXISTS "Allow public insert instagram_metrics" ON public.instagram_metrics;
DROP POLICY IF EXISTS "Allow public update instagram_metrics" ON public.instagram_metrics;
DROP POLICY IF EXISTS "Allow public read instagram_metrics" ON public.instagram_metrics;

CREATE POLICY "Authenticated can read instagram_metrics"
  ON public.instagram_metrics FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can insert instagram_metrics"
  ON public.instagram_metrics FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can update instagram_metrics"
  ON public.instagram_metrics FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL);

-- expense_form_responses: policy mistakenly targets public; restrict to service_role
DROP POLICY IF EXISTS "Service role can manage responses" ON public.expense_form_responses;
CREATE POLICY "Service role can manage responses"
  ON public.expense_form_responses FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- group_creation_queue: redundant public ALL policy alongside authenticated ones; drop the public one
DROP POLICY IF EXISTS "Service role full access queue" ON public.group_creation_queue;
CREATE POLICY "Service role full access queue"
  ON public.group_creation_queue FOR ALL TO service_role
  USING (true) WITH CHECK (true);
