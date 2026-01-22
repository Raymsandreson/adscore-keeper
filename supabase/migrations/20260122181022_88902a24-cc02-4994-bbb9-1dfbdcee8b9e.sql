-- 1. Create junction table for contact-lead many-to-many relationships
CREATE TABLE public.contact_leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(contact_id, lead_id)
);

-- Enable RLS
ALTER TABLE public.contact_leads ENABLE ROW LEVEL SECURITY;

-- RLS policies for contact_leads
CREATE POLICY "Anyone can read contact_leads" 
ON public.contact_leads 
FOR SELECT 
USING (true);

CREATE POLICY "Anyone can insert contact_leads" 
ON public.contact_leads 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Anyone can update contact_leads" 
ON public.contact_leads 
FOR UPDATE 
USING (true);

CREATE POLICY "Anyone can delete contact_leads" 
ON public.contact_leads 
FOR DELETE 
USING (true);

-- 2. Change classification from text to array to support multiple classifications
ALTER TABLE public.contacts 
  ADD COLUMN classifications TEXT[] DEFAULT '{}';

-- Migrate existing classification data to the new array column
UPDATE public.contacts 
SET classifications = ARRAY[classification] 
WHERE classification IS NOT NULL;

-- 3. Migrate existing lead_id relationships to the new junction table
INSERT INTO public.contact_leads (contact_id, lead_id)
SELECT id, lead_id FROM public.contacts 
WHERE lead_id IS NOT NULL
ON CONFLICT DO NOTHING;