ALTER TABLE public.financial_entries 
ADD COLUMN nucleus_id UUID REFERENCES public.specialized_nuclei(id) ON DELETE SET NULL;