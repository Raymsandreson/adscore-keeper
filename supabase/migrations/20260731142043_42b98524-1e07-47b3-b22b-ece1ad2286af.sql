
-- ai_conversation_history: admin-only writes
DROP POLICY IF EXISTS "Authenticated insert ai_conversation_history" ON public.ai_conversation_history;
DROP POLICY IF EXISTS "Authenticated delete ai_conversation_history" ON public.ai_conversation_history;
CREATE POLICY "Admins insert ai_conversation_history" ON public.ai_conversation_history
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins delete ai_conversation_history" ON public.ai_conversation_history
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- campaign_action_history: admin-only writes
DROP POLICY IF EXISTS "Authenticated can insert campaign action history" ON public.campaign_action_history;
CREATE POLICY "Admins insert campaign action history" ON public.campaign_action_history
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- expense_categories: admin-only writes
DROP POLICY IF EXISTS "Authenticated insert expense_categories" ON public.expense_categories;
DROP POLICY IF EXISTS "Authenticated update expense_categories" ON public.expense_categories;
DROP POLICY IF EXISTS "Authenticated delete expense_categories" ON public.expense_categories;
CREATE POLICY "Admins insert expense_categories" ON public.expense_categories
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins update expense_categories" ON public.expense_categories
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins delete expense_categories" ON public.expense_categories
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role) AND is_system = false);

-- cost_accounts: admin-only writes
DROP POLICY IF EXISTS "Authenticated insert cost_accounts" ON public.cost_accounts;
DROP POLICY IF EXISTS "Authenticated update cost_accounts" ON public.cost_accounts;
DROP POLICY IF EXISTS "Authenticated delete cost_accounts" ON public.cost_accounts;
CREATE POLICY "Admins insert cost_accounts" ON public.cost_accounts
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins update cost_accounts" ON public.cost_accounts
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins delete cost_accounts" ON public.cost_accounts
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- transaction_category_overrides: admin-only writes
DROP POLICY IF EXISTS "Authenticated insert transaction_category_overrides" ON public.transaction_category_overrides;
DROP POLICY IF EXISTS "Authenticated update transaction_category_overrides" ON public.transaction_category_overrides;
DROP POLICY IF EXISTS "Authenticated delete transaction_category_overrides" ON public.transaction_category_overrides;
CREATE POLICY "Admins insert transaction_category_overrides" ON public.transaction_category_overrides
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins update transaction_category_overrides" ON public.transaction_category_overrides
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins delete transaction_category_overrides" ON public.transaction_category_overrides
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- contact_relationships / contact_professions / lead_custom_field_values / lead_followups:
-- deletes restricted to admins (members keep create/edit for daily work)
DROP POLICY IF EXISTS "Authenticated delete contact_relationships" ON public.contact_relationships;
CREATE POLICY "Admins delete contact_relationships" ON public.contact_relationships
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Authenticated delete contact_professions" ON public.contact_professions;
CREATE POLICY "Admins delete contact_professions" ON public.contact_professions
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Authenticated delete lead_custom_field_values" ON public.lead_custom_field_values;
CREATE POLICY "Admins delete lead_custom_field_values" ON public.lead_custom_field_values
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Authenticated delete lead_followups" ON public.lead_followups;
CREATE POLICY "Admins delete lead_followups" ON public.lead_followups
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- call_field_suggestions (realtime): update only by admin or the reviewer
DROP POLICY IF EXISTS "Authenticated users can update suggestions" ON public.call_field_suggestions;
CREATE POLICY "Reviewer or admin can update suggestions" ON public.call_field_suggestions
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR reviewed_by IS NULL OR reviewed_by = auth.uid())
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR reviewed_by = auth.uid());

-- team_chat_messages (realtime): allow authors/admins to delete their own messages explicitly
DROP POLICY IF EXISTS "Authors or admins delete team chat messages" ON public.team_chat_messages;
CREATE POLICY "Authors or admins delete team chat messages" ON public.team_chat_messages
  FOR DELETE TO authenticated
  USING (auth.uid() = sender_id OR public.has_role(auth.uid(), 'admin'::app_role));
