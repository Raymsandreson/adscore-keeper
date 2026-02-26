
-- Add OTE compensation fields to job_positions
ALTER TABLE public.job_positions ADD COLUMN salary_fixed NUMERIC DEFAULT NULL;
ALTER TABLE public.job_positions ADD COLUMN salary_variable NUMERIC DEFAULT NULL;
ALTER TABLE public.job_positions ADD COLUMN ote_total NUMERIC DEFAULT NULL;
ALTER TABLE public.job_positions ADD COLUMN track_type TEXT DEFAULT 'ic' CHECK (track_type IN ('ic', 'management'));
ALTER TABLE public.job_positions ADD COLUMN allows_demotion BOOLEAN DEFAULT true;
ALTER TABLE public.job_positions ADD COLUMN demotion_note TEXT DEFAULT NULL;
