
-- agent_reply_locks
DROP POLICY IF EXISTS "Service role full access on reply locks" ON public.agent_reply_locks;
CREATE POLICY "Service role full access on reply locks" ON public.agent_reply_locks
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- call_events_pending
DROP POLICY IF EXISTS "Service role full access" ON public.call_events_pending;
CREATE POLICY "Service role full access" ON public.call_events_pending
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- call_field_suggestions
DROP POLICY IF EXISTS "Service role can insert suggestions" ON public.call_field_suggestions;
CREATE POLICY "Service role can insert suggestions" ON public.call_field_suggestions
  FOR INSERT TO service_role WITH CHECK (true);

-- campaign_status_log
DROP POLICY IF EXISTS "Service role can manage campaign status logs" ON public.campaign_status_log;
CREATE POLICY "Service role can manage campaign status logs" ON public.campaign_status_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- engagement_*
DROP POLICY IF EXISTS "Allow all access to engagement_champions" ON public.engagement_champions;
CREATE POLICY "Authenticated access to engagement_champions" ON public.engagement_champions
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Allow all access to engagement_championship_settings" ON public.engagement_championship_settings;
CREATE POLICY "Authenticated access to engagement_championship_settings" ON public.engagement_championship_settings
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Allow all access to engagement_goals" ON public.engagement_goals;
CREATE POLICY "Authenticated access to engagement_goals" ON public.engagement_goals
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Allow all access to engagement_rankings" ON public.engagement_rankings;
CREATE POLICY "Authenticated access to engagement_rankings" ON public.engagement_rankings
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- instagram_*
DROP POLICY IF EXISTS "Allow all access to instagram_auto_replies" ON public.instagram_auto_replies;
CREATE POLICY "Authenticated access to instagram_auto_replies" ON public.instagram_auto_replies
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Allow all access to instagram_comments" ON public.instagram_comments;
CREATE POLICY "Authenticated access to instagram_comments" ON public.instagram_comments
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- instagram_accounts: restrict to admins only (contains OAuth access tokens)
DROP POLICY IF EXISTS "Authenticated can read instagram_accounts" ON public.instagram_accounts;
DROP POLICY IF EXISTS "Authenticated can insert instagram_accounts" ON public.instagram_accounts;
DROP POLICY IF EXISTS "Authenticated can update instagram_accounts" ON public.instagram_accounts;
DROP POLICY IF EXISTS "Authenticated can delete instagram_accounts" ON public.instagram_accounts;
CREATE POLICY "Admins can read instagram_accounts" ON public.instagram_accounts
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert instagram_accounts" ON public.instagram_accounts
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update instagram_accounts" ON public.instagram_accounts
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete instagram_accounts" ON public.instagram_accounts
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- n8n_automation_logs
DROP POLICY IF EXISTS "Service role can insert logs" ON public.n8n_automation_logs;
CREATE POLICY "Service role can insert logs" ON public.n8n_automation_logs
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view their own automation logs" ON public.n8n_automation_logs;
CREATE POLICY "Users can view their own automation logs" ON public.n8n_automation_logs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own logs" ON public.n8n_automation_logs;
CREATE POLICY "Users can delete their own logs" ON public.n8n_automation_logs
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- whatsapp_messages: restrict public service role policies
DROP POLICY IF EXISTS "Service role can select whatsapp messages" ON public.whatsapp_messages;
CREATE POLICY "Service role can select whatsapp messages" ON public.whatsapp_messages
  FOR SELECT TO service_role USING (true);

DROP POLICY IF EXISTS "Service role can insert whatsapp messages" ON public.whatsapp_messages;
CREATE POLICY "Service role can insert whatsapp messages" ON public.whatsapp_messages
  FOR INSERT TO service_role WITH CHECK (true);

-- Re-scope the {public} authenticated policies to the authenticated role only
DROP POLICY IF EXISTS "Authenticated users can view whatsapp messages" ON public.whatsapp_messages;
CREATE POLICY "Authenticated users can view whatsapp messages" ON public.whatsapp_messages
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can insert whatsapp messages" ON public.whatsapp_messages;
CREATE POLICY "Authenticated users can insert whatsapp messages" ON public.whatsapp_messages
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can update whatsapp messages" ON public.whatsapp_messages;
CREATE POLICY "Authenticated users can update whatsapp messages" ON public.whatsapp_messages
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can delete whatsapp messages" ON public.whatsapp_messages;
CREATE POLICY "Authenticated users can delete whatsapp messages" ON public.whatsapp_messages
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- whatsapp_muted_chats: drop anon
DROP POLICY IF EXISTS "Allow all for anon" ON public.whatsapp_muted_chats;
