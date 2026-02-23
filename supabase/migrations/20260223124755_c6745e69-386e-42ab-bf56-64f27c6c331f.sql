
-- Add expected_birth_date column to leads table for tracking birth due dates
ALTER TABLE public.leads ADD COLUMN expected_birth_date DATE;
