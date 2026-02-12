
ALTER TABLE public.workflow_default_goals
ADD COLUMN IF NOT EXISTS target_contacts integer NOT NULL DEFAULT 5,
ADD COLUMN IF NOT EXISTS target_calls integer NOT NULL DEFAULT 10,
ADD COLUMN IF NOT EXISTS target_activities integer NOT NULL DEFAULT 5,
ADD COLUMN IF NOT EXISTS target_stage_changes integer NOT NULL DEFAULT 10,
ADD COLUMN IF NOT EXISTS target_leads_closed integer NOT NULL DEFAULT 2,
ADD COLUMN IF NOT EXISTS target_checklist_items integer NOT NULL DEFAULT 10;
