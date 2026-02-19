ALTER TABLE public.lead_activities 
ADD COLUMN IF NOT EXISTS matrix_quadrant TEXT 
CHECK (matrix_quadrant IN ('do_now', 'schedule', 'delegate', 'eliminate') OR matrix_quadrant IS NULL);