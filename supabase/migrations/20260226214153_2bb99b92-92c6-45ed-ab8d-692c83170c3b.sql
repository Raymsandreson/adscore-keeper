ALTER TABLE public.transaction_category_overrides
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id),
  ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES public.cost_centers(id),
  ADD COLUMN IF NOT EXISTS nature TEXT,
  ADD COLUMN IF NOT EXISTS recurrence TEXT,
  ADD COLUMN IF NOT EXISTS beneficiary_id UUID REFERENCES public.beneficiaries(id),
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS invoice_number TEXT;