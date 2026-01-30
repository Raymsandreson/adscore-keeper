-- Add location columns to credit_card_transactions
ALTER TABLE public.credit_card_transactions
ADD COLUMN IF NOT EXISTS merchant_cnpj TEXT,
ADD COLUMN IF NOT EXISTS merchant_city TEXT,
ADD COLUMN IF NOT EXISTS merchant_state TEXT;

-- Add index for faster location queries
CREATE INDEX IF NOT EXISTS idx_credit_card_transactions_location 
ON public.credit_card_transactions(merchant_city, merchant_state);