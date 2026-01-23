-- Add column to track if classification should show in reply workflow
ALTER TABLE public.contact_classifications 
ADD COLUMN IF NOT EXISTS show_in_workflow boolean NOT NULL DEFAULT true;

-- Update existing rows to show by default
UPDATE public.contact_classifications SET show_in_workflow = true WHERE show_in_workflow IS NULL;