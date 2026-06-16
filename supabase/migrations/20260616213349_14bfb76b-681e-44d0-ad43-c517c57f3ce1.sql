
-- Restrict anonymous (public role) SELECT on business tables to authenticated users only
DROP POLICY IF EXISTS "Anyone can view career plans" ON public.career_plans;
CREATE POLICY "Authenticated can view career plans" ON public.career_plans FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Anyone can read professions" ON public.cbo_professions;
CREATE POLICY "Authenticated can read professions" ON public.cbo_professions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Anyone can read field aliases" ON public.field_variable_aliases;
CREATE POLICY "Authenticated can read field aliases" ON public.field_variable_aliases FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Anyone can view nucleus_companies" ON public.nucleus_companies;
CREATE POLICY "Authenticated can view nucleus_companies" ON public.nucleus_companies FOR SELECT TO authenticated USING (true);

-- Restrict webhook_logs reads to admins only (contains raw PII payloads)
DROP POLICY IF EXISTS "Authenticated users can view webhook logs" ON public.webhook_logs;
CREATE POLICY "Admins can view webhook logs" ON public.webhook_logs FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
