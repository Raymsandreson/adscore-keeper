
-- Remove FK constraint on wjia_followup_log.session_id to allow tracking agent conversation follow-ups
ALTER TABLE public.wjia_followup_log DROP CONSTRAINT IF EXISTS wjia_followup_log_session_id_fkey;
