
-- Table for bank/checking account transactions
CREATE TABLE public.bank_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  pluggy_account_id TEXT NOT NULL,
  pluggy_transaction_id TEXT NOT NULL,
  pluggy_item_id TEXT,
  description TEXT,
  amount NUMERIC NOT NULL,
  currency_code TEXT DEFAULT 'BRL',
  transaction_date DATE NOT NULL,
  transaction_time TIME WITHOUT TIME ZONE,
  category TEXT,
  transaction_type TEXT, -- DEBIT or CREDIT
  payment_data JSONB DEFAULT '{}'::jsonb,
  merchant_name TEXT,
  merchant_cnpj TEXT,
  merchant_city TEXT,
  merchant_state TEXT,
  balance_after NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pluggy_transaction_id)
);

ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own bank transactions"
  ON public.bank_transactions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own bank transactions"
  ON public.bank_transactions FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own bank transactions"
  ON public.bank_transactions FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own bank transactions"
  ON public.bank_transactions FOR DELETE
  USING (user_id = auth.uid());

-- Table for investments
CREATE TABLE public.investments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  pluggy_account_id TEXT NOT NULL,
  pluggy_item_id TEXT,
  name TEXT,
  type TEXT, -- CDB, Tesouro, Ações, etc.
  balance NUMERIC DEFAULT 0,
  amount_original NUMERIC,
  amount_profit NUMERIC,
  annual_rate NUMERIC,
  currency_code TEXT DEFAULT 'BRL',
  due_date DATE,
  issuer_name TEXT,
  status TEXT DEFAULT 'active',
  last_updated_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pluggy_account_id, user_id)
);

ALTER TABLE public.investments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own investments"
  ON public.investments FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own investments"
  ON public.investments FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own investments"
  ON public.investments FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own investments"
  ON public.investments FOR DELETE
  USING (user_id = auth.uid());

-- Table for loans
CREATE TABLE public.loans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  pluggy_account_id TEXT NOT NULL,
  pluggy_item_id TEXT,
  name TEXT,
  loan_type TEXT,
  total_amount NUMERIC,
  outstanding_balance NUMERIC,
  monthly_payment NUMERIC,
  interest_rate NUMERIC,
  currency_code TEXT DEFAULT 'BRL',
  installments_total INTEGER,
  installments_paid INTEGER,
  start_date DATE,
  due_date DATE,
  status TEXT DEFAULT 'active',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pluggy_account_id, user_id)
);

ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own loans"
  ON public.loans FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own loans"
  ON public.loans FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own loans"
  ON public.loans FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own loans"
  ON public.loans FOR DELETE
  USING (user_id = auth.uid());

-- Triggers for updated_at
CREATE TRIGGER update_bank_transactions_updated_at
  BEFORE UPDATE ON public.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_investments_updated_at
  BEFORE UPDATE ON public.investments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_loans_updated_at
  BEFORE UPDATE ON public.loans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
