-- Add client classification column to leads table
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS client_classification text DEFAULT NULL;

-- Add check constraint for valid values
ALTER TABLE public.leads ADD CONSTRAINT leads_client_classification_check 
CHECK (client_classification IS NULL OR client_classification IN ('client', 'non_client', 'prospect'));