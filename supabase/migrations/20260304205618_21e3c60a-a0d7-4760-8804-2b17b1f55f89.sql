-- 1. user_card_permissions: 204K sequential scans!
CREATE INDEX IF NOT EXISTS idx_user_card_permissions_user_id ON public.user_card_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_card_permissions_card ON public.user_card_permissions(card_last_digits);

-- 2. contacts: 21K seq scans reading 64M tuples
CREATE INDEX IF NOT EXISTS idx_contacts_created_by ON public.contacts(created_by);
CREATE INDEX IF NOT EXISTS idx_contacts_classification ON public.contacts(classification);
CREATE INDEX IF NOT EXISTS idx_contacts_lead_id ON public.contacts(lead_id);
CREATE INDEX IF NOT EXISTS idx_contacts_instagram_username ON public.contacts(instagram_username);

-- 3. lead_activities: 10K seq scans reading 6M tuples
CREATE INDEX IF NOT EXISTS idx_lead_activities_lead_id ON public.lead_activities(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_activities_assigned_to ON public.lead_activities(assigned_to);
CREATE INDEX IF NOT EXISTS idx_lead_activities_status ON public.lead_activities(status);
CREATE INDEX IF NOT EXISTS idx_lead_activities_created_by ON public.lead_activities(created_by);

-- 4. whatsapp_messages: 594M tuples read via seq scan!
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone ON public.whatsapp_messages(phone);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_instance_name ON public.whatsapp_messages(instance_name);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_created_at ON public.whatsapp_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_external_id ON public.whatsapp_messages(external_message_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_lead_id ON public.whatsapp_messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_contact_id ON public.whatsapp_messages(contact_id);

-- 5. user_activity_log
CREATE INDEX IF NOT EXISTS idx_user_activity_log_user_id ON public.user_activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_log_created_at ON public.user_activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_log_action_type ON public.user_activity_log(action_type);

-- 6. workflow_default_goals: 4.8K seq scans with 0 idx scans
CREATE INDEX IF NOT EXISTS idx_workflow_default_goals_board_id ON public.workflow_default_goals(board_id);

-- 7. user_account_permissions
CREATE INDEX IF NOT EXISTS idx_user_account_permissions_user_id ON public.user_account_permissions(user_id);

-- 8. user_timeblock_settings
CREATE INDEX IF NOT EXISTS idx_user_timeblock_settings_user_id ON public.user_timeblock_settings(user_id);