
-- 1. activity_field_settings: restrict to authenticated role
DROP POLICY IF EXISTS "Anyone can read activity_field_settings" ON public.activity_field_settings;
DROP POLICY IF EXISTS "Authenticated users can insert activity_field_settings" ON public.activity_field_settings;
DROP POLICY IF EXISTS "Authenticated users can update activity_field_settings" ON public.activity_field_settings;

CREATE POLICY "Authenticated can read activity_field_settings"
  ON public.activity_field_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert activity_field_settings"
  ON public.activity_field_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update activity_field_settings"
  ON public.activity_field_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 2. contact_classifications: require auth
DROP POLICY IF EXISTS "Classifications are viewable by everyone" ON public.contact_classifications;
DROP POLICY IF EXISTS "Users can create classifications" ON public.contact_classifications;
DROP POLICY IF EXISTS "Users can update non-system classifications" ON public.contact_classifications;
DROP POLICY IF EXISTS "Users can delete non-system classifications" ON public.contact_classifications;

CREATE POLICY "Authenticated can read classifications"
  ON public.contact_classifications FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can create classifications"
  ON public.contact_classifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update non-system classifications"
  ON public.contact_classifications FOR UPDATE TO authenticated USING (is_system = false) WITH CHECK (is_system = false);
CREATE POLICY "Authenticated can delete non-system classifications"
  ON public.contact_classifications FOR DELETE TO authenticated USING (is_system = false);

-- 3. contact_relationship_types: require auth
DROP POLICY IF EXISTS "Anyone can read relationship_types" ON public.contact_relationship_types;
DROP POLICY IF EXISTS "Anyone can insert relationship_types" ON public.contact_relationship_types;
DROP POLICY IF EXISTS "Users can update non-system types" ON public.contact_relationship_types;
DROP POLICY IF EXISTS "Users can delete non-system types" ON public.contact_relationship_types;

CREATE POLICY "Authenticated can read relationship_types"
  ON public.contact_relationship_types FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert relationship_types"
  ON public.contact_relationship_types FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update non-system types"
  ON public.contact_relationship_types FOR UPDATE TO authenticated USING (is_system = false) WITH CHECK (is_system = false);
CREATE POLICY "Authenticated can delete non-system types"
  ON public.contact_relationship_types FOR DELETE TO authenticated USING (is_system = false);

-- 4. pluggy_connections: scope SELECT to owner only (card permission cross-check was unscoped)
DROP POLICY IF EXISTS "Users can view connections they have access to" ON public.pluggy_connections;
DROP POLICY IF EXISTS "Users can insert their own connections" ON public.pluggy_connections;
DROP POLICY IF EXISTS "Users can update their own connections" ON public.pluggy_connections;
DROP POLICY IF EXISTS "Users can delete their own connections" ON public.pluggy_connections;

CREATE POLICY "Owners can view their connections"
  ON public.pluggy_connections FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Owners can insert their connections"
  ON public.pluggy_connections FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Owners can update their connections"
  ON public.pluggy_connections FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Owners can delete their connections"
  ON public.pluggy_connections FOR DELETE TO authenticated USING (user_id = auth.uid());
