-- Create cost_accounts table for organizing expenses
CREATE TABLE public.cost_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT 'bg-blue-500',
  icon TEXT DEFAULT 'wallet',
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.cost_accounts ENABLE ROW LEVEL SECURITY;

-- RLS policies - anyone authenticated can manage
CREATE POLICY "Anyone can read cost_accounts" 
  ON public.cost_accounts FOR SELECT USING (true);

CREATE POLICY "Anyone can insert cost_accounts" 
  ON public.cost_accounts FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update cost_accounts" 
  ON public.cost_accounts FOR UPDATE USING (true);

CREATE POLICY "Anyone can delete cost_accounts" 
  ON public.cost_accounts FOR DELETE USING (true);

-- Add cost_account_id to card_assignments for default account per card
ALTER TABLE public.card_assignments 
  ADD COLUMN cost_account_id UUID REFERENCES public.cost_accounts(id) ON DELETE SET NULL;

-- Add cost_account_id to transaction_category_overrides for per-transaction override
ALTER TABLE public.transaction_category_overrides 
  ADD COLUMN cost_account_id UUID REFERENCES public.cost_accounts(id) ON DELETE SET NULL;

-- Create trigger for updated_at
CREATE TRIGGER update_cost_accounts_updated_at
  BEFORE UPDATE ON public.cost_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();