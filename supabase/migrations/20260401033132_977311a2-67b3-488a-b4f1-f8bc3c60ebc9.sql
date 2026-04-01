
-- Add company_id to specialized_nuclei to link Nucleus → Company
ALTER TABLE public.specialized_nuclei
ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX idx_specialized_nuclei_company_id ON public.specialized_nuclei(company_id);
