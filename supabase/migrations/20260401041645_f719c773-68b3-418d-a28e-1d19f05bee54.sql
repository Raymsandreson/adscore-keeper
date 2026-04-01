
-- Create N:N relationship table between nuclei and companies
CREATE TABLE public.nucleus_companies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nucleus_id UUID NOT NULL REFERENCES public.specialized_nuclei(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(nucleus_id, company_id)
);

-- Enable RLS
ALTER TABLE public.nucleus_companies ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Anyone can view nucleus_companies" ON public.nucleus_companies FOR SELECT USING (true);
CREATE POLICY "Authenticated can insert nucleus_companies" ON public.nucleus_companies FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can delete nucleus_companies" ON public.nucleus_companies FOR DELETE TO authenticated USING (true);

-- Migrate existing company_id links
INSERT INTO public.nucleus_companies (nucleus_id, company_id)
SELECT id, company_id FROM public.specialized_nuclei WHERE company_id IS NOT NULL
ON CONFLICT DO NOTHING;
