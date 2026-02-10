
-- Table to store public form tokens for expense justification
CREATE TABLE public.expense_form_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  card_last_digits TEXT NOT NULL,
  pluggy_account_id TEXT,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  transaction_ids TEXT[] DEFAULT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '7 days'),
  notes TEXT
);

-- Enable RLS
ALTER TABLE public.expense_form_tokens ENABLE ROW LEVEL SECURITY;

-- Only authenticated users can create/view tokens
CREATE POLICY "Authenticated users can create tokens"
  ON public.expense_form_tokens FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Authenticated users can view tokens"
  ON public.expense_form_tokens FOR SELECT
  USING (auth.uid() = created_by);

-- Table to track which transactions were already justified (one-time edit)
CREATE TABLE public.expense_form_responses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  token_id UUID NOT NULL REFERENCES public.expense_form_tokens(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL,
  description TEXT,
  category TEXT,
  city TEXT,
  state TEXT,
  lead_name TEXT,
  submitted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(token_id, transaction_id)
);

ALTER TABLE public.expense_form_responses ENABLE ROW LEVEL SECURITY;

-- Public read/insert for responses (via edge function validation)
CREATE POLICY "Service role can manage responses"
  ON public.expense_form_responses FOR ALL
  USING (true)
  WITH CHECK (true);
