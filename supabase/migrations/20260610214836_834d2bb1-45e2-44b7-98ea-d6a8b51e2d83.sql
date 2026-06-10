
-- account_category_links: restringir ao role authenticated
DROP POLICY IF EXISTS "Authenticated users can manage account category links" ON public.account_category_links;
CREATE POLICY "Authenticated users can manage account category links"
  ON public.account_category_links
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- campaign_action_history: restringir ao role authenticated
DROP POLICY IF EXISTS "Allow public insert" ON public.campaign_action_history;
DROP POLICY IF EXISTS "Allow public read" ON public.campaign_action_history;
CREATE POLICY "Authenticated can insert campaign action history"
  ON public.campaign_action_history
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
CREATE POLICY "Authenticated can read campaign action history"
  ON public.campaign_action_history
  FOR SELECT
  TO authenticated
  USING (true);

-- category_api_mappings: restringir ao role authenticated
DROP POLICY IF EXISTS "Anyone can delete category_api_mappings" ON public.category_api_mappings;
DROP POLICY IF EXISTS "Anyone can insert category_api_mappings" ON public.category_api_mappings;
DROP POLICY IF EXISTS "Anyone can read category_api_mappings" ON public.category_api_mappings;
DROP POLICY IF EXISTS "Anyone can update category_api_mappings" ON public.category_api_mappings;
CREATE POLICY "Authenticated can read category_api_mappings"
  ON public.category_api_mappings
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY "Authenticated can insert category_api_mappings"
  ON public.category_api_mappings
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
CREATE POLICY "Authenticated can update category_api_mappings"
  ON public.category_api_mappings
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
CREATE POLICY "Authenticated can delete category_api_mappings"
  ON public.category_api_mappings
  FOR DELETE
  TO authenticated
  USING (true);

-- products_services: restringir ao role authenticated
DROP POLICY IF EXISTS "Authenticated users can manage products_services" ON public.products_services;
CREATE POLICY "Authenticated users can manage products_services"
  ON public.products_services
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
