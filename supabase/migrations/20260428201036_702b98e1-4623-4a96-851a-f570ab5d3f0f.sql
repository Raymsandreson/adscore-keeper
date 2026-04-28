-- Phase C: Drop dead code from Cloud DB (logic migrated to External DB)

-- 1) Drop triggers blocking function removal
DROP TRIGGER IF EXISTS manage_schedule_cron_trigger ON public.n8n_comment_schedules;
DROP TRIGGER IF EXISTS trg_followup_on_generated ON public.wjia_collection_sessions;

-- 2) Drop orphan functions
DROP FUNCTION IF EXISTS public.execute_and_cleanup_followup(uuid, text);
DROP FUNCTION IF EXISTS public.schedule_followup_for_session(uuid, integer);
DROP FUNCTION IF EXISTS public.manage_comment_schedule_cron();
DROP FUNCTION IF EXISTS public.trigger_followup_on_generated();