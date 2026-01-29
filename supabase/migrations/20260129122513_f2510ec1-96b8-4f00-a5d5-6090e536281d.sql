-- Create expense categories table for custom categories
CREATE TABLE public.expense_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT DEFAULT 'tag',
  color TEXT DEFAULT 'bg-gray-500',
  max_limit_per_unit NUMERIC DEFAULT NULL,
  limit_unit TEXT DEFAULT NULL, -- 'per_transaction', 'per_day', 'per_month'
  is_system BOOLEAN DEFAULT false,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create card assignments table to link cards to leads/acolhedores
CREATE TABLE public.card_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  card_last_digits TEXT NOT NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  lead_name TEXT,
  pluggy_account_id TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(card_last_digits, pluggy_account_id)
);

-- Create transaction category overrides (for manual categorization)
CREATE TABLE public.transaction_category_overrides (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  transaction_id UUID REFERENCES public.credit_card_transactions(id) ON DELETE CASCADE NOT NULL,
  category_id UUID REFERENCES public.expense_categories(id) ON DELETE CASCADE NOT NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(transaction_id)
);

-- Enable RLS
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.card_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_category_overrides ENABLE ROW LEVEL SECURITY;

-- RLS Policies for expense_categories
CREATE POLICY "Anyone can read expense_categories" ON public.expense_categories FOR SELECT USING (true);
CREATE POLICY "Anyone can insert expense_categories" ON public.expense_categories FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update expense_categories" ON public.expense_categories FOR UPDATE USING (is_system = false);
CREATE POLICY "Anyone can delete expense_categories" ON public.expense_categories FOR DELETE USING (is_system = false);

-- RLS Policies for card_assignments
CREATE POLICY "Anyone can read card_assignments" ON public.card_assignments FOR SELECT USING (true);
CREATE POLICY "Anyone can insert card_assignments" ON public.card_assignments FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update card_assignments" ON public.card_assignments FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete card_assignments" ON public.card_assignments FOR DELETE USING (true);

-- RLS Policies for transaction_category_overrides
CREATE POLICY "Anyone can read transaction_category_overrides" ON public.transaction_category_overrides FOR SELECT USING (true);
CREATE POLICY "Anyone can insert transaction_category_overrides" ON public.transaction_category_overrides FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update transaction_category_overrides" ON public.transaction_category_overrides FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete transaction_category_overrides" ON public.transaction_category_overrides FOR DELETE USING (true);

-- Insert default system categories
INSERT INTO public.expense_categories (name, icon, color, max_limit_per_unit, limit_unit, is_system, display_order) VALUES
('Alimentação', 'utensils', 'bg-orange-500', NULL, NULL, true, 1),
('Transporte', 'car', 'bg-blue-500', NULL, NULL, true, 2),
('Hospedagem', 'bed', 'bg-purple-500', 250, 'per_transaction', true, 3),
('Combustível', 'fuel', 'bg-green-500', NULL, NULL, true, 4),
('Uber/99', 'car-taxi-front', 'bg-gray-800', 100, 'per_transaction', true, 5),
('Passagem Aérea', 'plane', 'bg-sky-500', NULL, NULL, true, 6),
('Material de Escritório', 'briefcase', 'bg-amber-500', NULL, NULL, true, 7),
('Outros', 'package', 'bg-gray-500', NULL, NULL, true, 99);

-- Create trigger for updated_at
CREATE TRIGGER update_expense_categories_updated_at
  BEFORE UPDATE ON public.expense_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_card_assignments_updated_at
  BEFORE UPDATE ON public.card_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();