
-- ============================================================
-- 1) LEADS: lock down (PII — victim names, phones, case data)
-- ============================================================
DROP POLICY IF EXISTS "Anyone can read leads" ON public.leads;
DROP POLICY IF EXISTS "Anyone can insert leads" ON public.leads;
DROP POLICY IF EXISTS "Anyone can update leads" ON public.leads;
DROP POLICY IF EXISTS "Anyone can delete leads" ON public.leads;

CREATE POLICY "Authenticated users can read leads"
ON public.leads FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert leads"
ON public.leads FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update leads"
ON public.leads FOR UPDATE TO authenticated
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can delete leads"
ON public.leads FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));


-- ============================================================
-- 2) Operational tables: require authentication for writes
-- ============================================================

-- ai_conversation_history
DROP POLICY IF EXISTS "Allow public delete" ON public.ai_conversation_history;
DROP POLICY IF EXISTS "Allow public insert" ON public.ai_conversation_history;
DROP POLICY IF EXISTS "Allow public read" ON public.ai_conversation_history;
CREATE POLICY "Authenticated read ai_conversation_history" ON public.ai_conversation_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert ai_conversation_history" ON public.ai_conversation_history FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated delete ai_conversation_history" ON public.ai_conversation_history FOR DELETE TO authenticated USING (true);

-- card_assignments
DROP POLICY IF EXISTS "Anyone can read card_assignments" ON public.card_assignments;
DROP POLICY IF EXISTS "Anyone can insert card_assignments" ON public.card_assignments;
DROP POLICY IF EXISTS "Anyone can update card_assignments" ON public.card_assignments;
DROP POLICY IF EXISTS "Anyone can delete card_assignments" ON public.card_assignments;
CREATE POLICY "Authenticated read card_assignments" ON public.card_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert card_assignments" ON public.card_assignments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update card_assignments" ON public.card_assignments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete card_assignments" ON public.card_assignments FOR DELETE TO authenticated USING (true);

-- cat_lead_contacts
DROP POLICY IF EXISTS "Anyone can read cat_lead_contacts" ON public.cat_lead_contacts;
DROP POLICY IF EXISTS "Anyone can insert cat_lead_contacts" ON public.cat_lead_contacts;
DROP POLICY IF EXISTS "Anyone can update cat_lead_contacts" ON public.cat_lead_contacts;
DROP POLICY IF EXISTS "Anyone can delete cat_lead_contacts" ON public.cat_lead_contacts;
CREATE POLICY "Authenticated read cat_lead_contacts" ON public.cat_lead_contacts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert cat_lead_contacts" ON public.cat_lead_contacts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update cat_lead_contacts" ON public.cat_lead_contacts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete cat_lead_contacts" ON public.cat_lead_contacts FOR DELETE TO authenticated USING (true);

-- contact_leads
DROP POLICY IF EXISTS "Anyone can read contact_leads" ON public.contact_leads;
DROP POLICY IF EXISTS "Anyone can insert contact_leads" ON public.contact_leads;
DROP POLICY IF EXISTS "Anyone can update contact_leads" ON public.contact_leads;
DROP POLICY IF EXISTS "Anyone can delete contact_leads" ON public.contact_leads;
CREATE POLICY "Authenticated read contact_leads" ON public.contact_leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert contact_leads" ON public.contact_leads FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update contact_leads" ON public.contact_leads FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete contact_leads" ON public.contact_leads FOR DELETE TO authenticated USING (true);

-- contact_professions
DROP POLICY IF EXISTS "Allow public read access to contact_professions" ON public.contact_professions;
DROP POLICY IF EXISTS "Allow public insert access to contact_professions" ON public.contact_professions;
DROP POLICY IF EXISTS "Allow public update access to contact_professions" ON public.contact_professions;
DROP POLICY IF EXISTS "Allow public delete access to contact_professions" ON public.contact_professions;
CREATE POLICY "Authenticated read contact_professions" ON public.contact_professions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert contact_professions" ON public.contact_professions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update contact_professions" ON public.contact_professions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete contact_professions" ON public.contact_professions FOR DELETE TO authenticated USING (true);

-- contact_relationships
DROP POLICY IF EXISTS "Anyone can read contact_relationships" ON public.contact_relationships;
DROP POLICY IF EXISTS "Anyone can insert contact_relationships" ON public.contact_relationships;
DROP POLICY IF EXISTS "Anyone can update contact_relationships" ON public.contact_relationships;
DROP POLICY IF EXISTS "Anyone can delete contact_relationships" ON public.contact_relationships;
CREATE POLICY "Authenticated read contact_relationships" ON public.contact_relationships FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert contact_relationships" ON public.contact_relationships FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update contact_relationships" ON public.contact_relationships FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete contact_relationships" ON public.contact_relationships FOR DELETE TO authenticated USING (true);

-- cost_accounts
DROP POLICY IF EXISTS "Anyone can read cost_accounts" ON public.cost_accounts;
DROP POLICY IF EXISTS "Anyone can insert cost_accounts" ON public.cost_accounts;
DROP POLICY IF EXISTS "Anyone can update cost_accounts" ON public.cost_accounts;
DROP POLICY IF EXISTS "Anyone can delete cost_accounts" ON public.cost_accounts;
CREATE POLICY "Authenticated read cost_accounts" ON public.cost_accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert cost_accounts" ON public.cost_accounts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update cost_accounts" ON public.cost_accounts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete cost_accounts" ON public.cost_accounts FOR DELETE TO authenticated USING (true);

-- expense_categories
DROP POLICY IF EXISTS "Anyone can read expense_categories" ON public.expense_categories;
DROP POLICY IF EXISTS "Anyone can insert expense_categories" ON public.expense_categories;
DROP POLICY IF EXISTS "Anyone can update expense_categories" ON public.expense_categories;
DROP POLICY IF EXISTS "Anyone can delete expense_categories" ON public.expense_categories;
CREATE POLICY "Authenticated read expense_categories" ON public.expense_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert expense_categories" ON public.expense_categories FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update expense_categories" ON public.expense_categories FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete expense_categories" ON public.expense_categories FOR DELETE TO authenticated USING (is_system = false);

-- field_stage_requirements
DROP POLICY IF EXISTS "Users can manage field stage requirements" ON public.field_stage_requirements;
CREATE POLICY "Authenticated manage field_stage_requirements" ON public.field_stage_requirements FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- goal_history
DROP POLICY IF EXISTS "Allow all access to goal_history" ON public.goal_history;
CREATE POLICY "Authenticated manage goal_history" ON public.goal_history FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- kanban_boards
DROP POLICY IF EXISTS "Anyone can read kanban_boards" ON public.kanban_boards;
DROP POLICY IF EXISTS "Anyone can insert kanban_boards" ON public.kanban_boards;
DROP POLICY IF EXISTS "Anyone can update kanban_boards" ON public.kanban_boards;
DROP POLICY IF EXISTS "Anyone can delete kanban_boards" ON public.kanban_boards;
CREATE POLICY "Authenticated read kanban_boards" ON public.kanban_boards FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert kanban_boards" ON public.kanban_boards FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update kanban_boards" ON public.kanban_boards FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Admins delete kanban_boards" ON public.kanban_boards FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- lead_custom_field_values
DROP POLICY IF EXISTS "Anyone can read lead_custom_field_values" ON public.lead_custom_field_values;
DROP POLICY IF EXISTS "Anyone can insert lead_custom_field_values" ON public.lead_custom_field_values;
DROP POLICY IF EXISTS "Anyone can update lead_custom_field_values" ON public.lead_custom_field_values;
DROP POLICY IF EXISTS "Anyone can delete lead_custom_field_values" ON public.lead_custom_field_values;
CREATE POLICY "Authenticated read lead_custom_field_values" ON public.lead_custom_field_values FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert lead_custom_field_values" ON public.lead_custom_field_values FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update lead_custom_field_values" ON public.lead_custom_field_values FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete lead_custom_field_values" ON public.lead_custom_field_values FOR DELETE TO authenticated USING (true);

-- lead_custom_fields
DROP POLICY IF EXISTS "Anyone can read lead_custom_fields" ON public.lead_custom_fields;
DROP POLICY IF EXISTS "Anyone can insert lead_custom_fields" ON public.lead_custom_fields;
DROP POLICY IF EXISTS "Anyone can update lead_custom_fields" ON public.lead_custom_fields;
DROP POLICY IF EXISTS "Anyone can delete lead_custom_fields" ON public.lead_custom_fields;
CREATE POLICY "Authenticated read lead_custom_fields" ON public.lead_custom_fields FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert lead_custom_fields" ON public.lead_custom_fields FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update lead_custom_fields" ON public.lead_custom_fields FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete lead_custom_fields" ON public.lead_custom_fields FOR DELETE TO authenticated USING (true);

-- lead_followups
DROP POLICY IF EXISTS "Anyone can read lead_followups" ON public.lead_followups;
DROP POLICY IF EXISTS "Anyone can insert lead_followups" ON public.lead_followups;
DROP POLICY IF EXISTS "Anyone can update lead_followups" ON public.lead_followups;
DROP POLICY IF EXISTS "Anyone can delete lead_followups" ON public.lead_followups;
CREATE POLICY "Authenticated read lead_followups" ON public.lead_followups FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert lead_followups" ON public.lead_followups FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update lead_followups" ON public.lead_followups FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete lead_followups" ON public.lead_followups FOR DELETE TO authenticated USING (true);

-- lead_stage_history
DROP POLICY IF EXISTS "Anyone can read lead_stage_history" ON public.lead_stage_history;
DROP POLICY IF EXISTS "Anyone can insert lead_stage_history" ON public.lead_stage_history;
DROP POLICY IF EXISTS "Anyone can delete lead_stage_history" ON public.lead_stage_history;
CREATE POLICY "Authenticated read lead_stage_history" ON public.lead_stage_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert lead_stage_history" ON public.lead_stage_history FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Admins delete lead_stage_history" ON public.lead_stage_history FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- n8n_comment_schedules
DROP POLICY IF EXISTS "Anyone can read schedules" ON public.n8n_comment_schedules;
DROP POLICY IF EXISTS "Anyone can insert schedules" ON public.n8n_comment_schedules;
DROP POLICY IF EXISTS "Anyone can update schedules" ON public.n8n_comment_schedules;
DROP POLICY IF EXISTS "Anyone can delete schedules" ON public.n8n_comment_schedules;
CREATE POLICY "Authenticated read schedules" ON public.n8n_comment_schedules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert schedules" ON public.n8n_comment_schedules FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update schedules" ON public.n8n_comment_schedules FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete schedules" ON public.n8n_comment_schedules FOR DELETE TO authenticated USING (true);

-- outbound_goal_history
DROP POLICY IF EXISTS "Anyone can read outbound_goal_history" ON public.outbound_goal_history;
DROP POLICY IF EXISTS "Anyone can insert outbound_goal_history" ON public.outbound_goal_history;
DROP POLICY IF EXISTS "Anyone can delete outbound_goal_history" ON public.outbound_goal_history;
CREATE POLICY "Authenticated read outbound_goal_history" ON public.outbound_goal_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert outbound_goal_history" ON public.outbound_goal_history FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated delete outbound_goal_history" ON public.outbound_goal_history FOR DELETE TO authenticated USING (true);

-- promoted_posts
DROP POLICY IF EXISTS "Allow all access to promoted_posts" ON public.promoted_posts;
CREATE POLICY "Authenticated manage promoted_posts" ON public.promoted_posts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- transaction_category_overrides
DROP POLICY IF EXISTS "Anyone can read transaction_category_overrides" ON public.transaction_category_overrides;
DROP POLICY IF EXISTS "Anyone can insert transaction_category_overrides" ON public.transaction_category_overrides;
DROP POLICY IF EXISTS "Anyone can update transaction_category_overrides" ON public.transaction_category_overrides;
DROP POLICY IF EXISTS "Anyone can delete transaction_category_overrides" ON public.transaction_category_overrides;
CREATE POLICY "Authenticated read transaction_category_overrides" ON public.transaction_category_overrides FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert transaction_category_overrides" ON public.transaction_category_overrides FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update transaction_category_overrides" ON public.transaction_category_overrides FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete transaction_category_overrides" ON public.transaction_category_overrides FOR DELETE TO authenticated USING (true);


-- ============================================================
-- 3) WHATSAPP_INSTANCES: hide instance_token from non-admins
--    Use column-level grants so the token is not selectable by
--    regular authenticated users, even if RLS lets them read rows.
-- ============================================================

-- Keep the existing "Admins can manage instances" policy untouched.
-- Drop the broad SELECT policy and replace with one that allows
-- authenticated users to read rows (column grants protect the token).
DROP POLICY IF EXISTS "Authenticated users can view instances" ON public.whatsapp_instances;

CREATE POLICY "Authenticated can read instance metadata"
ON public.whatsapp_instances FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);

-- Column-level: revoke SELECT on the whole table, regrant only safe cols
REVOKE SELECT ON public.whatsapp_instances FROM authenticated;
GRANT SELECT (
  id, instance_name, owner_phone, base_url, is_active,
  created_at, updated_at, receive_leads, ad_account_id, ad_account_name,
  auto_identify_sender, is_paused, default_agent_id, voice_id, voice_name,
  owner_name, notify_on_disconnect, notify_start_hour, notify_end_hour,
  notify_weekdays_only
) ON public.whatsapp_instances TO authenticated;

-- Service role keeps full access (it bypasses RLS and column grants)


-- ============================================================
-- 4) STORAGE: drop broad SELECT policies that allow listing
--    Public bucket direct path access still works for known files.
-- ============================================================
DROP POLICY IF EXISTS "Public read access for ad creatives" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view chat files" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view activity attachments" ON storage.objects;
DROP POLICY IF EXISTS "WhatsApp media publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view invoices" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can read knowledge docs" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view team chat media" ON storage.objects;

-- Re-create SELECT as authenticated-only (blocks anonymous listing)
CREATE POLICY "Authenticated read ad-creatives"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ad-creatives');

CREATE POLICY "Authenticated read activity-chat"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'activity-chat');

CREATE POLICY "Authenticated read activity-attachments"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'activity-attachments');

CREATE POLICY "Authenticated read whatsapp-media"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'whatsapp-media');

CREATE POLICY "Authenticated read invoices"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'invoices');

CREATE POLICY "Authenticated read agent-knowledge"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'agent-knowledge');

CREATE POLICY "Authenticated read team-chat-media"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'team-chat-media');
