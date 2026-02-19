-- Add minute columns to support hours + minutes in time blocks
ALTER TABLE public.user_timeblock_settings 
ADD COLUMN IF NOT EXISTS start_minute integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS end_minute integer NOT NULL DEFAULT 0;