-- Create table for storing credit card transactions from Pluggy
CREATE TABLE public.credit_card_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  pluggy_account_id TEXT NOT NULL,
  pluggy_transaction_id TEXT UNIQUE NOT NULL,
  description TEXT,
  amount NUMERIC NOT NULL,
  currency_code TEXT DEFAULT 'BRL',
  transaction_date DATE NOT NULL,
  category TEXT,
  payment_data JSONB DEFAULT '{}'::jsonb,
  card_last_digits TEXT,
  merchant_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create table for storing Pluggy connections
CREATE TABLE public.pluggy_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  pluggy_item_id TEXT UNIQUE NOT NULL,
  connector_name TEXT,
  connector_type TEXT,
  status TEXT DEFAULT 'active',
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.credit_card_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_connections ENABLE ROW LEVEL SECURITY;

-- RLS policies for credit_card_transactions
CREATE POLICY "Users can view their own transactions"
ON public.credit_card_transactions FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own transactions"
ON public.credit_card_transactions FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own transactions"
ON public.credit_card_transactions FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own transactions"
ON public.credit_card_transactions FOR DELETE
USING (user_id = auth.uid());

-- RLS policies for pluggy_connections
CREATE POLICY "Users can view their own connections"
ON public.pluggy_connections FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own connections"
ON public.pluggy_connections FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own connections"
ON public.pluggy_connections FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own connections"
ON public.pluggy_connections FOR DELETE
USING (user_id = auth.uid());

-- Create indexes for better query performance
CREATE INDEX idx_transactions_user_date ON public.credit_card_transactions (user_id, transaction_date DESC);
CREATE INDEX idx_transactions_category ON public.credit_card_transactions (category);
CREATE INDEX idx_connections_user ON public.pluggy_connections (user_id);

-- Trigger for updated_at
CREATE TRIGGER update_credit_card_transactions_updated_at
BEFORE UPDATE ON public.credit_card_transactions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_pluggy_connections_updated_at
BEFORE UPDATE ON public.pluggy_connections
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();