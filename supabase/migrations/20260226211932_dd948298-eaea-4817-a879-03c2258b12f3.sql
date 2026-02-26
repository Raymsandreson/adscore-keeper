
-- 1. Companies table
CREATE TABLE public.companies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  cnpj TEXT,
  trading_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view companies" ON public.companies
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage companies" ON public.companies
  FOR ALL TO authenticated USING (public.is_admin(auth.uid()));

-- 2. Cost Centers table
CREATE TABLE public.cost_centers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cost_centers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view cost_centers" ON public.cost_centers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage cost_centers" ON public.cost_centers
  FOR ALL TO authenticated USING (public.is_admin(auth.uid()));

-- 3. Beneficiaries table
CREATE TABLE public.beneficiaries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  document TEXT,
  person_type TEXT NOT NULL DEFAULT 'juridica' CHECK (person_type IN ('fisica', 'juridica')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.beneficiaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view beneficiaries" ON public.beneficiaries
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage beneficiaries" ON public.beneficiaries
  FOR ALL TO authenticated USING (public.is_admin(auth.uid()));

-- 4. Financial Entries table (unified)
CREATE TABLE public.financial_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  entry_type TEXT NOT NULL DEFAULT 'saida' CHECK (entry_type IN ('entrada', 'saida')),
  company_id UUID NOT NULL REFERENCES public.companies(id),
  cost_center_id UUID REFERENCES public.cost_centers(id),
  category_id UUID REFERENCES public.expense_categories(id),
  nature TEXT CHECK (nature IN ('fixo', 'variavel', 'semi_fixo')),
  recurrence TEXT CHECK (recurrence IN ('semanal', 'mensal', 'anual', 'eventual')),
  beneficiary_id UUID REFERENCES public.beneficiaries(id),
  description TEXT,
  cash_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  accrual_amount NUMERIC(14,2),
  accrual_start_date DATE,
  accrual_end_date DATE,
  invoice_number TEXT,
  invoice_url TEXT,
  linked_account TEXT,
  payment_method TEXT,
  reference_id TEXT,
  source_type TEXT CHECK (source_type IN ('manual', 'credit_card', 'bank')),
  source_transaction_id TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.financial_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view financial_entries" ON public.financial_entries
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert financial_entries" ON public.financial_entries
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Admins can manage financial_entries" ON public.financial_entries
  FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Creators can update own financial_entries" ON public.financial_entries
  FOR UPDATE TO authenticated USING (auth.uid() = created_by);

-- 5. Storage bucket for invoices
INSERT INTO storage.buckets (id, name, public) VALUES ('invoices', 'invoices', true);

CREATE POLICY "Authenticated users can upload invoices" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'invoices');
CREATE POLICY "Anyone can view invoices" ON storage.objects
  FOR SELECT USING (bucket_id = 'invoices');
CREATE POLICY "Authenticated users can delete own invoices" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'invoices');

-- Triggers for updated_at
CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_cost_centers_updated_at BEFORE UPDATE ON public.cost_centers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_beneficiaries_updated_at BEFORE UPDATE ON public.beneficiaries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_financial_entries_updated_at BEFORE UPDATE ON public.financial_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for financial_entries
ALTER PUBLICATION supabase_realtime ADD TABLE public.financial_entries;
