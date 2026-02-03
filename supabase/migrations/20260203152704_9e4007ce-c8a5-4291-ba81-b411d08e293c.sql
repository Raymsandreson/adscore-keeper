-- Create junction table for contact professions (many-to-many)
CREATE TABLE public.contact_professions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  cbo_code TEXT NOT NULL,
  profession_title TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(contact_id, cbo_code)
);

-- Enable RLS
ALTER TABLE public.contact_professions ENABLE ROW LEVEL SECURITY;

-- Create policies (public access like contacts table)
CREATE POLICY "Allow public read access to contact_professions"
ON public.contact_professions FOR SELECT
USING (true);

CREATE POLICY "Allow public insert access to contact_professions"
ON public.contact_professions FOR INSERT
WITH CHECK (true);

CREATE POLICY "Allow public update access to contact_professions"
ON public.contact_professions FOR UPDATE
USING (true);

CREATE POLICY "Allow public delete access to contact_professions"
ON public.contact_professions FOR DELETE
USING (true);

-- Create index for faster lookups
CREATE INDEX idx_contact_professions_contact_id ON public.contact_professions(contact_id);
CREATE INDEX idx_contact_professions_cbo_code ON public.contact_professions(cbo_code);