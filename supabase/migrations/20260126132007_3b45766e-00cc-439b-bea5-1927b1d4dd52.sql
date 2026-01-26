-- Add profession field to contacts table
ALTER TABLE public.contacts 
ADD COLUMN IF NOT EXISTS profession TEXT,
ADD COLUMN IF NOT EXISTS profession_cbo_code TEXT;

-- Create table for CBO professions reference
CREATE TABLE IF NOT EXISTS public.cbo_professions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cbo_code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  family_code TEXT,
  family_title TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.cbo_professions ENABLE ROW LEVEL SECURITY;

-- Allow everyone to read professions
CREATE POLICY "Anyone can read professions" 
ON public.cbo_professions 
FOR SELECT 
USING (true);

-- Create index for faster searches
CREATE INDEX IF NOT EXISTS idx_cbo_professions_title ON public.cbo_professions USING gin(to_tsvector('portuguese', title));
CREATE INDEX IF NOT EXISTS idx_cbo_professions_code ON public.cbo_professions(cbo_code);