# Mapa por domínio

Tabelas agrupadas. Para listagem ao vivo, rode `scripts/list-tables.sh`.

## CRM / Leads
leads, lead_activities, lead_followups, lead_processes, lead_stage_history, lead_status_history, lead_custom_fields, lead_custom_field_values, lead_financials, lead_whatsapp_groups, lead_enrichment_log, lead_group_audit_log, lead_checklist_instances, lead_sources, kanban_boards, contact_leads, card_assignments, field_stage_requirements

## Contatos
contacts, contact_classifications, contact_professions, contact_relationships, contact_relationship_types, beneficiaries, cbo_professions, ambassadors, ambassador_referrals, ambassador_campaigns, ambassador_member_links, ambassador_product_links

## WhatsApp (alto volume → Externo)
whatsapp_messages, whatsapp_instances, whatsapp_instance_users, whatsapp_conversation_agents, whatsapp_conversation_shares, whatsapp_internal_notes, whatsapp_groups_cache, whatsapp_muted_chats, whatsapp_private_conversations, whatsapp_command_history, whatsapp_command_config, whatsapp_notification_config, whatsapp_report_config, whatsapp_call_queue, whatsapp_campaigns, whatsapp_campaign_messages, whatsapp_agent_campaign_links, whatsapp_agent_followups, whatsapp_broadcast_lists, whatsapp_broadcast_list_contacts, broadcast_lists, broadcast_list_members, broadcast_list_agents, broadcast_sends, webhook_logs, archived_conversations, agent_*, wjia_*

## Jurídico
legal_cases, case_process_tracking, process_documents, process_movements, process_parties, process_movement_monitors, process_movement_notifications, specialized_nuclei, nucleus_companies, zapsign_documents, zapsign_generation_progress, onboarding_meeting_*, profile_oab_entries

## Marketing / Meta
meta_ad_accounts, meta_daily_metrics, meta_capi_config, ad_briefings, adset_geo_rules, promoted_posts, external_posts, instagram_*, manychat_*, ambassador_campaigns, campaign_status_log, campaign_action_history, conversion_alerts

## Financeiro
financial_entries, bank_transactions, credit_card_transactions, pluggy_connections, cost_accounts, cost_centers, expense_categories, expense_form_*, transaction_category_overrides, account_category_links, category_api_mappings, investments, loans, purchase_groups, user_account_permissions, user_card_permissions, commission_goals, commission_tiers

## Equipe / Auth (Cloud)
profiles, user_roles, access_profiles, member_module_permissions, member_area_assignments, member_positions, member_assistant_config, member_metric_goals, team_*, teams, team_members, team_invitations, team_conversation_*, team_chat_*, team_messages, career_plans, career_plan_steps, job_positions, user_sessions, user_activity_log, user_timeblock_settings, user_daily_goal_defaults, daily_goal_snapshots, weekly_evaluations, engagement_*, goal_history, outbound_goal_history, routine_process_goals, workflow_daily_goals, workflow_default_goals, workflow_reports, my_team_ranking (view)

## Atividades / Workflow
lead_activities, activity_attachments, activity_chat_messages, activity_message_templates, activity_field_settings, activity_types, checklist_templates, checklist_stage_links, form_layout_tabs, form_layout_fields, custom_voices, voice_preferences

## Configuração geral
system_settings, metric_definitions, metric_alerts (não existe? checar), audit_logs, migration_progress, changelog_acknowledgments, products_services, companies, company_areas, field_variable_aliases
